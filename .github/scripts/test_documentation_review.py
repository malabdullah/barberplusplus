import subprocess
import tempfile
import unittest
from pathlib import Path

from documentation_review import changed_files, review


def declaration(prd='unchanged', agents='unchanged', status='unchanged', evidence='not applicable'):
    return f'''## Documentation review
PRD: {prd}
PRD reason: Existing product behavior and feature status remain unchanged.
AGENTS: {agents}
AGENTS reason: Existing working instructions remain appropriate for this change.
Feature status: {status}
Release evidence: {evidence}
'''


class DocumentationPolicyTests(unittest.TestCase):
    def test_ordinary_fix_with_explanations(self):
        self.assertEqual(review(declaration(), {'src/button.jsx': 'M'}), [])

    def test_both_documents_updated(self):
        self.assertEqual(review(declaration('updated', 'updated'), {'PRD.md': 'M', 'AGENTS.md': 'M'}), [])

    def test_missing_and_duplicate_sections_fail(self):
        self.assertTrue(review('', {}))
        self.assertTrue(review(declaration() * 2, {}))

    def test_unsupported_update_claim_fails(self):
        self.assertTrue(review(declaration('updated'), {'src/app.jsx': 'M'}))

    def test_hidden_document_change_fails(self):
        self.assertTrue(review(declaration(), {'PRD.md': 'M'}))

    def test_deleted_document_fails(self):
        self.assertTrue(review(declaration('updated'), {'PRD.md': 'D'}))

    def test_feature_promotion_requires_prd_and_evidence(self):
        self.assertTrue(review(declaration(status='production'), {}))
        self.assertTrue(review(declaration('updated', status='production'), {'PRD.md': 'M'}))
        self.assertEqual(review(declaration('updated', status='production', evidence='Verified release workflow 123, runtime commit abcdef1.'), {'PRD.md': 'M'}), [])

    def test_test_only_and_planned_status_need_prd(self):
        for status in ('test-only', 'planned', 'retired'):
            with self.subTest(status=status):
                self.assertTrue(review(declaration(status=status), {}))
                self.assertEqual(review(declaration('updated', status=status), {'PRD.md': 'A'}), [])

    def test_template_placeholders_fail(self):
        self.assertTrue(review(declaration().replace('Existing product behavior and feature status remain unchanged.', 'REPLACE with a reason here.'), {}))
        self.assertTrue(review(declaration('SELECT updated OR unchanged'), {}))

    def test_ordinary_words_in_a_specific_reason_are_allowed(self):
        body = declaration().replace('Existing product behavior and feature status remain unchanged.',
                                     'Fixed how users select a date; existing booking requirements are unchanged.')
        self.assertEqual(review(body, {'src/calendar.jsx': 'M'}), [])

    def test_comments_examples_and_duplicate_fields_do_not_satisfy_policy(self):
        self.assertTrue(review('<!--\n' + declaration() + '-->', {}))
        self.assertTrue(review('```markdown\n' + declaration() + '```', {}))
        self.assertTrue(review(declaration() + 'PRD: updated\n', {}))

    def test_reasons_must_be_in_correct_section(self):
        body = declaration().replace('AGENTS reason:', '## Another section\nAGENTS reason:')
        self.assertTrue(review(body, {}))

    def test_real_git_diff_includes_added_and_deleted_documents(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], stderr=subprocess.DEVNULL, text=True).strip()
            git('init', '-q')
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.invalid')
            git('config', 'commit.gpgsign', 'false')
            Path(directory, 'AGENTS.md').write_text('Original instructions\n')
            git('add', '.')
            git('commit', '-qm', 'base')
            base = git('rev-parse', 'HEAD')
            Path(directory, 'AGENTS.md').unlink()
            Path(directory, 'PRD.md').write_text('Product requirements\n')
            git('add', '-A')
            git('commit', '-qm', 'docs')
            self.assertEqual(changed_files(base, git('rev-parse', 'HEAD'), directory), {'AGENTS.md': 'D', 'PRD.md': 'A'})
        with self.assertRaises(ValueError):
            changed_files('--invalid', 'a' * 40)


if __name__ == '__main__':
    unittest.main()
