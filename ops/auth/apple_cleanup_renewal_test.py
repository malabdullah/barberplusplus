import copy
import contextlib
import io
import json
import os
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch

import apple_cleanup_renewal as cleanup

NOW = 1800000000


def token(client, issued):
    # Deterministic non-credentials. No actual private key/signing/entropy/provider.
    return 'SYNTHETIC-NOT-A-JWT:' + client + ':' + str(issued)


def validate(value, config, now):
    prefix = 'SYNTHETIC-NOT-A-JWT:' + config['clientId'] + ':'
    if not value.startswith(prefix):
        raise ValueError('SYNTHETIC_INVALID_SCOPE_OR_SIGNATURE')
    issued = int(value[len(prefix):])
    if issued > now + 300:
        raise ValueError('SYNTHETIC_CLOCK_ROLLBACK')
    return {'iat': issued, 'exp': issued + cleanup.signing.LIFETIME}


class Interrupted(BaseException):
    pass


class FakeHost:
    def __init__(self, document):
        self.original = copy.deepcopy(document)
        self.live = cleanup.function_env(document)[cleanup.PAIR]
        self.activations = 0
        self.fail = None

    def preflight(self, document, active):
        if self.fail == 'preflight':
            raise ValueError('SYNTHETIC_DRIFT')
        if cleanup.function_env(document)[cleanup.PAIR] != self.live:
            raise ValueError('SYNTHETIC_SOURCE_DRIFT')
        return {'functionsImageId': 'synthetic-image', 'otherEnvironmentSha256': 'f' * 64, 'untouchedContainers': []}

    def validate_candidate(self, path):
        document = json.loads(pathlib.Path(path).read_bytes())
        comparison = copy.deepcopy(document)
        comparison['services']['functions']['environment'][cleanup.PAIR] = self.original['services']['functions']['environment'][cleanup.PAIR]
        if comparison != self.original:
            raise ValueError('SYNTHETIC_UNRELATED_CHANGE')
        if self.fail == 'candidate':
            raise ValueError('SYNTHETIC_COMPOSE_ERROR')

    def activate(self, path):
        self.activations += 1
        if self.fail == 'interrupt':
            self.fail = None
            raise Interrupted()
        if self.fail == 'activate':
            self.fail = None
            raise RuntimeError('SYNTHETIC_ACTIVATION_FAILURE')
        self.live = cleanup.function_env(json.loads(pathlib.Path(path).read_bytes()))[cleanup.PAIR]

    def verify(self, pair_value, before):
        if self.fail == 'verify':
            self.fail = None
            raise RuntimeError('SYNTHETIC_UNHEALTHY')
        if self.live != pair_value:
            raise ValueError('SYNTHETIC_WRONG_PAIR')


class CleanupRenewalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.root.chmod(0o700)
        self.state = self.root / 'state'
        self.state.mkdir(mode=0o700)
        self.active = self.root / 'override.json'
        self.config = {'environment': 'production', 'teamId': cleanup.TEAM, 'keyId': 'SYNTHKEY01',
                       'keyFile': str(self.root / 'NEVER_OPENED.p8'), 'overrideFile': str(self.active),
                       'composeDirectory': str(self.root), 'composeFile': str(self.root / 'compose.yml'),
                       'stateDirectory': str(self.state), 'backendLockFile': str(self.root / 'backend.lock'),
                       'imageIds': {n: 'sha256:' + str(i) * 64 for i, n in enumerate(cleanup.NAMES, 1)}}
        self.pair = {platform: {'clientId': client, 'clientSecret': token(client, NOW - 160 * 86400)} for platform, client in cleanup.CLIENTS.items()}
        self.document = {'services': {'auth': {'environment': {'GOTRUE_EXTERNAL_APPLE_SECRET': 'SYNTHETIC-LOGIN-UNCHANGED', 'SMTP': 'SYNTHETIC-MAIL'}},
                                     'functions': {'environment': {'APP_ENV': 'production', 'APP_URL': 'https://www.barberplusplus.com',
                                         'SUPABASE_URL': 'http://api-gw:8000', 'CUSTOMER_ACCOUNT_DELETION_BACKEND_URL': 'http://api-gw:8000',
                                         'CUSTOMER_PUBLIC_API_URL': 'https://srv1073968.hstgr.cloud',
                                         cleanup.PAIR: json.dumps(self.pair, sort_keys=True, separators=(',', ':')),
                                         cleanup.ENCRYPTION: '1' * 64, 'CUSTOMER_APPLE_REVOCATION_ENABLED': 'false',
                                         'CUSTOMER_ACCOUNT_DELETION_ENABLED': 'false', 'CUSTOMER_ACCOUNT_DELETION_CLEANUP_ENABLED': 'false',
                                         'RESEND_API_KEY': 'SYNTHETIC-MAIL', 'SUPABASE_SERVICE_ROLE_KEY': 'SYNTHETIC-SERVICE'}},
                                     'db': {'untouched': True}}}
        self.save()
        self.host = FakeHost(self.document)
        self.addCleanup(patch.stopall)
        self.sign = patch.object(cleanup.signing, 'issue', side_effect=lambda config, now: token(config['clientId'], now)).start()
        self.validate = patch.object(cleanup.signing, 'validate', side_effect=validate).start()
        # Any accidental real OpenSSL, Docker or external command fails the test.
        self.commands = patch.object(cleanup.signing, 'command', side_effect=AssertionError('REAL_COMMAND_FORBIDDEN')).start()

    def save(self):
        cleanup.signing.atomic(self.active, json.dumps(self.document).encode())

    def run_renewal(self, now=NOW, check_only=False):
        return cleanup.renew(self.config, self.host, now, check_only=check_only)

    def test_due_pair_changes_only_two_cleanup_secrets(self):
        original = self.active.read_bytes()
        report = self.run_renewal()
        self.assertEqual(report['status'], 'RENEWED')
        changed = json.loads(self.active.read_bytes())
        self.assertEqual(cleanup.replace_pair(changed, self.pair), self.document)
        self.assertEqual({x.args[0]['clientId'] for x in self.sign.call_args_list}, set(cleanup.CLIENTS.values()))
        self.assertEqual(self.sign.call_count, 2)
        self.assertEqual(self.host.activations, 1)
        self.assertNotEqual(original, self.active.read_bytes())
        self.assertEqual(self.active.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads((self.state / 'state.json').read_text())['phase'], 'RENEWED')

    def test_monitoring_and_journal_never_contain_credentials(self):
        report = self.run_renewal()
        text = json.dumps(report) + (self.state / 'state.json').read_text()
        for value in ['SYNTHETIC-NOT-A-JWT:', 'SYNTHETIC-LOGIN', 'SYNTHETIC-MAIL', 'SYNTHETIC-SERVICE', '1' * 64]:
            self.assertNotIn(value, text)
        self.assertEqual(report['severity'], 'OK')
        self.assertFalse(report['due'])

    def test_cleanup_only_mode_preserves_accepted_work_capability(self):
        env = self.document['services']['functions']['environment']
        env['CUSTOMER_ACCOUNT_DELETION_ENABLED'] = 'false'
        env['CUSTOMER_ACCOUNT_DELETION_CLEANUP_ENABLED'] = 'true'
        env['CUSTOMER_APPLE_REVOCATION_ENABLED'] = 'true'
        self.save()
        self.host = FakeHost(self.document)
        self.assertEqual(self.run_renewal()['status'], 'RENEWED')
        changed = cleanup.function_env(json.loads(self.active.read_bytes()))
        for key in ['CUSTOMER_ACCOUNT_DELETION_ENABLED', 'CUSTOMER_ACCOUNT_DELETION_CLEANUP_ENABLED', 'CUSTOMER_APPLE_REVOCATION_ENABLED', cleanup.ENCRYPTION]:
            self.assertEqual(changed[key], env[key])

    def test_fresh_pair_no_restart_or_signing(self):
        self.run_renewal()
        before = self.active.read_bytes()
        self.sign.reset_mock()
        self.assertEqual(self.run_renewal(NOW + 3600)['status'], 'HEALTHY_NOT_DUE')
        self.assertEqual(self.host.activations, 1)
        self.sign.assert_not_called()
        self.assertEqual(before, self.active.read_bytes())

    def test_read_only_check_never_creates_journal_or_signs_or_restarts(self):
        before = self.active.read_bytes()
        report = self.run_renewal(check_only=True)
        self.assertTrue(report['due'])
        self.assertEqual(report['severity'], 'WARNING')
        self.sign.assert_not_called()
        self.assertEqual(self.host.activations, 0)
        self.assertEqual(before, self.active.read_bytes())
        self.assertFalse((self.state / 'state.json').exists())

    def test_expired_pair_renews_after_downtime_and_monitor_is_critical(self):
        report = self.run_renewal(NOW + 40 * 86400, check_only=True)
        self.assertEqual(report['severity'], 'CRITICAL')
        self.assertEqual(self.run_renewal(NOW + 40 * 86400)['status'], 'RENEWED')

    def test_earliest_expiry_drives_both_platforms(self):
        self.pair['web']['clientSecret'] = token(cleanup.CLIENTS['web'], NOW - 10 * 86400)
        self.document['services']['functions']['environment'][cleanup.PAIR] = json.dumps(self.pair)
        self.save()
        self.host = FakeHost(self.document)
        self.assertEqual(self.run_renewal()['status'], 'RENEWED')
        self.assertEqual(self.sign.call_count, 2)

    def test_critical_boundary_and_due_boundary(self):
        def meta(days):
            return {p: {'issuedAt': NOW, 'expiresAt': NOW + days * 86400} for p in cleanup.CLIENTS}
        for days, severity, due in [(31, 'OK', False), (30, 'WARNING', True), (8, 'WARNING', True), (7, 'CRITICAL', True), (0, 'CRITICAL', True), (-1, 'CRITICAL', True)]:
            with self.subTest(days=days):
                result = cleanup.summary(meta(days), NOW, 'CHECKED')
                self.assertEqual((result['severity'], result['due']), (severity, due))

    def test_missing_partial_unknown_or_mixed_test_pair_fails_before_writes(self):
        for pair in [{}, {'ios': self.pair['ios']}, {**self.pair, 'other': self.pair['ios']},
                     {**self.pair, 'ios': {'clientId': 'com.barberplusplus.customer.test', 'clientSecret': 'not-real'}},
                     {**self.pair, 'web': {**self.pair['web'], 'extra': 'unknown'}}]:
            with self.subTest(pair=pair):
                self.document['services']['functions']['environment'][cleanup.PAIR] = json.dumps(pair)
                self.save()
                before = self.active.read_bytes()
                with self.assertRaises(ValueError):
                    self.run_renewal()
                self.assertEqual(before, self.active.read_bytes())
        self.sign.assert_not_called()
        self.assertEqual(self.host.activations, 0)

    def test_missing_encryption_or_wrong_namespace_binding_fails_closed(self):
        original = copy.deepcopy(self.document)
        for key, value in [(cleanup.ENCRYPTION, ''), ('APP_ENV', 'cloud-test'), ('APP_URL', 'https://unexpected.invalid'),
                           ('SUPABASE_URL', 'http://other:8000'), ('CUSTOMER_ACCOUNT_DELETION_BACKEND_URL', ''),
                           ('CUSTOMER_PUBLIC_API_URL', 'https://qvkucvcjmojjbphlzlks.supabase.co')]:
            self.document = copy.deepcopy(original)
            self.document['services']['functions']['environment'][key] = value
            self.save()
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.run_renewal()
        self.sign.assert_not_called()

    def test_bad_signature_scope_or_clock_prevents_restart(self):
        env = self.document['services']['functions']['environment']
        for value in ['invalid-signature', token(cleanup.CLIENTS['ios'], NOW), token(cleanup.CLIENTS['web'], NOW + 3600)]:
            pair = copy.deepcopy(self.pair)
            pair['web']['clientSecret'] = value
            env[cleanup.PAIR] = json.dumps(pair)
            self.save()
            with self.assertRaises(ValueError):
                self.run_renewal()
        self.assertEqual(self.host.activations, 0)

    def test_preflight_and_candidate_errors_dont_change_active(self):
        for failure in ['preflight', 'candidate']:
            self.host.fail = failure
            before = self.active.read_bytes()
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                self.run_renewal()
            self.assertEqual(before, self.active.read_bytes())
            self.assertFalse((self.state / 'state.json').exists())
            self.assertFalse((self.state / 'candidate.json').exists())
        self.assertEqual(self.host.activations, 0)

    def test_second_signature_failure_never_installs_a_partial_pair(self):
        original = self.active.read_bytes()
        self.sign.side_effect = [token(cleanup.CLIENTS['ios'], NOW), RuntimeError('SYNTHETIC_SIGN_FAILURE')]
        with self.assertRaises(RuntimeError):
            self.run_renewal()
        self.assertEqual(self.active.read_bytes(), original)
        self.assertEqual(self.host.activations, 0)
        self.assertFalse((self.state / 'state.json').exists())

    def test_activation_or_health_failure_rolls_back_exact_file_and_runtime(self):
        for failure in ['activate', 'verify']:
            self.host = FakeHost(self.document)
            self.host.fail = failure
            before = self.active.read_bytes()
            with self.subTest(failure=failure), self.assertRaises(RuntimeError):
                self.run_renewal()
            self.assertEqual(before, self.active.read_bytes())
            self.assertEqual(self.host.live, self.document['services']['functions']['environment'][cleanup.PAIR])
            self.assertEqual(json.loads((self.state / 'state.json').read_text())['phase'], 'ROLLED_BACK')

    def interrupted(self):
        self.host.fail = 'interrupt'
        with self.assertRaises(Interrupted):
            self.run_renewal()

    def test_interrupt_restores_before_retry_and_check_never_repairs(self):
        original = self.active.read_bytes()
        self.interrupted()
        configured = self.active.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'RECOVERY_REQUIRED'):
            self.run_renewal(check_only=True)
        self.assertEqual(self.active.read_bytes(), configured)
        with self.assertRaisesRegex(RuntimeError, 'INTERRUPTED_ROTATION_RESTORED'):
            self.run_renewal()
        self.assertEqual(self.active.read_bytes(), original)
        self.assertEqual(self.run_renewal(NOW + 3600)['status'], 'RENEWED')

    def test_interrupt_refuses_unknown_override_or_changed_config(self):
        self.interrupted()
        changed = json.loads(self.active.read_bytes())
        changed['operator_change'] = True
        cleanup.signing.atomic(self.active, json.dumps(changed).encode())
        before = self.active.read_bytes()
        with self.assertRaisesRegex(ValueError, 'RECOVERY_CONFIGURATION_DRIFT'):
            self.run_renewal()
        self.assertEqual(self.active.read_bytes(), before)
        self.config['keyId'] = 'OTHERKEY01'
        with self.assertRaisesRegex(ValueError, 'RECOVERY_IDENTITY_DRIFT'):
            self.run_renewal()

    def test_tampered_backup_and_unknown_journal_are_not_replayed(self):
        self.interrupted()
        state = json.loads((self.state / 'state.json').read_text())
        state['backup'] = '/unapproved/private-file'
        cleanup.signing.record(self.state / 'state.json', state)
        with self.assertRaisesRegex(ValueError, 'UNRECOGNIZED_BACKUP'):
            self.run_renewal()
        cleanup.signing.record(self.state / 'state.json', {'phase': 'UNKNOWN'})
        with self.assertRaisesRegex(ValueError, 'UNRECOGNIZED_RENEWAL_STATE'):
            self.run_renewal()

    def test_failure_recording_completion_restores_before_exiting(self):
        original = self.active.read_bytes()
        record = cleanup.signing.record
        failed = False
        def fail_once(path, value):
            nonlocal failed
            if value.get('phase') == 'RENEWED' and not failed:
                failed = True
                raise OSError('SYNTHETIC_DISK_FAILURE')
            record(path, value)
        with patch.object(cleanup.signing, 'record', side_effect=fail_once), self.assertRaises(OSError):
            self.run_renewal()
        self.assertEqual(original, self.active.read_bytes())
        self.assertEqual(json.loads((self.state / 'state.json').read_text())['phase'], 'ROLLED_BACK')

    def test_rollback_failure_retains_unresolved_journal_for_operator_review(self):
        with patch.object(self.host, 'verify', side_effect=RuntimeError('SYNTHETIC_PERSISTENT_HEALTH_FAILURE')), self.assertRaises(RuntimeError):
            self.run_renewal()
        self.assertEqual(json.loads((self.state / 'state.json').read_text())['phase'], 'CONFIGURED')
        with self.assertRaisesRegex(RuntimeError, 'RECOVERY_REQUIRED'):
            self.run_renewal(check_only=True)

    def test_insecure_files_and_symlink_state_are_refused(self):
        self.active.chmod(0o644)
        with self.assertRaises(ValueError):
            self.run_renewal()
        self.active.chmod(0o600)
        self.state.chmod(0o755)
        with self.assertRaises(ValueError):
            self.run_renewal()
        self.state.chmod(0o700)
        link = self.root / 'state-link'
        link.symlink_to(self.state)
        with self.assertRaises(ValueError):
            cleanup.renew({**self.config, 'stateDirectory': str(link)}, self.host, NOW)

    def test_production_config_is_exact_and_install_paths_are_pinned(self):
        cleanup.validate_config(self.config)
        for update in [{'environment': 'cloud-test'}, {'teamId': 'OTHERTEAM1'}, {'keyId': 'short'}, {'extra': True}, {'imageIds': {}}]:
            with self.subTest(update=update), self.assertRaises(ValueError):
                cleanup.validate_config({**self.config, **update})
        with self.assertRaisesRegex(ValueError, 'UNREVIEWED_INSTALL_PATHS'):
            cleanup.validate_config(self.config, installed=True)

    def test_public_install_example_matches_frozen_runtime_lock(self):
        root = pathlib.Path(__file__).parent
        example = json.loads((root / 'apple-cleanup-renewal.config.example.json').read_text())
        cleanup.validate_config(example, installed=True)
        lock = json.loads((root.parent / 'release/runtime-lock.json').read_text())
        self.assertEqual(example['imageIds'], {n: lock['containers'][n]['imageId'] for n in cleanup.NAMES})

    def containers(self):
        return [{'Name': '/' + n, 'Image': self.config['imageIds'][n], 'Id': n,
                 'Config': {'Env': [k + '=' + v for k, v in cleanup.function_env(self.document).items()] if i == 0 else ['UNCHANGED=true'],
                            'Labels': {'com.docker.compose.config-hash': 'synthetic-hash'}},
                 'State': {'Running': True, 'Health': {'Status': 'healthy'}, 'StartedAt': 'unchanged'}} for i, n in enumerate(cleanup.NAMES)]

    def test_actual_host_preflight_and_verify_path_with_mocked_docker(self):
        values = self.containers()
        host = cleanup.Host(self.config)
        calls = []
        def command(args, data=None):
            calls.append(args)
            if args[:2] == ['docker', 'inspect']:
                return json.dumps(values).encode()
            if args[-3:] == ['--hash', 'functions', 'unused']:
                raise AssertionError('bad command')
            if args[-3:] == ['config', '--hash', 'functions']:
                return b'functions synthetic-hash\n'
            return b''
        with patch.object(cleanup.signing, 'command', side_effect=command):
            before = host.preflight(self.document, self.active)
            host.validate_candidate(self.active)
            host.activate(self.active)
            host.verify(cleanup.function_env(self.document)[cleanup.PAIR], before)
        self.assertIn(['up', '-d', '--no-deps', '--pull', 'never', 'functions'], [x[-6:] for x in calls])
        self.assertFalse(any('auth' == x[-1] for x in calls))

    def test_actual_host_refuses_compose_key_encryption_or_binding_drift(self):
        for drift in ['compose', cleanup.PAIR, cleanup.ENCRYPTION, 'APP_URL']:
            values = self.containers()
            if drift != 'compose':
                values[0]['Config']['Env'] = [x if not x.startswith(drift + '=') else drift + '=changed' for x in values[0]['Config']['Env']]
            host = cleanup.Host(self.config)
            def command(args, data=None):
                return json.dumps(values).encode() if args[:2] == ['docker', 'inspect'] else b'functions different\n'
            with self.subTest(drift=drift), patch.object(cleanup.signing, 'command', side_effect=command), self.assertRaises(ValueError):
                host.preflight(self.document, self.active)

    def test_actual_host_verify_refuses_unrelated_environment_or_service_restart(self):
        values = self.containers()
        host = cleanup.Host(self.config)
        with patch.object(cleanup.signing, 'command', return_value=b'functions synthetic-hash'), patch.object(host, 'inspect', return_value=values):
            before = host.preflight(self.document, self.active)
        for change in ['encryption', 'auth', 'db', 'storage']:
            changed = copy.deepcopy(values)
            if change == 'encryption':
                changed[0]['Config']['Env'].append('UNRELATED=new-value')
            else:
                changed[['functions', 'auth', 'db', 'storage'].index(change)]['Id'] = 'changed'
            with self.subTest(change=change), patch.object(host, 'inspect', return_value=changed), self.assertRaises(ValueError):
                host.verify(cleanup.function_env(self.document)[cleanup.PAIR], before)

    def test_actual_core_renewal_through_mocked_host_commands(self):
        values = self.containers()
        untouched = copy.deepcopy(values[1:])
        host = cleanup.Host(self.config)
        activations = []
        def command(args, data=None):
            if args[:2] == ['docker', 'inspect']:
                return json.dumps(values).encode()
            if args[-3:] == ['config', '--hash', 'functions']:
                return b'functions synthetic-hash\n'
            if args[-6:] == ['up', '-d', '--no-deps', '--pull', 'never', 'functions']:
                path = args[args.index('up') - 1]
                document = json.loads(pathlib.Path(path).read_bytes())
                values[0]['Config']['Env'] = [k + '=' + v for k, v in cleanup.function_env(document).items()]
                values[0]['Id'] = 'replacement-functions'
                activations.append('functions')
            return b''
        with patch.object(cleanup.signing, 'command', side_effect=command):
            result = cleanup.renew(self.config, host, NOW)
        self.assertEqual(result['status'], 'RENEWED')
        self.assertEqual(activations, ['functions'])
        self.assertEqual(values[1:], untouched)
        self.assertEqual(cleanup.runtime_env(values[0])[cleanup.ENCRYPTION], '1' * 64)

    def test_runtime_health_wait_is_bounded_without_real_sleep(self):
        host = cleanup.Host(self.config)
        with patch.object(host, 'inspect', side_effect=RuntimeError('SYNTHETIC_UNHEALTHY')), patch.object(cleanup.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'FUNCTIONS_HEALTH_TIMEOUT'):
                host.verify('not-a-real-pair', {})
            self.assertEqual(sleep.call_count, 60)

    def test_units_keep_monitor_read_only_and_use_same_companion(self):
        root = pathlib.Path(__file__).parent
        monitor = (root / 'barber-apple-cleanup-monitor.service').read_text()
        renewal = (root / 'barber-apple-cleanup-renewal.service').read_text()
        self.assertIn('apple_cleanup_renewal.py --check', monitor)
        self.assertNotIn('ReadWritePaths=', monitor)
        self.assertIn('ProtectSystem=strict', monitor)
        self.assertIn('RestartSec=1h', renewal)
        for path in root.glob('barber-apple-cleanup-*'):
            text = path.read_text()
            for forbidden in ['curl ', 'wget ', 'https://', 'OnFailure=', 'genpkey', 'openssl']:
                self.assertNotIn(forbidden, text)

    def test_main_monitor_opens_existing_lock_read_only_and_reports_critical_exit(self):
        config = {**self.config, 'keyFile': '/etc/barber-release/apple-renewal/signing-key.p8',
                  'overrideFile': '/etc/barber-release/prepared-backend-runtime.override.json',
                  'composeDirectory': '/root/supabase/docker', 'composeFile': '/root/supabase/docker/docker-compose.yml',
                  'stateDirectory': cleanup.ROOT + '/state', 'backendLockFile': cleanup.LOCK}
        cleanup.validate_config(config, installed=True)
        with tempfile.TemporaryFile() as temporary:
            descriptor = os.dup(temporary.fileno())
            output = io.StringIO()
            with patch('sys.argv', ['apple_cleanup_renewal.py', '--check']), \
                 patch.object(cleanup.os, 'geteuid', return_value=0), \
                 patch.object(cleanup.os, 'uname', return_value=types.SimpleNamespace(nodename='srv1073968')), \
                 patch.object(cleanup.os, 'open', return_value=descriptor) as opened, \
                 patch.object(cleanup.os, 'fstat', return_value=types.SimpleNamespace(st_uid=0, st_mode=0o100600)), \
                 patch.object(cleanup.fcntl, 'flock'), \
                 patch.object(cleanup.signing, 'private_bytes', return_value=json.dumps(config).encode()) as private, \
                 patch.object(cleanup, 'renew', return_value={'status': 'CHECKED', 'severity': 'CRITICAL'}) as renew, \
                 contextlib.redirect_stdout(output):
                self.assertEqual(cleanup.main(), 2)
            opened.assert_called_once_with(cleanup.LOCK, os.O_RDONLY | os.O_NOFOLLOW)
            private.assert_called_once_with(cleanup.CONFIG)
            self.assertTrue(renew.call_args.kwargs['check_only'])
            self.assertEqual(json.loads(output.getvalue())['severity'], 'CRITICAL')

    def test_main_wrong_host_refuses_before_private_file_access(self):
        with patch('sys.argv', ['apple_cleanup_renewal.py']), \
             patch.object(cleanup.os, 'geteuid', return_value=0), \
             patch.object(cleanup.os, 'uname', return_value=types.SimpleNamespace(nodename='not-approved')), \
             patch.object(cleanup.signing, 'private_bytes') as private:
            with self.assertRaisesRegex(ValueError, 'REVIEWED_DB_HOST_ONLY'):
                cleanup.main()
            private.assert_not_called()

    def test_actual_runtime_identity_and_health_guards(self):
        for field, value, error in [('Name', '/wrong', ValueError), ('Image', 'sha256:' + 'f' * 64, ValueError), ('State', {'Running': True}, RuntimeError)]:
            values = self.containers()
            values[0][field] = value
            with self.subTest(field=field), patch.object(cleanup.signing, 'command', return_value=json.dumps(values).encode()), self.assertRaises(error):
                cleanup.Host(self.config).inspect()


if __name__ == '__main__':
    unittest.main()
