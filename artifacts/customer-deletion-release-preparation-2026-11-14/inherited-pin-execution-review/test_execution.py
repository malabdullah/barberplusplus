import base64
import copy
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).parent
def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result
m = module('run_setup'); transfer = module('transfer_public')
SENTINEL = 'SYNTHETIC_PRIVATE_NEVER_LOG'


class ExecutionTests(unittest.TestCase):
    def test_ten_public_sources_match_plan_and_embedded_payload(self):
        plan = json.loads((ROOT.parent / 'inherited-pin-setup-review/commands.json').read_text())
        self.assertEqual(m.HASHES, plan['publicPayload']['files']); self.assertEqual(m.INSTALL, plan['installMap'])
        self.assertEqual(m.HASHES, transfer.HASHES); self.assertEqual(len(m.HASHES), 10)
        for name, encoded in transfer.PAYLOAD.items():
            self.assertEqual(hashlib.sha256(base64.b64decode(encoded, validate=True)).hexdigest(), m.HASHES[name])

    def test_real_secure_read_tolerates_atime_only_with_mock_root_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory).resolve() / 'synthetic'; path.write_bytes(SENTINEL.encode()); path.chmod(0o600)
            info = path.stat()
            def metadata(atime, mtime=info.st_mtime_ns):
                fields = {k: getattr(info, k) for k in ('st_dev','st_ino','st_gid','st_mode','st_nlink','st_size','st_ctime_ns')}
                return types.SimpleNamespace(**fields, st_uid=0, st_mtime_ns=mtime, st_atime_ns=atime)
            with patch.object(m.os, 'fstat', side_effect=[metadata(1), metadata(2)]), patch.object(pathlib.Path, 'lstat', return_value=metadata(3)):
                self.assertEqual(m.secure(path), SENTINEL.encode())
            with patch.object(m.os, 'fstat', side_effect=[metadata(1), metadata(2, info.st_mtime_ns + 1)]), patch.object(pathlib.Path, 'lstat', return_value=metadata(3)):
                with self.assertRaisesRegex(ValueError, 'SOURCE_READ_DRIFT'): m.secure(path)

    def test_stable_runtime_excludes_rotating_logs_preserves_meaningful_fields(self):
        before = [{'Name':'/functions','Id':'one','Image':'image','State':{'StartedAt':'start','Running':True,'Health':{'Status':'healthy','Log':[1]}},'Config':{'Env':['PRIVATE='+SENTINEL], 'Labels':{'com.docker.compose.config-hash':'a'}}}]
        after = copy.deepcopy(before); after[0]['State']['Health']['Log'] = [2]
        self.assertEqual(m.stable_runtime(before), m.stable_runtime(after))
        for key, value in [('Id','two'),('Image','changed')]:
            changed = copy.deepcopy(after); changed[0][key] = value
            self.assertNotEqual(m.stable_runtime(before), m.stable_runtime(changed))
        for key, value in [('StartedAt','later'), ('Running',False)]:
            changed = copy.deepcopy(after); changed[0]['State'][key] = value
            self.assertNotEqual(m.stable_runtime(before), m.stable_runtime(changed))
        changed = copy.deepcopy(after); changed[0]['Config']['Env'].append('NEW=unexpected')
        self.assertNotEqual(m.stable_runtime(before),m.stable_runtime(changed))

    def test_replace_failure_after_rename_recognizes_candidate_and_unknown_stops(self):
        self.assertEqual(m.replacement_state(b'original', b'original', b'candidate'), 'ORIGINAL')
        self.assertEqual(m.replacement_state(b'candidate', b'original', b'candidate'), 'CANDIDATE')
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_ATOMIC_REPLACEMENT_STATE'):
            m.replacement_state(SENTINEL.encode(), b'original', b'candidate')

    def test_partial_issuance_and_entropy_attempts_are_recorded_without_values(self):
        safe = copy.deepcopy(m.SAFE)
        signer = Mock(side_effect=[SENTINEL, RuntimeError('synthetic failure')])
        entropy_fn = Mock(side_effect=RuntimeError('synthetic entropy failure'))
        issue, entropy = m.tracked_generation(signer, entropy_fn, safe)
        self.assertEqual(issue({}, 1), SENTINEL)
        with self.assertRaises(RuntimeError): issue({}, 1)
        with self.assertRaises(RuntimeError): entropy(32)
        self.assertEqual(safe['credentialIssuanceCalls'], 2); self.assertEqual(safe['credentialIssuanceCompleted'], 1)
        self.assertEqual(safe['entropyCalls'], 1); self.assertEqual(safe['entropyCompleted'], 0)
        self.assertNotIn(SENTINEL, json.dumps(safe))

    def test_deadlines_are_bound_to_activation_not_import_time(self):
        activation = 1794644000
        env = dict(zip(('BARBER_SETUP_ACTIVATED_UTC','BARBER_SETUP_STOP_UTC','BARBER_SETUP_HARD_UTC'), map(str, (activation, activation+2700, activation+3600))))
        self.assertEqual(m.access_deadlines(env, activation+2400), (activation, activation+2700, activation+3600))
        for now in (activation-1, activation+2700, activation+3600):
            with self.assertRaises(ValueError): m.access_deadlines(env, now)
        with self.assertRaises(ValueError): m.access_deadlines({**env, 'BARBER_SETUP_HARD_UTC':str(activation+7200)}, activation+1)
        with self.assertRaises(ValueError): m.access_deadlines({}, activation+1)

    def test_commands_stop_at45_recovery_caps_at60_without_bypass(self):
        fake = Mock(return_value=types.SimpleNamespace(returncode=0,stdout=b'safe'))
        with patch.object(m,'DEADLINES',(100,2800,3700)), patch.object(m.time,'time',return_value=2795), patch.object(m.subprocess,'run',fake):
            self.assertEqual(m.command(['synthetic']),b'safe'); self.assertEqual(fake.call_args.kwargs['timeout'],5)
        with patch.object(m,'DEADLINES',(100,2800,3700)), patch.object(m.time,'time',return_value=3698), patch.object(m.subprocess,'run',fake):
            with self.assertRaisesRegex(ValueError,'WORK_WINDOW_EXPIRED'):m.command(['synthetic'])
            self.assertEqual(m.command(['synthetic'],recovery=True),b'safe'); self.assertEqual(fake.call_args.kwargs['timeout'],2)
        with patch.object(m,'DEADLINES',(100,2800,3700)), patch.object(m.time,'time',return_value=3700), patch.object(m.subprocess,'run',fake):
            with self.assertRaisesRegex(ValueError,'HARD_WINDOW_EXPIRED'):m.command(['synthetic'],recovery=True)

    def test_command_failure_never_includes_stderr_or_secret_text(self):
        fake = Mock(return_value=types.SimpleNamespace(returncode=1,stdout=SENTINEL.encode(),stderr=SENTINEL.encode()))
        with patch.object(m,'DEADLINES',(100,2800,3700)), patch.object(m.time,'time',return_value=1000), patch.object(m.subprocess,'run',fake):
            with self.assertRaisesRegex(ValueError,'^COMMAND_FAILED$'):m.command(['synthetic'])

    def test_fixed_cli_root_guards_prevent_any_local_production_io(self):
        with patch.object(m.os,'geteuid',return_value=1), patch.object(m,'secure')as reader, patch.object(m,'command')as runner:
            with self.assertRaises(ValueError):m.setup()
            reader.assert_not_called(); runner.assert_not_called()
        with patch.object(transfer.os,'geteuid',return_value=1), patch.object(transfer.os,'open')as writer:
            with self.assertRaises(ValueError):transfer.transfer()
            writer.assert_not_called()

    def test_new_timer_scope_and_original_preservation_are_exact(self):
        self.assertEqual(m.TIMERS, ('barber-apple-cleanup-renewal.timer','barber-apple-cleanup-monitor.timer'))
        self.assertEqual(m.EXISTING, ('barber-apple-renewal.timer','barber-backup-daily.timer'))
        source = (ROOT/'run_setup.py').read_text()
        self.assertIn("command(['systemctl', 'disable', '--now', *TIMERS], recovery=True)",source)
        self.assertIn("signing.atomic(ACTIVE, original); host.activate(ACTIVE)",source)
        self.assertIn("stable_runtime(final) == stable_runtime(after)",source)


if __name__=='__main__':unittest.main()
