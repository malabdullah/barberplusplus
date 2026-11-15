"""Local launch/approval/output guards only. No actual SSH, credentials or network."""
import importlib.util
import json
import pathlib
import sys
import tempfile
import time
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('selected_launcher', HERE / 'run_once.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def window():
    a = 1794701800
    return {'manifestSHA256': 'a' * 64, 'directHumanApprovalVerified': True,
            'requestId': 'call_FUTURE_SYNTHETIC_APPROVAL', 'messageId': '00000000-0000-0000-0000-000000000000',
            'target': '72.61.164.64', 'sourceIPv4': '31.203.237.4',
            'activationEpoch': a, 'stopEpoch': a + 2700, 'hardEpoch': a + 3600,
            'originalFirewallProfile': 367995, 'temporaryFirewallProfile': 400860,
            'originalRulesVerified': True, 'restorePathVerified': True}


def proof():
    return {**{k: True for k in m.BOOLS}, 'status': 'SELECTED_RECOVERY_VERIFIED',
            'backupOrConfigurationOrBusinessWrites': False, 'credentialExported': False,
            'selectedFiles': 3, 'resticCommandsAttempted': 4, 'metadataCommandsAttempted': 2,
            'receiptAgeSeconds': 60}


class LauncherTests(unittest.TestCase):
    def test_exact_future_window_only(self):
        value = window(); a = value['activationEpoch']
        self.assertEqual(m.window_guard(value, 'a' * 64, a + 1), (a, a + 2700, a + 3600))
    def test_no_extended_future_stale_or_restarted_access_window(self):
        value = window(); a = value['activationEpoch']
        for now in (a - 1, a + 2700, a + 3600):
            with self.assertRaises(ValueError): m.window_guard(value, 'a' * 64, now)
        with self.assertRaises(ValueError): m.window_guard({**value, 'hardEpoch': a + 7200}, 'a' * 64, a + 1)
    def test_wrong_host_profile_approval_or_manifest_stops(self):
        value = window(); now = value['activationEpoch'] + 1
        for key, wrong in [('target','185.97.146.8'), ('temporaryFirewallProfile',394280),
                           ('directHumanApprovalVerified',False), ('originalRulesVerified',False),
                           ('restorePathVerified',False), ('manifestSHA256','b' * 64), ('messageId','-' * 36)]:
            with self.assertRaises(ValueError): m.window_guard({**value,key:wrong}, 'a' * 64, now)
    def test_unknown_extra_or_non_global_source_refused(self):
        value = window(); now = value['activationEpoch'] + 1
        with self.assertRaises(ValueError): m.window_guard({**value,'extra':1}, 'a' * 64, now)
        for ip in ('127.0.0.1','192.0.2.1','::1'):
            with self.assertRaises(ValueError): m.window_guard({**value,'sourceIPv4':ip}, 'a' * 64, now)
    def test_strict_ssh_identity_no_reuse_forwarding_or_shell_interpolation_inputs(self):
        args = m.ssh_command(1794701800,1794704500,1794705400)
        self.assertIn('root@72.61.164.64', args)
        for setting in ('StrictHostKeyChecking=yes','ConnectionAttempts=1','ControlPath=none',
                        'ForwardAgent=no','ForwardX11=no','ClearAllForwardings=yes','BatchMode=yes'):
            self.assertIn(setting,args)
        self.assertEqual(args[-1], 'env BARBER_RECOVERY_ACTIVATED_UTC=1794701800 BARBER_RECOVERY_STOP_UTC=1794704500 BARBER_RECOVERY_HARD_UTC=1794705400 python3 -B -')
    def test_success_requires_all_safe_proofs(self):
        good = proof(); self.assertEqual(m.result_guard(good),good)
        for key in m.BOOLS - {'backupOrConfigurationOrBusinessWrites','credentialExported'}:
            with self.assertRaises(ValueError): m.result_guard({**good,key:False})
    def test_extra_nested_secret_unknown_status_bool_numeric_or_bad_counts_never_escape(self):
        value = proof()
        for bad in ({**value,'secret':'SYNTHETIC_PRIVATE_SENTINEL'}, {**value,'selectedFiles':True},
                    {**value,'resticCommandsAttempted':5}, {**value,'status':'SYNTHETIC_PRIVATE_SENTINEL'},
                    {**value,'credentialExported':True}, {**value,'receiptAgeSeconds':-1}):
            with self.assertRaises(ValueError) as error: m.result_guard(bad)
            self.assertNotIn('SYNTHETIC_PRIVATE_SENTINEL',str(error.exception))
    def test_clean_failure_retains_failure_status_and_reports_actual_absence(self):
        value = proof(); value.update(status='STOP_SELECTED_RECOVERY_UNAVAILABLE', selectedFiles=0,
                                      plaintextTargetRemoved=False, resticCommandsAttempted=3)
        self.assertEqual(m.result_guard(value),value)
        self.assertTrue(value['targetAbsentAfterClose'])
    def test_duplicate_multiple_and_oversize_protocol_refused(self):
        for raw in (b'{"x":1,"x":2}', b'{}{}', b'x' * 16385):
            with self.assertRaises((ValueError,json.JSONDecodeError)): m.decode(raw)
    def test_marker_cannot_be_reused_and_preserves_existing_attempt(self):
        with tempfile.TemporaryDirectory(prefix='barber-one-shot-marker-fake-') as directory:
            path = pathlib.Path(directory) / 'attempt.json'
            m.save_exclusive(path, {'synthetic':True})
            before = path.read_bytes()
            with self.assertRaises(FileExistsError): m.save_exclusive(path, {'synthetic':False})
            self.assertEqual(path.read_bytes(),before)
    def test_transport_local_fake_process_returns_only_typed_safe_result(self):
        script = 'import sys;sys.stdin.buffer.read();print(' + repr(json.dumps(proof())) + ')'
        code, value = m.transport([sys.executable,'-c',script], b'fake source only', time.time()+5)
        self.assertEqual(code,0); self.assertEqual(value,proof())
    def test_transport_local_fake_oversize_stops_without_private_output(self):
        script = "import sys;sys.stdin.buffer.read();sys.stderr.write('PRIVATE_SENTINEL');print('x'*20000)"
        with self.assertRaises(ValueError) as error:
            m.transport([sys.executable,'-c',script], b'fake', time.time()+5)
        self.assertNotIn('PRIVATE_SENTINEL',str(error.exception))
    def test_nonreading_local_fake_child_cannot_block_stdin_beyond_deadline(self):
        start = time.monotonic()
        with self.assertRaises(ValueError):
            m.transport([sys.executable,'-c','import time;time.sleep(30)'], b'x'*65536, time.time()+0.1)
        self.assertLess(time.monotonic()-start,3)


if __name__ == '__main__': unittest.main()
