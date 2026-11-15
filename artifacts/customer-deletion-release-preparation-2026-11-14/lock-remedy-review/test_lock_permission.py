import contextlib
import errno
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('lock_permission', pathlib.Path(__file__).with_name('lock_permission.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PermissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent = pathlib.Path(self.temp.name).resolve() / 'private-state'
        self.parent.mkdir(mode=0o700)
        self.lock = self.parent / 'backend.lock'
        self.lock.touch(mode=0o644)
        self.lock.chmod(0o644)

    def run_check(self):
        return module.conditional_tighten(self.lock, expected_uid=os.geteuid())

    def test_root_actor_fixture_0644_and_0640_tighten_same_empty_inode(self):
        for mode in [0o644, 0o640]:
            self.lock.chmod(mode)
            before = self.lock.stat()
            result = self.run_check()
            after = self.lock.stat()
            self.assertEqual(result['status'], 'TIGHTENED_SAME_INODE')
            self.assertEqual((before.st_dev, before.st_ino, before.st_uid, before.st_gid), (after.st_dev, after.st_ino, after.st_uid, after.st_gid))
            self.assertEqual(after.st_mode & 0o777, 0o600)
            self.assertEqual(after.st_size, 0)

    def test_secure_file_is_noop_without_fchmod(self):
        self.lock.chmod(0o600)
        with patch.object(module.os, 'fchmod') as chmod:
            result = self.run_check()
        self.assertEqual(result['status'], 'ALREADY_SECURE_NOOP')
        chmod.assert_not_called()

    def test_other_modes_never_change(self):
        for mode in [0o666, 0o660, 0o400, 0o700, 0o000]:
            self.lock.chmod(mode)
            result = self.run_check()
            self.assertEqual(result['status'], 'STOP_FILE_INVARIANTS')
            self.assertEqual(self.lock.stat().st_mode & 0o777, mode)

    def test_wrong_file_owner_never_changes(self):
        # Model a wrong file owner while retaining a legitimate private parent.
        actual = module.os.stat
        def stat_call(*args, **kwargs):
            info = actual(*args, **kwargs)
            if args[0] == self.lock.name:
                info = types.SimpleNamespace(**{name: getattr(info, name) for name in ['st_uid', 'st_gid', 'st_mode', 'st_nlink', 'st_size', 'st_dev', 'st_ino']})
                info.st_uid += 1
            return info
        with patch.object(module.os, 'stat', side_effect=stat_call):
            self.assertEqual(self.run_check()['status'], 'STOP_FILE_INVARIANTS')
        self.assertEqual(self.lock.stat().st_mode & 0o777, 0o644)

    def test_wrong_parent_owner_or_mode_never_opens_file(self):
        for mode in [0o755, 0o750, 0o770]:
            self.parent.chmod(mode)
            with patch.object(module.os, 'open') as opened:
                self.assertEqual(self.run_check()['status'], 'STOP_PARENT')
            opened.assert_not_called()
        self.parent.chmod(0o700)
        self.assertEqual(module.conditional_tighten(self.lock, expected_uid=os.geteuid() + 1)['status'], 'STOP_PARENT')

    def test_nonempty_file_contents_never_read_or_changed(self):
        self.lock.write_bytes(b'SYNTHETIC-PRESERVE')
        with patch.object(pathlib.Path, 'read_bytes', side_effect=AssertionError('READ_FORBIDDEN')):
            result = self.run_check()
        self.assertEqual(result['status'], 'STOP_FILE_INVARIANTS')
        self.assertEqual(self.lock.read_bytes(), b'SYNTHETIC-PRESERVE')
        self.assertNotIn('SYNTHETIC-PRESERVE', json.dumps(result))

    def test_symlink_and_hardlink_refused_without_mutation(self):
        original = self.parent / 'original'
        self.lock.rename(original)
        self.lock.symlink_to(original)
        self.assertEqual(self.run_check()['status'], 'STOP_FILE_INVARIANTS')
        self.lock.unlink()
        os.link(original, self.lock)
        self.assertEqual(self.run_check()['status'], 'STOP_FILE_INVARIANTS')
        self.assertEqual(original.stat().st_mode & 0o777, 0o644)

    def test_directory_and_fifo_are_refused_before_open(self):
        self.lock.unlink()
        self.lock.mkdir(mode=0o700)
        self.assertEqual(self.run_check()['status'], 'STOP_FILE_INVARIANTS')
        self.lock.rmdir()
        os.mkfifo(self.lock, 0o600)
        self.assertEqual(self.run_check()['status'], 'STOP_FILE_INVARIANTS')

    def test_busy_lock_does_not_wait_or_change(self):
        with patch.object(module.fcntl, 'flock', side_effect=BlockingIOError(errno.EAGAIN, 'synthetic busy')):
            self.assertEqual(self.run_check()['status'], 'STOP_BUSY')
        self.assertEqual(self.lock.stat().st_mode & 0o777, 0o644)

    def test_race_in_file_identity_fails_before_chmod(self):
        actual = module.os.fstat
        calls = 0
        def changed(fd):
            nonlocal calls
            calls += 1
            info = actual(fd)
            if calls == 2:
                info = types.SimpleNamespace(**{name: getattr(info, name) for name in ['st_uid', 'st_gid', 'st_mode', 'st_nlink', 'st_size', 'st_dev', 'st_ino']})
                info.st_ino += 1
            return info
        with patch.object(module.os, 'fstat', side_effect=changed), patch.object(module.os, 'fchmod') as chmod:
            self.assertEqual(self.run_check()['status'], 'STOP_OPEN_DRIFT')
            chmod.assert_not_called()

    def test_locked_metadata_drift_fails_before_chmod(self):
        def race(fd, action):
            self.lock.write_bytes(b'changed')
        with patch.object(module.fcntl, 'flock', side_effect=race), patch.object(module.os, 'fchmod') as chmod:
            self.assertEqual(self.run_check()['status'], 'STOP_LOCKED_DRIFT')
            chmod.assert_not_called()

    def test_fchmod_failure_never_claims_success(self):
        with patch.object(module.os, 'fchmod', side_effect=PermissionError('synthetic')):
            with self.assertRaises(PermissionError):
                self.run_check()
        self.assertEqual(self.lock.stat().st_mode & 0o777, 0o644)

    def test_wrong_host_cli_refuses_before_file_metadata(self):
        with patch('sys.argv', ['-']), patch.object(module.os, 'geteuid', return_value=0), patch.object(module.os, 'uname', return_value=types.SimpleNamespace(nodename='wrong')), patch.object(module, 'conditional_tighten') as call:
            with self.assertRaises(ValueError):
                module.main()
            call.assert_not_called()

    def test_safe_cli_output_is_metadata_only(self):
        output = io.StringIO()
        with patch('sys.argv', ['-']), patch.object(module.os, 'geteuid', return_value=0), patch.object(module.os, 'uname', return_value=types.SimpleNamespace(nodename='srv1073968')), patch.object(module, 'conditional_tighten', return_value={'status': 'ALREADY_SECURE_NOOP', 'contentsRead': False}) as call, contextlib.redirect_stdout(output):
            self.assertEqual(module.main(), 0)
        call.assert_called_once_with(module.LOCK)
        self.assertFalse(json.loads(output.getvalue())['contentsRead'])


if __name__ == '__main__':
    unittest.main()
