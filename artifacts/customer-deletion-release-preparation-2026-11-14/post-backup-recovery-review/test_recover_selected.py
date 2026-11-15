"""Local fake receipts/readers + disposable file/pipe tests; no production I/O."""
import copy
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / 'ops/auth'))
sys.path.insert(0, str(ROOT / 'ops/release'))
import apple_cleanup_recovery as verifier
import apple_cleanup_renewal as renewal
import backup_policy as policy

spec = importlib.util.spec_from_file_location('selected_executor', HERE / 'recover_selected.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SENTINEL = 'SYNTHETIC_PRIVATE_VALUE_MUST_NOT_ESCAPE'


def packed(value):
    return json.dumps(value, sort_keys=True).encode()


def stamp(value):
    return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat()


class FakeHost:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix='barber-selected-recovery-fake-')
        self.ram = pathlib.Path(self.temp.name)
        self.target = self.ram / m.TARGET.name
        self.lease_path = self.ram / m.LEASE.name
        self.modules = {'apple_cleanup_renewal': renewal}
        self.activation = m.INSTALL + 4500
        self.clock = m.INSTALL + 5000
        self.stop, self.hard = self.activation + 2700, self.activation + 3600
        self.metadata_commands = self.restic_commands = 0
        self.lease_created = self.lease_removed = False
        self.target_absent_after_close = False
        self.stability_failure = False
        self.overrides = {}
        self.calls = []
        system = '7500000000000000000'
        env = {'APP_ENV': 'production', 'APP_URL': 'https://www.barberplusplus.com',
               'SUPABASE_URL': 'http://api-gw:8000', 'CUSTOMER_PUBLIC_API_URL': 'https://srv1073968.hstgr.cloud',
               'CUSTOMER_ACCOUNT_DELETION_BACKEND_URL': 'http://api-gw:8000',
               'CUSTOMER_APPLE_ENCRYPTION_KEY': 'a' * 64, 'UNRELATED_EXISTING_SECRET': SENTINEL,
               **{name: 'false' for name in m.FLAGS}}
        self.raw = {
            m.BACKUP: packed({'enabled': True, 'host': 'srv1073968', 'bucket': m.BUCKET,
                             'endpoint': m.ENDPOINT, 'prefix': 'production/v1/', 'systemId': system,
                             'resticSha256': m.RESTIC_SHA256}),
            m.B2: packed({'endpoint': m.ENDPOINT, 'bucket_name': m.BUCKET, 'name_prefix': 'production/v1/',
                         'key_id': 'FAKEKEY', 'application_key': SENTINEL}),
            m.PASSWORD: b'b' * 64,
            m.BINDING: packed({'systemId': system, 'databasePrefix': 'production/v1/pg17-' + system + '/',
                              'objectPrefix': 'production/v1/objects-v1/', 'objectRepositoryId': 'c' * 64}),
            m.OVERRIDE: packed({'services': {'functions': {'environment': env}}}),
            m.CONFIG: packed(m.CONFIG_MODEL), m.KEY_COPY: b'a' * 64,
            m.RECEIPT: packed({'policy': 'daily-v1', 'provider': 'b2', 'system_id': system,
                              'captured_at': stamp(m.INSTALL + 3600), 'verified_at': stamp(m.INSTALL + 3700),
                              'base_backup': 'base_FAKE', 'object_snapshot': 'd' * 64, 'recovery_lsn': '0/FAKE',
                              'repository': 'private B2 production/v1/ repositories', 'restore_seconds': 42,
                              **{k: True for k in ('encrypted_offsite', 'database_restored', 'storage_restored',
                                                  'functions_restored', 'configuration_restored', 'isolated_target_removed')}}),
        }
        self.expected()
        self.remote_config = {'id': 'c' * 64, 'version': 2}
        self.metadata_system = system
        self.inject_unknown = False

    def expected(self):
        self.raw[m.EXPECTED] = packed({'status': 'INSTALLED_DEFAULT_OFF_PENDING_REAL_BACKUP_PROOF',
                                      'source': m.SOURCE, 'installedAtUTC': stamp(m.INSTALL),
                                      'expected': {path: m.digest(self.raw[path]) for path in m.SELECTED}})

    def change(self, path, **updates):
        self.raw[path] = packed({**m.decode(self.raw[path]), **updates})

    def now(self): return self.clock
    def open(self): return policy, verifier
    def private(self, path):
        m.require(path in m.PRIVATE)
        return self.raw[path]
    def metadata(self): return m.Host.metadata(self)
    def restic(self, *args): return m.Host.restic(self, *args)
    def process(self, args, environment, limit, stop):
        self.calls.append(tuple(args))
        m.require(stop == self.stop)
        if args == m.INSPECT:
            return packed({'image': m.DB_IMAGE, 'running': True, 'healthy': True})
        if args == m.SYSTEM:
            return packed({'systemId': self.metadata_system})
        m.require(environment['RESTIC_REPOSITORY'] == m.REPOSITORY
                  and environment['RESTIC_PASSWORD_FILE'] == m.PASSWORD
                  and not any(key in environment for key in ('PGPASSWORD', 'HTTP_PROXY', 'HTTPS_PROXY', 'WALG_LIBSODIUM_KEY_PATH')))
        if args == m.RESTIC_BASE + ['cat', 'config']:
            return packed(self.remote_config)
        m.require(args[:3] == m.RESTIC_BASE and args[3] == 'dump' and args[4] == 'd' * 64)
        path = args[5]
        if self.inject_unknown:
            (self.target / 'unknown-preserve').write_text('synthetic unknown file')
        value = self.overrides.get(path, self.raw[path])
        if isinstance(value, BaseException): raise value
        return value
    def lease(self, _raw):
        m.require(not self.target.exists())
        with self.lease_path.open('xb') as output: output.write(b'fake-exclusive-lease')
        self.lease_created = True
    def verify(self, module, receipt, expected, reader):
        return module.verify(receipt, expected, m.INSTALL, self.now(), reader, ram_parent=self.ram)
    def stable(self): m.require(not self.stability_failure)
    def close(self):
        if self.lease_created:
            m.require(not self.target.exists())
            self.lease_path.unlink()
            self.lease_removed = True
            self.target_absent_after_close = not self.target.exists()


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.h = FakeHost()
        self.addCleanup(self.h.temp.cleanup)  # Only this test's new disposable tree.
        self.patcher = mock.patch.object(m, 'bounded_command', self.h.process)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
    def execute(self):
        value = m.execute(self.h)
        self.assertNotIn(SENTINEL, json.dumps(value))
        self.assertFalse(value['backupOrConfigurationOrBusinessWrites'])
        self.assertFalse(value['credentialExported'])
        return value
    def blocked_before_restic(self):
        result = self.execute()
        self.assertEqual(result['status'], 'STOP_SELECTED_RECOVERY_UNAVAILABLE')
        self.assertEqual(self.h.restic_commands, 0)
        self.assertFalse(self.h.lease_created)

    def test_success_uses_original_policy_real_verifier_exact_snapshot_and_four_read_commands(self):
        with mock.patch.object(policy, 'verify_backup_readiness', wraps=policy.verify_backup_readiness) as original:
            result = self.execute()
            original.assert_called_once()
        self.assertEqual(result['status'], 'SELECTED_RECOVERY_VERIFIED')
        self.assertEqual((result['selectedFiles'], result['resticCommandsAttempted'], result['metadataCommandsAttempted']), (3, 4, 2))
        self.assertTrue(result['sameEncryptionKey'] and result['temporaryLeaseRemoved'] and result['plaintextTargetRemoved'])
        self.assertFalse(self.h.target.exists() or self.h.lease_path.exists())
        self.assertEqual(self.h.calls[2], tuple(m.RESTIC_BASE + ['cat', 'config']))
        self.assertEqual([x[-1] for x in self.h.calls[3:]], list(m.SELECTED))
    def test_pre_install_receipt_stops(self):
        self.h.change(m.RECEIPT, captured_at=stamp(m.INSTALL - 1)); self.blocked_before_restic()
    def test_capture_exactly_at_install_second_also_stops(self):
        self.h.change(m.RECEIPT, captured_at=stamp(m.INSTALL)); self.blocked_before_restic()
    def test_failed_restore_flags_stop(self):
        self.h.change(m.RECEIPT, configuration_restored=False); self.blocked_before_restic()
    def test_future_verification_stops(self):
        self.h.change(m.RECEIPT, verified_at=stamp(self.h.clock + 1)); self.blocked_before_restic()
    def test_stale_receipt_stops(self):
        self.h.clock += 26 * 3600; self.blocked_before_restic()
    def test_transition_or_unknown_provider_stops(self):
        self.h.change(m.RECEIPT, provider='r2-transition'); self.blocked_before_restic()
    def test_unknown_policy_stops(self):
        self.h.change(m.RECEIPT, policy='unknown'); self.blocked_before_restic()
    def test_original_policy_restore_time_cannot_be_bypassed(self):
        self.h.change(m.RECEIPT, restore_seconds=True); self.blocked_before_restic()
    def test_database_identity_drift_stops(self):
        self.h.metadata_system = '7600000000000000000'; self.blocked_before_restic()
    def test_repository_prefix_or_marker_drift_stops(self):
        self.h.change(m.BINDING, objectPrefix='another-prefix/'); self.blocked_before_restic()
    def test_receipt_repository_binding_marker_stops(self):
        self.h.change(m.RECEIPT, repository='other'); self.blocked_before_restic()
    def test_snapshot_latest_or_abbreviated_id_stops(self):
        self.h.change(m.RECEIPT, object_snapshot='latest'); self.blocked_before_restic()
    def test_setup_receipt_source_or_install_time_cannot_be_rebound(self):
        self.h.change(m.EXPECTED, installedAtUTC=stamp(m.INSTALL + 1)); self.blocked_before_restic()
    def test_current_file_hash_drift_stops_before_backup_reads(self):
        self.h.raw[m.KEY_COPY] = b'e' * 64; self.blocked_before_restic()
    def test_same_key_required_even_if_private_expected_hashes_match(self):
        self.h.raw[m.KEY_COPY] = b'e' * 64; self.h.expected(); self.blocked_before_restic()
    def test_exact_public_renewal_configuration_still_required(self):
        self.h.change(m.CONFIG, keyId='OTHERKEY00'); self.h.expected(); self.blocked_before_restic()
    def test_true_deletion_switch_stops(self):
        value = m.decode(self.h.raw[m.OVERRIDE]); value['services']['functions']['environment'][m.FLAGS[0]] = 'true'
        self.h.raw[m.OVERRIDE] = packed(value); self.h.expected(); self.blocked_before_restic()
    def test_credential_endpoint_scope_drift_stops(self):
        self.h.change(m.B2, endpoint='https://unexpected.example'); self.blocked_before_restic()
    def test_invalid_password_or_control_char_credential_stops(self):
        self.h.raw[m.PASSWORD] = b'not-valid'; self.blocked_before_restic()
    def test_remote_repository_mismatch_no_dumps_and_lease_removed(self):
        self.h.remote_config['id'] = 'e' * 64
        result = self.execute(); self.assertEqual(result['status'], 'STOP_SELECTED_RECOVERY_UNAVAILABLE')
        self.assertEqual(self.h.restic_commands, 1); self.assertTrue(self.h.lease_removed)
    def test_missing_dump_cleans_partial_plaintext_without_retry(self):
        self.h.overrides[m.CONFIG] = ValueError(SENTINEL)
        result = self.execute(); self.assertEqual(result['status'], 'STOP_SELECTED_RECOVERY_UNAVAILABLE')
        self.assertEqual(self.h.restic_commands, 3); self.assertFalse(self.h.target.exists()); self.assertTrue(self.h.lease_removed)
        self.assertTrue(result['targetAbsentAfterClose'])
        self.assertFalse(result['plaintextTargetRemoved'])  # Successful-verifier proof remains false.
    def test_hash_mismatch_cleans_partial_plaintext(self):
        self.h.overrides[m.KEY_COPY] = b'e' * 64
        result = self.execute(); self.assertEqual(result['status'], 'STOP_SELECTED_RECOVERY_UNAVAILABLE')
        self.assertFalse(self.h.target.exists()); self.assertTrue(self.h.lease_removed)
    def test_oversized_dump_rejected_by_unchanged_verifier(self):
        self.h.overrides[m.CONFIG] = b'x' * (m.MAX_FILE + 1)
        self.assertEqual(self.execute()['status'], 'STOP_SELECTED_RECOVERY_UNAVAILABLE')
        self.assertFalse(self.h.target.exists()); self.assertEqual(self.h.restic_commands, 3)
    def test_preexisting_target_not_removed_or_retried(self):
        self.h.target.mkdir(); (self.h.target / 'preserve').write_text('own synthetic fixture')
        self.assertEqual(self.execute()['status'], 'STOP_SELECTED_RECOVERY_UNAVAILABLE')
        self.assertTrue((self.h.target / 'preserve').exists()); self.assertEqual(self.h.restic_commands, 0)
    def test_unknown_file_preserved_requires_reconciliation(self):
        self.h.inject_unknown = True
        self.assertEqual(self.execute()['status'], 'STOP_RAM_CLEANUP_REQUIRES_REVIEW')
        self.assertTrue((self.h.target / 'unknown-preserve').exists() and self.h.lease_path.exists())
    def test_preexisting_lease_is_not_replaced_or_removed(self):
        self.h.lease_path.write_bytes(b'preserve-prior-lease')
        self.assertEqual(self.execute()['status'], 'STOP_SELECTED_RECOVERY_UNAVAILABLE')
        self.assertEqual(self.h.lease_path.read_bytes(), b'preserve-prior-lease')
        self.assertFalse(self.h.lease_created); self.assertEqual(self.h.restic_commands, 0)
    def test_source_or_input_drift_after_read_is_not_success(self):
        self.h.stability_failure = True
        self.assertEqual(self.execute()['status'], 'STOP_SELECTED_RECOVERY_UNAVAILABLE')
        self.assertTrue(self.h.lease_removed)
    def test_invalid_extra_restic_operation_or_fifth_read_refused(self):
        for op, snapshot, path in [('snapshots', None, None), ('dump', 'latest', m.OVERRIDE)]:
            with self.assertRaises(ValueError): m.Host.restic(self.h, op, snapshot, path, {})
        self.h.restic_commands = 4
        with self.assertRaises(ValueError): m.Host.restic(self.h, 'config', None, None, {})
    def test_json_duplicate_nonobject_and_oversize_refused(self):
        for raw in [b'{"x":1,"x":2}', b'[]', b'x' * (m.MAX_JSON + 1)]:
            with self.assertRaises((ValueError, json.JSONDecodeError)): m.decode(raw)
    def test_activation_deadlines_are_typed_bound_to_original_activation(self):
        a = 1794649081; env = {'BARBER_RECOVERY_ACTIVATED_UTC': str(a), 'BARBER_RECOVERY_STOP_UTC': str(a + 2700), 'BARBER_RECOVERY_HARD_UTC': str(a + 3600)}
        self.assertEqual(m.deadlines(env, a + 1), (a, a + 2700, a + 3600))
        for now in (a - 1, a + 2700, a + 3600):
            with self.assertRaises(ValueError): m.deadlines(env, now)
        with self.assertRaises(ValueError): m.deadlines({**env, 'BARBER_RECOVERY_HARD_UTC': str(a + 7200)}, a + 1)
    def test_production_host_guard_precedes_all_io(self):
        with mock.patch.object(m.os, 'geteuid', return_value=0), mock.patch.object(m.os, 'uname', return_value=type('Name', (), {'nodename':'not-the-approved-host'})()), mock.patch.object(m.os, 'open') as opener:
            with self.assertRaises(ValueError): m.Host().open()
            opener.assert_not_called()
    def test_existing_public_verifier_helpers_and_policy_hashes_unchanged(self):
        for name, digest in m.MODULE_HASHES.items():
            path = ROOT / ('ops/release' if name == 'backup_policy' else 'ops/auth') / (name + '.py')
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
        self.assertEqual(m.CONFIG_MODEL, json.loads((ROOT / 'ops/auth/apple-cleanup-renewal.config.example.json').read_text()))
    def test_fixed_sql_is_metadata_read_only_and_no_business_or_secret_table(self):
        self.assertIn('read only', m.SYSTEM_SQL)
        self.assertIn('pg_control_system()', m.SYSTEM_SQL)
        self.assertNotRegex(m.SYSTEM_SQL, r'(?i)\b(insert|update|delete|create|alter|drop|auth|bookings|customers)\b')


class PipeTests(unittest.TestCase):
    # Real new LOCAL Python child processes only; no Docker/network/production path.
    def test_bounded_pipe_returns_small_bytes(self):
        self.assertEqual(m.bounded_command([sys.executable,'-c',"print('ok')"], {}, 32, time.time()+5), b'ok\n')
    def test_bounded_pipe_kills_on_oversize_without_forwarding_stderr(self):
        with self.assertRaises(ValueError) as error:
            m.bounded_command([sys.executable,'-c',"import sys;sys.stderr.write('PRIVATE_SENTINEL');sys.stdout.write('x'*10000)"], {}, 32, time.time()+5)
        self.assertNotIn('PRIVATE_SENTINEL', str(error.exception))
    def test_bounded_pipe_kills_on_deadline(self):
        start = time.monotonic()
        with self.assertRaises(ValueError): m.bounded_command([sys.executable,'-c','import time;time.sleep(30)'], {}, 32, time.time()+0.1)
        self.assertLess(time.monotonic()-start, 3)


class LeaseTests(unittest.TestCase):
    # Exercise real close() only on this class's NEW disposable local lease paths.
    def fixture(self):
        folder = tempfile.TemporaryDirectory(prefix='barber-lease-identity-fake-')
        self.addCleanup(folder.cleanup)
        base = pathlib.Path(folder.name)
        target, lease = base / 'target', base / 'lease'
        lease.write_bytes(b'synthetic-owned-lease'); lease.chmod(0o600)
        h = m.Host(); h.lease_created = True; h.lease_raw = lease.read_bytes(); h.lease_info = lease.stat()
        return h, target, lease
    def test_only_exact_owned_lease_is_removed(self):
        h, target, lease = self.fixture()
        with mock.patch.object(m,'TARGET',target), mock.patch.object(m,'LEASE',lease): h.close()
        self.assertFalse(lease.exists()); self.assertTrue(h.lease_removed and h.target_absent_after_close)
    def test_changed_lease_identity_is_preserved(self):
        h, target, lease = self.fixture(); lease.unlink(); lease.write_bytes(b'different-lease-preserve')
        with mock.patch.object(m,'TARGET',target), mock.patch.object(m,'LEASE',lease):
            with self.assertRaises(ValueError): h.close()
        self.assertEqual(lease.read_bytes(),b'different-lease-preserve'); self.assertFalse(h.lease_removed)
    def test_unknown_remaining_target_preserves_lease_for_reconciliation(self):
        h, target, lease = self.fixture(); target.mkdir(); (target/'unknown').write_text('preserve')
        with mock.patch.object(m,'TARGET',target), mock.patch.object(m,'LEASE',lease):
            with self.assertRaises(ValueError): h.close()
        self.assertTrue(lease.exists() and (target/'unknown').exists()); self.assertFalse(h.lease_removed)


if __name__ == '__main__': unittest.main()
