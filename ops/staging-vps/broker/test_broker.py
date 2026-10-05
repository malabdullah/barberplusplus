import importlib.util
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('broker', Path(__file__).with_name('broker.py'))
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)
verify_spec = importlib.util.spec_from_file_location('verify_install', Path(__file__).with_name('verify_install.py'))
verifier = importlib.util.module_from_spec(verify_spec)
verify_spec.loader.exec_module(verifier)


def frame(**fields):
    return (json.dumps(fields) + '\n').encode()


class BrokerTest(unittest.TestCase):
    def test_status_is_read_only_and_not_acceptance(self):
        for uid in (0, 998):
            result = broker.evaluate(frame(version=1, operation='status.inspect'), uid, 998)
            self.assertEqual(result['code'], 'OK')
            self.assertIs(result['automationReady'], False)
            self.assertIs(result['liveStackVerified'], False)
            self.assertEqual(result['capabilities'], ['status.inspect'])

    def test_unauthorized_peer_is_rejected_before_parsing(self):
        self.assertEqual(broker.evaluate(b'secret-do-not-echo', 999, 998), {'version': 1, 'code': 'FORBIDDEN'})
        self.assertEqual(broker.evaluate(frame(version=1, operation='status.inspect'), 0, 0)['code'], 'FORBIDDEN')

    def test_writes_are_disabled_without_configuration_escape(self):
        for operation in broker.DISABLED:
            self.assertEqual(broker.evaluate(frame(version=1, operation=operation), 998, 998)['code'], 'OPERATION_DISABLED')
        for field in ('command', 'path', 'token', 'uid', 'automationReady', 'environment', 'image', 'url'):
            data = {'version': 1, 'operation': 'status.inspect', field: 'do-not-echo'}
            result = broker.evaluate(frame(**data), 998, 998)
            self.assertEqual(result['code'], 'INVALID_REQUEST')
            self.assertNotIn('do-not-echo', json.dumps(result))

    def test_strict_version_type_and_operation(self):
        for version in (True, False, '1', 1.0, 0, 2, None):
            self.assertEqual(broker.evaluate(frame(version=version, operation='status.inspect'), 998, 998)['code'], 'INVALID_REQUEST')
        for operation in ('bootstrap', 'status.inspect\x00', ' status.inspect', 'STATUS.INSPECT', [], {}, None):
            self.assertEqual(broker.evaluate(frame(version=1, operation=operation), 998, 998)['code'], 'INVALID_REQUEST')

    def test_rejects_duplicate_keys_and_invalid_frames(self):
        cases = [b'', b'{}', b'{}\n{}\n', b'\xff\n', b'[]\n', b'null\n',
                 b'{"version":1,"version":1,"operation":"status.inspect"}\n',
                 b'{"version":1,"operation":"status.inspect","operation":"release.deploy"}\n',
                 b'x' * (broker.MAX_REQUEST + 1), b'[' * 1500 + b'\n']
        for raw in cases:
            self.assertEqual(broker.evaluate(raw, 998, 998)['code'], 'INVALID_REQUEST')

    def test_receive_valid_frame(self):
        left, right = socket.socketpair()
        with left, right:
            raw = frame(version=1, operation='status.inspect')
            right.sendall(raw)
            self.assertEqual(broker.receive_frame(left), raw)

    def test_receive_rejects_oversized_or_truncated_input(self):
        for raw in (b'x' * (broker.MAX_REQUEST + 1), b'{'):
            left, right = socket.socketpair()
            with left, right:
                right.sendall(raw)
                right.shutdown(socket.SHUT_WR)
                with self.assertRaises(broker.InvalidRequest):
                    broker.receive_frame(left)

    def test_silent_connection_times_out(self):
        left, right = socket.socketpair()
        previous = broker.REQUEST_SECONDS
        try:
            broker.REQUEST_SECONDS = 0.02
            with left, right, self.assertRaises((socket.timeout, broker.InvalidRequest)):
                broker.receive_frame(left)
        finally:
            broker.REQUEST_SECONDS = previous

    def test_units_do_not_grant_operator_privileges(self):
        directory = Path(__file__).parent
        service = (directory / 'barber-staging-broker.service').read_text()
        unit = (directory / 'barber-staging-broker.socket').read_text()
        for setting in ('User=barber-staging-broker', 'NoNewPrivileges=yes', 'CapabilityBoundingSet=\n',
                        'ProtectSystem=strict', 'PrivateNetwork=yes', 'RestrictAddressFamilies=AF_UNIX'):
            self.assertIn(setting, service)
        self.assertIn('SocketMode=0660', unit)
        self.assertIn('SocketGroup=barber-staging-release', unit)
        self.assertNotIn('ReadWritePaths=', service)

    def test_preflight_rejects_existing_units_dropins_or_active_state(self):
        empty = {'LoadState': 'not-found', 'ActiveState': 'inactive', 'FragmentPath': '', 'DropInPaths': ''}
        verifier.validate(empty, 'service', 'preflight')
        for key, value in (('LoadState', 'loaded'), ('FragmentPath', '/vendor/service'),
                           ('DropInPaths', '/etc/systemd/system/service.d/override.conf'),
                           ('ActiveState', 'active')):
            with self.assertRaises(RuntimeError):
                verifier.validate({**empty, key: value}, 'service', 'preflight')
        with self.assertRaises(RuntimeError):
            verifier.validate({}, 'service', 'preflight')

    def test_systemd_query_preserves_empty_safety_properties(self):
        with patch.object(verifier.subprocess, 'run') as run:
            run.return_value.returncode = 0
            run.return_value.stdout = 'LoadState=loaded\nCapabilityBoundingSet=\nDropInPaths=\n'
            values = verifier.properties('barber-staging-broker.service')
            self.assertIn('--all', run.call_args.args[0])
            self.assertEqual(values['CapabilityBoundingSet'], '')
            self.assertEqual(values['DropInPaths'], '')

    def effective_properties(self, suffix):
        return {**verifier.EXPECTED[suffix], 'LoadState': 'loaded', 'ActiveState': 'inactive',
                'DropInPaths': '', 'FragmentPath': f'/etc/systemd/system/barber-staging-broker.{suffix}',
                'ExecStart': '{ path=/usr/bin/python3 ; argv[]=/usr/bin/python3 -I -B /usr/local/libexec/barber-staging-broker/broker.py ; ignore_errors=no ; }',
                'Listen': '/run/barber-staging-broker.sock (Stream)'}

    def test_effective_rejects_any_unexpected_required_property(self):
        for suffix in verifier.EXPECTED:
            valid = self.effective_properties(suffix)
            verifier.validate(valid, suffix, 'effective')
            for key in (*verifier.EXPECTED[suffix], 'DropInPaths', 'FragmentPath', 'LoadState', 'ActiveState'):
                with self.subTest(suffix=suffix, key=key), self.assertRaises(RuntimeError):
                    verifier.validate({**valid, key: 'unexpected'}, suffix, 'effective')
                missing = {name: value for name, value in valid.items() if name != key}
                with self.assertRaises(RuntimeError):
                    verifier.validate(missing, suffix, 'effective')

    def test_effective_rejects_commands_hooks_and_network_listeners(self):
        service = self.effective_properties('service')
        for command in ('', service['ExecStart'].replace('python3 -I', 'python3 -E'),
                        service['ExecStart'] + service['ExecStart']):
            with self.assertRaises(RuntimeError):
                verifier.validate({**service, 'ExecStart': command}, 'service', 'effective')
        for key in ('ExecStartPre', 'ExecStartPost', 'ExecCondition', 'ExecStop', 'ExecStopPost'):
            with self.assertRaises(RuntimeError):
                verifier.validate({**service, key: 'unexpected'}, 'service', 'effective')
        for listener in ('0.0.0.0:9999 (Stream)', '/run/other.sock (Stream)', ''):
            with self.assertRaises(RuntimeError):
                verifier.validate({**self.effective_properties('socket'), 'Listen': listener}, 'socket', 'effective')


if __name__ == '__main__':
    unittest.main()
