import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('handoff_docs', Path(__file__).with_name('verify-handoff-docs.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class HandoffLinkTests(unittest.TestCase):
    def test_relative_target_and_anchor(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'docs').mkdir()
            (root / 'README.md').write_text('[Start](docs/start.md#next-step)')
            (root / 'docs/start.md').write_text('# Next step\n')
            self.assertEqual(checker.check_links(root, 'README.md'), [])

    def test_missing_target_and_anchor_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'README.md').write_text('# Start\n[Missing](absent.md)\n[Wrong](#unknown)')
            self.assertEqual(len(checker.check_links(root, 'README.md')), 2)

    def test_examples_and_comments_do_not_create_false_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'README.md').write_text('```md\n[Example](absent.md)\n```\n<!-- [Private](hidden.md) -->')
            self.assertEqual(checker.check_links(root, 'README.md'), [])

    def test_machine_specific_and_escaping_links_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'README.md').write_text('[A](/private/tmp/file.md)\n[B](../outside.md)\n[C](file:///tmp/secret)')
            self.assertEqual(len(checker.check_links(root, 'README.md')), 3)

    def test_private_external_urls_are_not_network_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'README.md').write_text('[Private](https://github.com/owner/private)')
            self.assertEqual(checker.check_links(root, 'README.md'), [])

    def test_duplicate_headings_and_url_encoded_filename(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'README.md').write_text('[Read](My%20Guide.md#read-1)')
            (root / 'My Guide.md').write_text('# Read\n# Read\n')
            self.assertEqual(checker.check_links(root, 'README.md'), [])

    def test_skill_integrity_and_explicit_only_policy_are_independent_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            skills = root / 'docs/agent-skills'
            policy = skills / 'full-regression-testing/agents/openai.yaml'
            policy.parent.mkdir(parents=True)
            policy.write_text('policy:\n  allow_implicit_invocation: false\n')
            entry = skills / 'full-regression-testing/SKILL.md'
            entry.write_text('# Explicit-only workflow\n')
            def refresh_manifest():
                files = {str(p.relative_to(skills)): hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in (policy, entry)}
                (skills / 'manifest.json').write_text(json.dumps({'files': files}))
            refresh_manifest()
            self.assertEqual(checker.check_skills(root), [])
            entry.write_text('# Unexpected content change\n')
            self.assertTrue(checker.check_skills(root))
            policy.write_text('policy:\n  allow_implicit_invocation: true\n')
            refresh_manifest()
            self.assertTrue(checker.check_skills(root))


if __name__ == '__main__':
    unittest.main()
