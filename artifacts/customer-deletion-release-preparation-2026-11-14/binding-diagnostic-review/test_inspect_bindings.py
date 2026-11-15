import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bindings', pathlib.Path(__file__).with_name('inspect_bindings.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SENTINEL = 'NEVER_EXPORT_PRIVATE_SENTINEL'


def document(env=None):
    return {'services': {'functions': {'environment': dict(m.PINS) if env is None else env}}}


def snapshot():
    return {'id': SENTINEL, 'startedAt': SENTINEL, 'image': m.IMAGE, 'running': True, 'healthy': True,
            'configHash': 'a' * 64, 'fields': {**{k: ['MATCH', None] for k in m.EXPECTED}, **{k: [None] for k in m.PRESENCE}}}


class DiagnosticTests(unittest.TestCase):
    def test_explicit_all_pins_and_defaults(self):
        self.assertTrue(all(m.explicit(document())['compoundPredicate'].values()))

    def test_inherited_pins_are_not_claimed_explicit(self):
        self.assertFalse(m.explicit(document({}))['compoundPredicate']['fourExplicitPinsMatch'])
        self.assertTrue(all(m.effective(snapshot())[k]['matchesExpected'] for k in m.PINS))

    def test_each_wrong_pin_is_identified_without_export(self):
        for key in m.PINS:
            env = {**m.PINS, key: SENTINEL}
            result = m.explicit(document(env))
            self.assertFalse(result[key]['matchesExpected'])
            self.assertNotIn(SENTINEL, json.dumps(result))

    def test_interpolation_boolean_only(self):
        result = m.explicit(document({**m.PINS, 'APP_URL': '${' + SENTINEL + '}'}))
        self.assertTrue(result['APP_URL']['containsInterpolation'])
        self.assertNotIn(SENTINEL, json.dumps(result))

    def test_each_flag_wrong_or_boolean_false_is_not_string_false(self):
        for key in m.FLAGS:
            for value in ('true', False, None, SENTINEL):
                self.assertFalse(m.explicit(document({**m.PINS, key: value}))['compoundPredicate']['flagsAbsentOrFalse'])

    def test_empty_sensitive_fields_still_present(self):
        for key in m.PRESENCE:
            for value in ('', None, SENTINEL):
                result = m.explicit(document({**m.PINS, key: value}))
                self.assertTrue(result[key]['present'])
                self.assertFalse(result['compoundPredicate']['pairAndEncryptionAbsent'])
                self.assertNotIn(SENTINEL, json.dumps(result))

    def test_optional_backend_exact_or_absent(self):
        for value, expected in ((m.EXPECTED[m.BACKEND], True), (SENTINEL, False), ('', False)):
            result = m.explicit(document({**m.PINS, m.BACKEND: value}))
            self.assertEqual(result['compoundPredicate']['optionalBackendAbsentOrExpected'], expected)

    def test_bad_source_structure_fails(self):
        for value in ({}, document([]), document(None)['services']):
            with self.assertRaises(ValueError):
                m.explicit(value)

    def test_unrelated_secret_is_never_exported(self):
        self.assertNotIn(SENTINEL, json.dumps(m.explicit(document({**m.PINS, 'SERVICE_ROLE_KEY': SENTINEL}))))

    def test_runtime_missing_vs_wrong(self):
        value = snapshot()
        value['fields']['APP_ENV'] = [None]
        value['fields']['APP_URL'] = ['OTHER', None]
        result = m.effective(value)
        self.assertEqual(result['APP_ENV'], {'present': False, 'matchesExpected': False})
        self.assertEqual(result['APP_URL'], {'present': True, 'matchesExpected': False})

    def test_runtime_rejects_duplicate_and_unexpected_field(self):
        for fields in ({**snapshot()['fields'], 'APP_ENV': ['MATCH', 'MATCH', None]},
                       {**snapshot()['fields'], 'LEAK': [SENTINEL, None]},
                       {**snapshot()['fields'], 'APP_ENV': [SENTINEL, None]}):
            with self.assertRaises(ValueError):
                m.effective({'fields': fields})

    def test_collect_mocked_only_exact_read_only_commands(self):
        calls = []
        def runner(args):
            calls.append(args)
            return json.dumps(snapshot()).encode() if args[1] == 'inspect' else ('functions ' + 'a' * 64).encode()
        result = m.collect(document(), runner)
        self.assertEqual(result['status'], 'READ_ONLY_DIAGNOSTIC_REVIEW_REQUIRED')
        self.assertTrue(all(result['functionsMetadata'].values()))
        self.assertNotIn(SENTINEL, json.dumps(result))
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[1][-3:], ['config', '--hash', 'functions'])
        self.assertEqual(calls[0], calls[2])

    def test_runtime_changes_stop(self):
        values = [json.dumps(snapshot()).encode(), ('functions ' + 'a' * 64).encode(), json.dumps({**snapshot(), 'id': 'changed'}).encode()]
        with self.assertRaisesRegex(ValueError, 'RUNTIME_DRIFT'):
            m.collect(document(), lambda _: values.pop(0))

    def test_compose_hash_mismatch_is_reported_not_repaired(self):
        values = [json.dumps(snapshot()).encode(), ('functions ' + 'b' * 64).encode(), json.dumps(snapshot()).encode()]
        self.assertFalse(m.collect(document(), lambda _: values.pop(0))['functionsMetadata']['composeHashMatchesRuntime'])

    def test_invalid_compose_output_not_exported(self):
        values = [json.dumps(snapshot()).encode(), SENTINEL.encode()]
        with self.assertRaisesRegex(ValueError, '^COMPOSE_HASH_FORMAT$'):
            m.collect(document(), lambda _: values.pop(0))

    def test_template_projects_only_named_markers(self):
        value = m.projection()
        self.assertNotIn('{{json .Config.Env}}', value)
        self.assertNotIn('{{json .}}', value)
        self.assertNotIn('clientSecret', value)
        self.assertEqual(value.count('{{range .Config.Env}}'), len(m.EXPECTED) + len(m.PRESENCE))

    def test_file_metadata_and_bytes_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory).resolve() / 'source'
            path.write_bytes(SENTINEL.encode()); path.chmod(0o600)
            before = m.fingerprint(path.stat())
            with m.private_file(path, uid=os.getuid()) as (fd, stable):
                self.assertEqual(os.read(fd, 100), SENTINEL.encode()); stable()
            self.assertEqual(m.fingerprint(path.stat()), before)

    def test_missing_file_not_created(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory).resolve() / 'absent'
            with self.assertRaises(FileNotFoundError), m.private_file(path, uid=os.getuid()):
                pass
            self.assertFalse(path.exists())

    def test_symlink_hardlink_wrong_modes_and_nonempty_lock_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory).resolve(); path = base / 'source'
            path.write_bytes(b''); path.chmod(0o644)
            with self.assertRaises(ValueError), m.private_file(path, uid=os.getuid()): pass
            path.chmod(0o600); link = base / 'link'; link.symlink_to(path)
            with self.assertRaises(ValueError), m.private_file(link, uid=os.getuid()): pass
            link.unlink(); os.link(path, link)
            with self.assertRaises(ValueError), m.private_file(path, uid=os.getuid()): pass
            link.unlink(); path.write_bytes(b'x')
            with self.assertRaises(ValueError), m.private_file(path, empty=True, uid=os.getuid()): pass

    def test_detects_source_write_during_read(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory).resolve() / 'source'; path.write_bytes(b'a'); path.chmod(0o600)
            with self.assertRaises(ValueError), m.private_file(path, uid=os.getuid()) as (_, stable):
                path.write_bytes(b'changed'); stable()

    def test_cli_guard_prevents_local_execution(self):
        with patch.object(m.os, 'geteuid', return_value=1), patch.object(m, 'private_file') as reader:
            with self.assertRaisesRegex(ValueError, 'FIXED_ROOT_DB'):
                m.main()
            reader.assert_not_called()


if __name__ == '__main__':
    unittest.main()
