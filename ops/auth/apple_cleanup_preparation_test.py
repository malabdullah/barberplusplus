import copy
import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

import apple_cleanup_bootstrap as bootstrap
import apple_cleanup_recovery as recovery
import apple_cleanup_renewal as renewal
from apple_cleanup_renewal_test import NOW, token, validate


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.root.chmod(0o700)
        self.config = json.loads(pathlib.Path(__file__).with_name('apple-cleanup-renewal.config.example.json').read_text())
        self.config['stateDirectory'] = str(self.root / 'state')
        self.document = {'services': {'auth': {'environment': {'GOTRUE_EXTERNAL_APPLE_SECRET': 'SYNTHETIC-LOGIN'}},
                                     'functions': {'environment': {'APP_ENV': 'production', 'APP_URL': 'https://www.barberplusplus.com',
                                         'SUPABASE_URL': 'http://api-gw:8000', 'CUSTOMER_PUBLIC_API_URL': 'https://srv1073968.hstgr.cloud',
                                         'RESEND_API_KEY': 'SYNTHETIC-MAIL', 'OTHER': 'unchanged'}}, 'storage': {'unchanged': True}}}
        self.issue = Mock(side_effect=lambda config, now: token(config['clientId'], now))
        self.validate = Mock(side_effect=validate)
        self.entropy = Mock(return_value='2' * 64)
        self.addCleanup(patch.stopall)
        self.forbidden = patch.object(renewal.signing, 'command', side_effect=AssertionError('REAL_COMMAND_FORBIDDEN')).start()

    def prepare(self):
        return bootstrap.prepare(self.document, self.config, NOW, issue=self.issue, validate=self.validate, entropy=self.entropy)

    def stage(self):
        return bootstrap.stage(self.config, json.dumps(self.document).encode(), NOW, issue=self.issue, validate=self.validate, entropy=self.entropy)

    def test_initial_transform_is_default_off_and_preserves_all_other_values(self):
        before = copy.deepcopy(self.document)
        changed, key, report = self.prepare()
        self.assertEqual(self.document, before)
        env = renewal.function_env(changed)
        self.assertEqual(key, '2' * 64)
        for flag in bootstrap.FLAGS:
            self.assertEqual(env[flag], 'false')
        self.assertEqual(changed['services']['auth'], before['services']['auth'])
        self.assertEqual(env['RESEND_API_KEY'], 'SYNTHETIC-MAIL')
        self.assertEqual(env['OTHER'], 'unchanged')
        self.assertEqual(self.issue.call_count, 2)
        self.assertEqual(self.validate.call_count, 2)
        self.entropy.assert_called_once_with(32)
        self.assertNotIn(key, json.dumps(report))
        self.assertNotIn('SYNTHETIC-NOT-A-JWT:', json.dumps(report))

    def test_existing_credential_names_even_empty_refuse_before_generation(self):
        for name in [renewal.PAIR, renewal.ENCRYPTION]:
            self.document['services']['functions']['environment'][name] = ''
            with self.assertRaisesRegex(ValueError, 'EXISTING_CREDENTIAL'):
                self.prepare()
            self.document['services']['functions']['environment'].pop(name)
        self.issue.assert_not_called()
        self.entropy.assert_not_called()

    def test_any_activation_wrong_namespace_or_binding_refuses_generation(self):
        for key, value in [('APP_ENV', 'cloud-test'), ('APP_URL', 'https://bad.invalid'),
                           ('CUSTOMER_ACCOUNT_DELETION_BACKEND_URL', 'http://bad:8000'), *[(flag, 'true') for flag in bootstrap.FLAGS]]:
            original = copy.deepcopy(self.document)
            self.document['services']['functions']['environment'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.prepare()
            self.document = original
        self.issue.assert_not_called()

    def test_sign_or_validation_failure_never_generates_key_or_stages(self):
        self.issue.side_effect = [token(renewal.CLIENTS['ios'], NOW), RuntimeError('SYNTHETIC_SIGN_FAILURE')]
        with self.assertRaises(RuntimeError):
            self.stage()
        self.entropy.assert_not_called()
        self.assertFalse((self.root / 'bootstrap').exists())
        self.issue.side_effect = lambda config, now: token(config['clientId'], now)
        self.validate.side_effect = ValueError('SYNTHETIC_INVALID_SIGNATURE')
        with self.assertRaises(ValueError):
            self.stage()
        self.entropy.assert_not_called()

    def test_unexpected_lifetime_or_invalid_key_is_rejected(self):
        self.validate.side_effect = None
        self.validate.return_value = {'iat': NOW, 'exp': NOW + 10}
        with self.assertRaisesRegex(ValueError, 'LIFETIME'):
            self.prepare()
        self.entropy.assert_not_called()
        self.validate.side_effect = validate
        self.entropy.return_value = 'bad'
        with self.assertRaisesRegex(ValueError, 'ENCRYPTION_MATERIAL'):
            self.prepare()

    def test_stage_is_exclusive_private_and_does_not_replace_live(self):
        self.stage()
        directory = self.root / 'bootstrap'
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(set(x.name for x in directory.iterdir()), set(bootstrap.STAGE_NAMES))
        for path in directory.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        scope = json.loads((directory / 'scope.json').read_text())
        self.assertEqual(scope['status'], 'STAGED_DEFAULT_OFF_NOT_INSTALLED')
        self.assertEqual(scope['candidateSha256'], hashlib.sha256((directory / 'staged.override.json').read_bytes()).hexdigest())
        self.assertEqual(scope['encryptionKeySha256'], hashlib.sha256((directory / 'encryption-v1').read_bytes()).hexdigest())
        self.assertEqual((directory / 'original.override.json').read_bytes(), json.dumps(self.document).encode())
        self.issue.reset_mock()
        with self.assertRaisesRegex(ValueError, 'EXISTING_BOOTSTRAP'):
            self.stage()
        self.issue.assert_not_called()

    def test_partial_staging_blocks_retry_without_overwriting(self):
        original = renewal.signing.atomic
        def fail_candidate(path, raw):
            if pathlib.Path(path).name == 'staged.override.json':
                raise OSError('SYNTHETIC_DISK_FAILURE')
            original(path, raw)
        with patch.object(renewal.signing, 'atomic', side_effect=fail_candidate), self.assertRaises(OSError):
            self.stage()
        directory = self.root / 'bootstrap'
        self.assertEqual(set(x.name for x in directory.iterdir()), {'original.override.json'})
        with self.assertRaisesRegex(ValueError, 'EXISTING_BOOTSTRAP'):
            self.stage()

    def test_unsafe_or_symlink_parent_blocks_staging(self):
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):
            self.stage()
        self.root.chmod(0o700)
        link = self.root / 'parent-link'
        link.symlink_to(self.root)
        with self.assertRaises(ValueError):
            bootstrap.stage({**self.config, 'stateDirectory': str(link / 'state')}, b'{}', NOW, issue=self.issue, validate=self.validate, entropy=self.entropy)
        self.issue.assert_not_called()

    def recovered(self):
        changed, key, _ = self.prepare()
        installed = json.loads(pathlib.Path(__file__).with_name('apple-cleanup-renewal.config.example.json').read_text())
        contents = dict(zip(recovery.SELECTED, [json.dumps(changed).encode(), json.dumps(installed).encode(), key.encode()]))
        expected = {path: hashlib.sha256(raw).hexdigest() for path, raw in contents.items()}
        receipt = {'policy': 'daily-v1', 'provider': 'b2', 'object_snapshot': 'a' * 64,
                   'captured_at': renewal.signing.stamp(NOW - 100), 'verified_at': renewal.signing.stamp(NOW - 50),
                   **{k: True for k in ['encrypted_offsite', 'database_restored', 'storage_restored', 'functions_restored', 'configuration_restored', 'isolated_target_removed']}}
        return contents, expected, receipt

    def verify(self, contents, expected, receipt, reader=None):
        reader = reader or (lambda snapshot, path: contents[path])
        return recovery.verify(receipt, expected, NOW - 200, NOW, reader, ram_parent=self.root)

    def test_exact_selected_snapshot_files_match_and_plaintext_removed(self):
        contents, expected, receipt = self.recovered()
        reader = Mock(side_effect=lambda snapshot, path: contents[path])
        report = self.verify(contents, expected, receipt, reader)
        self.assertEqual(reader.call_count, 3)
        self.assertEqual({x.args[1] for x in reader.call_args_list}, set(recovery.SELECTED))
        self.assertEqual({x.args[0] for x in reader.call_args_list}, {'a' * 64})
        self.assertTrue(report['sameEncryptionKey'])
        self.assertTrue(report['plaintextTargetRemoved'])
        self.assertFalse((self.root / recovery.TARGET_NAME).exists())
        for raw in contents.values():
            self.assertNotIn(raw.decode(), json.dumps(report))

    def test_pre_setup_stale_future_wrong_provider_or_snapshot_refuse_reader(self):
        contents, expected, receipt = self.recovered()
        for change in [{'captured_at': renewal.signing.stamp(NOW - 300)}, {'captured_at': renewal.signing.stamp(NOW - 27 * 3600)},
                       {'verified_at': renewal.signing.stamp(NOW + 1)}, {'provider': 'r2-transition'}, {'object_snapshot': 'latest'},
                       {'object_snapshot': '../../private'}, {'configuration_restored': False}]:
            reader = Mock()
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.verify(contents, expected, {**receipt, **change}, reader)
            reader.assert_not_called()
            self.assertFalse((self.root / recovery.TARGET_NAME).exists())

    def test_extra_manifest_paths_or_bad_hashes_refuse_reader(self):
        contents, expected, receipt = self.recovered()
        for bad in [{**expected, '/etc/shadow': 'b' * 64}, {**expected, next(iter(expected)): 'bad'}, {}]:
            reader = Mock()
            with self.assertRaisesRegex(ValueError, 'UNREVIEWED_RECOVERY_MANIFEST'):
                self.verify(contents, bad, receipt, reader)
            reader.assert_not_called()

    def test_existing_target_is_preserved_and_no_reader_runs(self):
        contents, expected, receipt = self.recovered()
        target = self.root / recovery.TARGET_NAME
        target.mkdir()
        (target / 'owner-file').write_text('preserve')
        reader = Mock()
        with self.assertRaises(FileExistsError):
            self.verify(contents, expected, receipt, reader)
        reader.assert_not_called()
        self.assertEqual((target / 'owner-file').read_text(), 'preserve')

    def test_failed_read_or_hash_mismatch_cleans_only_owned_plaintext(self):
        contents, expected, receipt = self.recovered()
        for failure in ['read', 'hash', 'size']:
            calls = 0
            def reader(snapshot, path):
                nonlocal calls
                calls += 1
                if calls == 2:
                    if failure == 'read':
                        raise RuntimeError('SYNTHETIC_READER_FAILURE')
                    return b'x' if failure == 'hash' else b'x' * (recovery.MAX_FILE + 1)
                return contents[path]
            with self.subTest(failure=failure), self.assertRaises((ValueError, RuntimeError)):
                self.verify(contents, expected, receipt, reader)
            self.assertFalse((self.root / recovery.TARGET_NAME).exists())

    def test_inconsistent_recovery_key_fails_and_cleans_target(self):
        contents, expected, receipt = self.recovered()
        path = list(recovery.SELECTED)[-1]
        contents[path] = b'3' * 64
        expected[path] = hashlib.sha256(contents[path]).hexdigest()
        with self.assertRaisesRegex(ValueError, 'KEY_BINDING_MISMATCH'):
            self.verify(contents, expected, receipt)
        self.assertFalse((self.root / recovery.TARGET_NAME).exists())

    def test_cleanup_refuses_unrecognized_file_in_exclusive_target(self):
        contents, expected, receipt = self.recovered()
        def reader(snapshot, path):
            (self.root / recovery.TARGET_NAME / 'unrelated-owner-file').write_text('preserve')
            return contents[path]
        with self.assertRaisesRegex(RuntimeError, 'CLEANUP_REQUIRES_REVIEW'):
            self.verify(contents, expected, receipt, reader)
        self.assertEqual((self.root / recovery.TARGET_NAME / 'unrelated-owner-file').read_text(), 'preserve')

    def test_modules_have_no_implicit_cli_or_real_dependency_generation(self):
        for module in [bootstrap, recovery]:
            source = pathlib.Path(module.__file__).read_text()
            for forbidden in ['subprocess.', 'token_hex(', 'urandom(', 'docker run', "__name__ == '__main__'"]:
                self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
