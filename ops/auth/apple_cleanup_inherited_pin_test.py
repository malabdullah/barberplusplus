import copy
import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

import apple_cleanup_inherited_pin as helper
import apple_cleanup_bootstrap as bootstrap
import apple_cleanup_renewal as renewal
from apple_cleanup_renewal_test import NOW, token, validate


class InheritedPinTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve(); self.root.chmod(0o700)
        self.config = json.loads(pathlib.Path(__file__).with_name('apple-cleanup-renewal.config.example.json').read_text())
        self.config['stateDirectory'] = str(self.root / 'state')
        self.document = {'services': {'functions': {'environment': {k: v for k, v in helper.PINS.items() if k != helper.PIN}},
                                     'auth': {'preserve': 'SYNTHETIC-LOGIN'}, 'storage': {'preserve': True}}, 'preserve': ['spacing', 1]}
        self.document['services']['functions']['environment']['UNRELATED'] = 'SYNTHETIC-MAIL'
        self.raw = json.dumps(self.document, indent=4).encode() + b'\n\n'
        self.evidence = {'sourceSha256': hashlib.sha256(self.raw).hexdigest(), 'runtimeBindings': copy.deepcopy(helper.PINS),
                         'runtimeAbsentFields': sorted(helper.ABSENT), 'functionsImageId': self.config['imageIds']['supabase-edge-functions'],
                         'functionsRunning': True, 'functionsHealthy': True, 'composeModelHash': 'a' * 64, 'runtimeComposeHash': 'a' * 64}
        self.issue = Mock(side_effect=lambda config, now: token(config['clientId'], now))
        self.validate = Mock(side_effect=validate); self.entropy = Mock(return_value='2' * 64)
        self.addCleanup(patch.stopall)
        patch.object(renewal.signing, 'command', side_effect=AssertionError('REAL_COMMAND_FORBIDDEN')).start()

    def stage(self):
        return helper.stage(self.config, self.raw, NOW, self.evidence, issue=self.issue, validate=self.validate, entropy=self.entropy)

    def reset_raw(self):
        self.raw = json.dumps(self.document, indent=4).encode() + b'\n\n'
        self.evidence['sourceSha256'] = hashlib.sha256(self.raw).hexdigest()

    def assert_no_generation(self):
        self.issue.assert_not_called(); self.validate.assert_not_called(); self.entropy.assert_not_called()
        self.assertFalse((self.root / 'bootstrap').exists())

    def test_only_final_candidate_adds_pin_and_preserves_actual_original_bytes(self):
        before = copy.deepcopy(self.document); report = self.stage(); directory = self.root / 'bootstrap'
        self.assertEqual((directory / 'original.override.json').read_bytes(), self.raw)
        self.assertNotIn(helper.PIN, json.loads((directory / 'original.override.json').read_bytes())['services']['functions']['environment'])
        candidate = json.loads((directory / 'staged.override.json').read_bytes()); env = candidate['services']['functions']['environment']
        self.assertEqual(env[helper.PIN], helper.VALUE)
        for key in bootstrap.FLAGS: self.assertEqual(env[key], 'false')
        restored = copy.deepcopy(candidate)
        for key in (*helper.ABSENT, helper.PIN): restored['services']['functions']['environment'].pop(key, None)
        self.assertEqual(restored, before); self.assertEqual(self.document, before)
        scope = json.loads((directory / 'scope.json').read_text())
        self.assertEqual(scope['beforeSha256'], hashlib.sha256(self.raw).hexdigest())
        self.assertEqual(scope['candidateSha256'], hashlib.sha256((directory / 'staged.override.json').read_bytes()).hexdigest())
        self.assertEqual(set(x.name for x in directory.iterdir()), set(bootstrap.STAGE_NAMES))
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        for path in directory.iterdir(): self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.issue.call_count, 2); self.assertEqual(self.validate.call_count, 2)
        self.entropy.assert_called_once_with(32); self.assertNotIn('2' * 64, json.dumps(report))
        self.assertNotIn('SYNTHETIC-NOT-A-JWT', json.dumps(report))

    def test_present_correct_wrong_empty_pin_all_refused(self):
        for value in (helper.VALUE, 'wrong', '', None):
            self.document['services']['functions']['environment'][helper.PIN] = value; self.reset_raw()
            with self.assertRaisesRegex(ValueError, 'MUST_BE_ABSENT'): self.stage()
        self.assert_no_generation()

    def test_each_other_missing_or_wrong_source_pin_refused(self):
        env = self.document['services']['functions']['environment']
        for key in helper.PINS:
            if key == helper.PIN: continue
            original = env.pop(key); self.reset_raw()
            with self.assertRaises(ValueError): self.stage()
            env[key] = 'wrong'; self.reset_raw()
            with self.assertRaises(ValueError): self.stage()
            env[key] = original
        self.assert_no_generation()

    def test_source_proof_wrong_or_normalized_bytes_refused(self):
        self.raw = json.dumps(self.document).encode()
        with self.assertRaisesRegex(ValueError, 'SOURCE_DRIFT'): self.stage()
        self.assert_no_generation()

    def test_runtime_binding_mismatch_and_model_mismatch_refuse_generation(self):
        original = copy.deepcopy(self.evidence)
        cases = [{'runtimeBindings': {}}, {'runtimeBindings': {**helper.PINS, helper.PIN: 'wrong'}},
                 {'functionsImageId': 'sha256:' + '0' * 64}, {'functionsHealthy': False}, {'functionsRunning': False},
                 {'composeModelHash': 'bad'}, {'runtimeComposeHash': 'b' * 64}, {'runtimeAbsentFields': []}]
        for change in cases:
            self.evidence = {**original, **change}
            with self.assertRaisesRegex(ValueError, 'RUNTIME_OR_MODEL_DRIFT'): self.stage()
        self.assert_no_generation()

    def test_extra_or_incomplete_evidence_refused(self):
        original = copy.deepcopy(self.evidence)
        for value in ({}, {**original, 'arbitraryOverrideAllowed': True}):
            self.evidence = value
            with self.assertRaisesRegex(ValueError, 'EVIDENCE'): self.stage()
        self.assert_no_generation()

    def test_original_credential_and_flag_guards_remain_before_generation(self):
        env = self.document['services']['functions']['environment']
        for key, value in [(renewal.PAIR, ''), (renewal.ENCRYPTION, ''), *[(k, 'true') for k in bootstrap.FLAGS], ('CUSTOMER_ACCOUNT_DELETION_BACKEND_URL', 'wrong')]:
            env[key] = value; self.reset_raw()
            with self.assertRaises(ValueError): self.stage()
            env.pop(key)
        self.assert_no_generation()

    def test_source_runtime_absence_contradiction_is_refused_even_safe_values(self):
        env = self.document['services']['functions']['environment']
        for key in helper.ABSENT:
            for value in ('', None, 'false', helper.VALUE):
                env[key] = value; self.reset_raw()
                with self.assertRaisesRegex(ValueError, 'SOURCE_FIELDS_MUST_BE_ABSENT'): self.stage()
            env.pop(key)
        self.assert_no_generation()

    def test_stale_or_partial_staging_is_never_reused(self):
        directory = self.root / 'bootstrap'; directory.mkdir(); (directory / 'owner-file').write_bytes(b'preserve')
        with self.assertRaisesRegex(ValueError, 'EXISTING_BOOTSTRAP'): self.stage()
        self.assertEqual((directory / 'owner-file').read_bytes(), b'preserve'); self.issue.assert_not_called()

    def test_signature_or_issuance_failure_creates_no_stage_or_key(self):
        self.validate.side_effect = ValueError('SYNTHETIC_BAD_SIGNATURE')
        with self.assertRaises(ValueError): self.stage()
        self.entropy.assert_not_called(); self.assertFalse((self.root / 'bootstrap').exists())

    def test_partial_write_retains_actual_original_and_blocks_retry(self):
        atomic = renewal.signing.atomic
        def fail_candidate(path, raw):
            if pathlib.Path(path).name == 'staged.override.json': raise OSError('SYNTHETIC_DISK_FAILURE')
            atomic(path, raw)
        with patch.object(renewal.signing, 'atomic', side_effect=fail_candidate), self.assertRaises(OSError): self.stage()
        self.assertEqual((self.root / 'bootstrap' / 'original.override.json').read_bytes(), self.raw)
        self.issue.reset_mock()
        with self.assertRaisesRegex(ValueError, 'EXISTING_BOOTSTRAP'): self.stage()
        self.issue.assert_not_called()

    def test_original_strict_prepare_still_refuses_missing_pin(self):
        with self.assertRaisesRegex(ValueError, 'DEPLOYMENT_DRIFT'):
            bootstrap.prepare(self.document, self.config, NOW, issue=self.issue, validate=self.validate, entropy=self.entropy)
        self.assert_no_generation()


if __name__ == '__main__':
    unittest.main()
