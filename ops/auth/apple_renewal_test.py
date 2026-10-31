import copy
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import apple_renewal as renewal


class FakeHost:
    def __init__(self, document):
        self.original = copy.deepcopy(document)
        self.live = document['services']['auth']['environment'][renewal.SECRET]
        self.activations = 0
        self.fail_next_health = False
        self.drift = False

    def preflight(self, document, path):
        if self.drift:
            raise ValueError('Compose drift')
        return {'authImageId': 'synthetic-pinned-image', 'untouchedContainers': ['synthetic-db', 'synthetic-functions']}

    def validate_candidate(self, path):
        document = json.loads(pathlib.Path(path).read_bytes())
        old = self.original['services']['auth']['environment'][renewal.SECRET]
        if renewal.replace_secret(document, old) != self.original:
            raise ValueError('Unrelated settings changed')

    def activate(self, path):
        self.live = json.loads(pathlib.Path(path).read_bytes())['services']['auth']['environment'][renewal.SECRET]
        self.activations += 1

    def verify(self, token, before):
        if self.fail_next_health:
            self.fail_next_health = False
            raise RuntimeError('Synthetic unhealthy Auth')
        if self.live != token:
            raise ValueError('Wrong live credential')


class RenewalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.root.chmod(0o700)
        self.key = self.root / 'synthetic-key.p8'
        self.key.write_bytes(renewal.command(['openssl', 'genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:prime256v1']))
        self.key.chmod(0o600)
        self.now = 1800000000
        self.active = self.root / 'override.json'
        self.config = {'keyFile': str(self.key), 'teamId': 'TESTTEAM01', 'keyId': 'TESTKEY001', 'clientId': 'com.synthetic.test', 'overrideFile': str(self.active), 'stateDirectory': str(self.root / 'state')}
        self.old = renewal.issue(self.config, self.now - 160 * 86400)
        self.document = {'services': {'auth': {'image': 'synthetic-pinned-image', 'environment': {renewal.SECRET: self.old, 'GOTRUE_JWT_SECRET': 'synthetic-session-key', 'GOTRUE_SMTP_PASS': 'synthetic-mail-key', 'GOTRUE_EXTERNAL_GOOGLE_SECRET': 'synthetic-google-key'}}, 'functions': {'image': 'synthetic-functions', 'environment': {'EXAMPLE': 'unchanged'}}}}
        renewal.atomic(self.active, json.dumps(self.document).encode())
        self.host = FakeHost(self.document)

    def test_renews_due_credential_preserving_every_other_setting(self):
        result = renewal.renew(self.config, self.host, self.now)
        self.assertEqual(result['status'], 'RENEWED')
        changed = json.loads(self.active.read_bytes())
        token = changed['services']['auth']['environment'][renewal.SECRET]
        self.assertNotEqual(token, self.old)
        self.assertEqual(renewal.replace_secret(changed, self.old), self.document)
        claims = renewal.validate(token, self.config, self.now)
        self.assertEqual(claims['exp'], self.now + 180 * 86400)
        self.assertEqual(self.host.activations, 1)
        journal = (self.root / 'state/state.json').read_text()
        self.assertNotIn(token, journal)
        self.assertNotIn(self.old, journal)
        self.assertEqual(self.active.stat().st_mode & 0o777, 0o600)

    def test_fresh_secret_does_not_restart_auth(self):
        first = renewal.renew(self.config, self.host, self.now)
        self.assertEqual(first['status'], 'RENEWED')
        before = self.active.read_bytes()
        result = renewal.renew(self.config, self.host, self.now + 3600)
        self.assertEqual(result['status'], 'HEALTHY_NOT_DUE')
        self.assertEqual(self.host.activations, 1)
        self.assertEqual(before, self.active.read_bytes())

    def test_force_exercises_rotation_of_a_fresh_secret(self):
        renewal.renew(self.config, self.host, self.now)
        self.assertEqual(renewal.renew(self.config, self.host, self.now + 3600, force=True)['status'], 'RENEWED')
        self.assertEqual(self.host.activations, 2)

    def test_unhealthy_replacement_restores_original_config_and_auth(self):
        before = self.active.read_bytes()
        self.host.fail_next_health = True
        with self.assertRaises(RuntimeError):
            renewal.renew(self.config, self.host, self.now)
        self.assertEqual(self.active.read_bytes(), before)
        self.assertEqual(self.host.live, self.old)
        self.assertEqual(json.loads((self.root / 'state/state.json').read_text())['phase'], 'ROLLED_BACK')
        self.assertEqual(renewal.renew(self.config, self.host, self.now + 3600)['status'], 'RENEWED')

    def test_invalid_signature_is_rejected_without_changes(self):
        token = self.old.split('.')
        raw = renewal.decoded(token[2]);token[2] = renewal.encoded(bytes([raw[0] ^ 1]) + raw[1:])
        with self.assertRaises(RuntimeError):
            renewal.validate('.'.join(token), self.config, self.now)
        self.assertEqual(self.host.activations, 0)

    def test_wrong_identity_is_rejected(self):
        for field in ['teamId', 'keyId', 'clientId']:
            with self.subTest(field=field), self.assertRaises(ValueError):
                renewal.validate(self.old, {**self.config, field: 'different'}, self.now)

    def test_clock_rollback_is_rejected(self):
        with self.assertRaises(ValueError):
            renewal.validate(self.old, self.config, self.now - 200 * 86400)

    def test_insecure_key_permissions_are_rejected(self):
        self.key.chmod(0o644)
        with self.assertRaises(ValueError):
            renewal.renew(self.config, self.host, self.now)
        self.assertEqual(self.host.activations, 0)

    def test_symlink_key_is_rejected(self):
        link = self.root / 'link.p8';link.symlink_to(self.key)
        with self.assertRaises(ValueError):
            renewal.issue({**self.config, 'keyFile': str(link)}, self.now)

    def test_configuration_drift_prevents_any_restart(self):
        self.host.drift = True
        before = self.active.read_bytes()
        with self.assertRaises(ValueError):
            renewal.renew(self.config, self.host, self.now)
        self.assertEqual(before, self.active.read_bytes())
        self.assertEqual(self.host.activations, 0)

    def test_expired_credential_catches_up_after_downtime(self):
        result = renewal.renew(self.config, self.host, self.now + 40 * 86400)
        self.assertEqual(result['status'], 'RENEWED')

    def test_wrong_curve_is_rejected(self):
        key = self.root / 'wrong-curve.p8'
        key.write_bytes(renewal.command(['openssl', 'genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:secp384r1']))
        key.chmod(0o600)
        with self.assertRaises(ValueError):
            renewal.issue({**self.config, 'keyFile': str(key)}, self.now)

    def test_runtime_guard_rejects_session_secret_changes_or_data_service_restarts(self):
        auth = {'Image': 'synthetic-image', 'Config': {'Env': [renewal.SECRET + '=new', 'GOTRUE_JWT_SECRET=unchanged']}, 'State': {'Running': True, 'Health': {'Status': 'healthy'}}}
        data = [{'Id': name, 'State': {'Running': True, 'Health': {'Status': 'healthy'}, 'StartedAt': 'unchanged'}} for name in ['db', 'functions']]
        before = {'authImageId': 'synthetic-image', 'otherEnvironmentSha256': renewal.sha(json.dumps(renewal.other_environment(auth), sort_keys=True).encode()), 'untouchedContainers': [{'id': x['Id'], 'startedAt': 'unchanged'} for x in data]}
        host = renewal.Host({'authImageId': 'synthetic-image'})
        with patch.object(host, 'inspect', return_value=[auth] + data):
            host.verify('new', before)
        for target in ['jwt', 'db', 'functions']:
            changed = copy.deepcopy([auth] + data)
            if target == 'jwt':
                changed[0]['Config']['Env'][1] = 'GOTRUE_JWT_SECRET=unexpected'
            else:
                changed[1 if target == 'db' else 2]['Id'] = 'unexpected-new-container'
            with self.subTest(target=target), patch.object(host, 'inspect', return_value=changed), self.assertRaises(ValueError):
                host.verify('new', before)

    def interrupted_state(self):
        directory = self.root / 'state';directory.mkdir(mode=0o700)
        old = self.active.read_bytes();backup = directory / 'backup.json';renewal.atomic(backup, old)
        new = json.dumps(renewal.replace_secret(self.document, renewal.issue(self.config, self.now))).encode()
        state = {'phase': 'CONFIGURED', 'backup': str(backup), 'beforeSha256': renewal.sha(old), 'afterSha256': renewal.sha(new), 'beforeRuntime': {}}
        renewal.record(directory / 'state.json', state);renewal.atomic(self.active, new)
        return old

    def test_interrupted_rotation_restores_original_and_retries_safely(self):
        old = self.interrupted_state()
        with self.assertRaises(RuntimeError):
            renewal.renew(self.config, self.host, self.now)
        self.assertEqual(old, self.active.read_bytes())
        self.assertEqual(renewal.renew(self.config, self.host, self.now + 3600)['status'], 'RENEWED')

    def test_interrupted_rotation_never_overwrites_unrecognized_changes(self):
        self.interrupted_state()
        changed = json.loads(self.active.read_bytes());changed['operator_change'] = True
        renewal.atomic(self.active, json.dumps(changed).encode())
        before = self.active.read_bytes()
        with self.assertRaises(ValueError):
            renewal.renew(self.config, self.host, self.now)
        self.assertEqual(before, self.active.read_bytes())
        self.assertEqual(self.host.activations, 0)


if __name__ == '__main__':
    unittest.main()
