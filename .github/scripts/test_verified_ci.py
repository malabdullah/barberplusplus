import io
import json
import unittest
import zipfile

import verified_ci as ci


class Fixture:
    def __init__(self):
        self.base = 'a' * 40
        self.head = 'b' * 40
        self.candidate = 'c' * 40
        self.final = {'commit': 'd' * 40, 'tree': 'e' * 40, 'parents': [self.base, self.head]}
        self.inputs = 'f' * 64
        self.now = ci.timestamp('2026-11-18T10:20:00Z')
        self.diff = [('M', 'src/pages/Landing.jsx', '100644')]
        repo = {'full_name': ci.REPO}
        self.pr = {'number': 141, 'created_at': '2026-11-18T09:00:00Z', 'merged_at': '2026-11-18T10:10:00Z',
                   'base': {'ref': ci.TARGET, 'repo': repo}, 'head': {'sha': self.head, 'repo': repo},
                   'merge_commit_sha': self.final['commit']}
        self.run = {'id': 123, 'run_attempt': 1, 'event': 'pull_request',
                    'path': ci.CI, 'head_sha': self.head, 'status': 'completed',
                    'conclusion': 'success', 'repository': repo, 'head_repository': repo,
                    'created_at': '2026-11-18T09:01:00Z', 'updated_at': '2026-11-18T10:05:00Z'}
        browser_steps = ['Run npm run test:e2e', 'Run npm run test:e2e:qa',
                         'Verify scoped Apple popup transport without provider calls',
                         'Sample inputs for reviewed pre-merge validation', 'Record unchanged browser inputs after tests',
                         'Upload immutable browser input receipt']
        self.jobs = {'total_count': 5, 'jobs': [
            {'name': n, 'conclusion': 'success',
             'steps': [{'name': s, 'conclusion': 'success'} for s in browser_steps] if n == 'browser' else []}
            for n in sorted(ci.JOBS)
        ]}
        self.artifacts = {'total_count': 1, 'artifacts': [
            {'name': 'release-inputs-browser-1', 'created_at': '2026-11-18T10:04:00Z'}]}
        self.proof = {'version': 1, 'suite': 'browser', 'repo': ci.REPO, 'pr': 141, 'run': 123,
                      'attempt': 1, 'ref': 'refs/pull/141/merge', 'commit': self.candidate,
                      'tree': self.final['tree'], 'parents': [self.base, self.head], 'inputs': self.inputs}
        self.git_object = {'sha': self.candidate, 'tree': {'sha': self.final['tree']},
                           'parents': [{'sha': self.base}, {'sha': self.head}]}
        self.calls = []

    def api(self, endpoint):
        self.calls.append(endpoint)
        if endpoint.startswith('/commits/'):
            return [self.pr]
        if endpoint.startswith('/actions/workflows/'):
            return {'total_count': 1, 'workflow_runs': [self.run]}
        if endpoint == '/actions/runs/123/attempts/1/jobs?per_page=20':
            return self.jobs
        if endpoint == '/actions/runs/123/artifacts?per_page=20':
            return self.artifacts
        if endpoint == '/git/commits/' + self.candidate:
            return self.git_object
        raise AssertionError('unexpected request')

    def artifact(self, _artifact):
        return self.proof

    def evaluate(self):
        return ci.verify('browser', self, self.final, self.diff, self.inputs, self.now)


class VerifyCI(unittest.TestCase):
    def test_only_the_explicit_verified_mode_can_skip(self):
        self.assertEqual(ci.disposition('shadow-v1')[0], 'eligible')
        self.assertEqual(ci.disposition('verified-v1')[0], 'reused')
        for mode in (None, '', 'off', 'true', 'verified-v2'):
            with self.subTest(mode=mode), self.assertRaises(ci.NoProof):
                ci.disposition(mode)

    def test_exact_merge_parents_tree_and_checked_inputs(self):
        f = Fixture()
        self.assertNotEqual(f.candidate, f.final['commit'])
        self.assertEqual(f.evaluate(), 123)

    def test_exact_inputs_are_mandatory(self):
        for field, value in [('inputs', '0' * 64), ('parents', ['0' * 40, 'b' * 40]),
                             ('tree', '0' * 40), ('attempt', 2), ('pr', 142),
                             ('ref', 'refs/heads/dev'), ('suite', 'database')]:
            with self.subTest(field=field):
                f = Fixture()
                f.proof[field] = value
                with self.assertRaises(ci.NoProof):
                    f.evaluate()

    def test_stale_future_and_wrong_repository_fail_closed(self):
        for mutate in [
            lambda f: f.run.update(updated_at='2026-11-18T10:11:00Z'),
            lambda f: setattr(f, 'now', ci.timestamp('2026-11-18T18:01:00Z')),
            lambda f: f.run.update(head_repository={'full_name': 'someone/barberplusplus'}),
            lambda f: f.run.update(conclusion='failure'),
            lambda f: f.pr.update(merge_commit_sha='0'*40),
        ]:
            f = Fixture()
            mutate(f)
            with self.assertRaises(ci.NoProof):
                f.evaluate()

    def test_failed_or_skipped_tests_are_not_proof(self):
        f = Fixture()
        next(j for j in f.jobs['jobs'] if j['name'] == 'database')['conclusion'] = 'failure'
        with self.assertRaises(ci.NoProof):
            f.evaluate()
        f = Fixture()
        next(j for j in f.jobs['jobs'] if j['name'] == 'browser')['steps'][0]['conclusion'] = 'skipped'
        with self.assertRaises(ci.NoProof):
            f.evaluate()

    def test_missing_receipt_and_mismatched_github_commit_fail_closed(self):
        f = Fixture()
        f.artifacts = {'total_count': 0, 'artifacts': []}
        with self.assertRaises(ci.NoProof):
            f.evaluate()
        f = Fixture()
        f.git_object['tree']['sha'] = '0' * 40
        with self.assertRaises(ci.NoProof):
            f.evaluate()

    def test_unknown_or_nonfrontend_scope_never_queries_github(self):
        for path in ['supabase/functions/customer-auth/index.ts', 'supabase/migrations/new.sql',
                     'package-lock.json', '.github/workflows/ci.yml', 'src/pages/Auth.test.jsx',
                     'src/.hidden.jsx', 'public/.well-known/app.json']:
            f = Fixture()
            f.diff.append(('M', path, '100644'))
            with self.assertRaises(ci.NoProof):
                f.evaluate()
            self.assertEqual(f.calls, [])
        for item in [('D', 'src/App.jsx', '100644'), ('M', 'src/App.jsx', '120000')]:
            self.assertFalse(ci.frontend_only([item]))

    def test_only_bounded_single_file_with_matching_digest_is_accepted(self):
        def archive(name, payload=b'{}', extra=False):
            memory = io.BytesIO()
            with zipfile.ZipFile(memory, 'w', zipfile.ZIP_DEFLATED) as z:
                z.writestr(name, payload)
                if extra:
                    z.writestr('other.json', '{}')
            return memory.getvalue()
        good = archive('release-inputs.json', json.dumps(Fixture().proof).encode())
        self.assertEqual(ci.decode_proof(good, 'sha256:' + ci.sha(good)), Fixture().proof)
        for invalid in (archive('../release-inputs.json'), archive('release-inputs.json', extra=True),
                        archive('release-inputs.json', b'x' * (ci.MAX_PROOF + 1))):
            with self.assertRaises(ci.NoProof):
                ci.decode_proof(invalid, 'sha256:' + ci.sha(invalid))
        with self.assertRaises(ci.NoProof):
            ci.decode_proof(good, 'sha256:' + '0' * 64)


if __name__ == '__main__':
    unittest.main()
