"""Read-only GitHub evidence for optional reuse of browser/database checks.

An unavailable proof is not a failure of the release: the normal checks run.
This tool neither grants a release nor publishes any artifacts.
"""
import argparse
import datetime as dt
import hashlib
import io
import json
import os
import pathlib
import re
import stat
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPO = 'malabdullah/barberplusplus'
TARGET = 'codex/verified-shadow-base-20261118'
SHADOW = '.github/workflows/verified-shadow.yml'
CI = '.github/workflows/ci.yml'
HOST = 'https://api.github.com'
SUITES = ('browser', 'database')
JOBS = {'application', 'browser', 'database', 'dependency-review', 'secret-scan'}
MAX_AGE = 6 * 60 * 60
MAX_PROOF = 16_384
MAX_ARCHIVE = 65_536
OID = re.compile(r'[a-f0-9]{40}')
HASH = re.compile(r'[a-f0-9]{64}')
FRONTEND = re.compile(
    r'(?:src/(?:[\w-]+/)*[\w.-]+\.(?:js|jsx|css|json|svg)'
    r'|public/(?:shops|images)/(?:[\w-]+/)*[\w.-]+\.(?:webp|png|jpe?g|avif|svg))'
)


class NoProof(ValueError):
    pass


def need(condition, reason):
    if not condition:
        raise NoProof(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def timestamp(value):
    return dt.datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc).timestamp()


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, timeout=30).stdout


def git(*args):
    return command('git', *args).decode().strip()


def checkout():
    commit = git('rev-parse', 'HEAD')
    tree = git('rev-parse', 'HEAD^{tree}')
    parents = [row[7:] for row in git('cat-file', '-p', commit).split('\n\n', 1)[0].splitlines()
               if row.startswith('parent ')]
    need(commit == os.environ.get('GITHUB_SHA') and OID.fullmatch(tree)
         and len(parents) == 2 and all(OID.fullmatch(p) for p in parents), 'not an exact two-parent merge')
    return {'commit': commit, 'tree': tree, 'parents': parents}


def frontend_only(changes):
    return bool(changes) and all(
        status in ('A', 'M') and mode == '100644' and FRONTEND.fullmatch(name)
        and not re.search(r'(^|/)(__tests__|fixtures)(/|$)|\.(?:test|spec)\.', name, re.I)
        and not any(part.startswith('.') for part in name.split('/'))
        for status, name, mode in changes
    )


def changes():
    parts = command('git', 'diff', '--name-status', '--no-renames', '-z', 'HEAD^1', 'HEAD').decode().split('\0')
    need(parts[-1] == '' and len(parts) % 2 == 1 and len(parts) <= 201, 'change scope is too broad')
    entries = []
    for status, name in zip(parts[0:-1:2], parts[1:-1:2]):
        need(FRONTEND.fullmatch(name), 'outside the eligible frontend paths')
        mode = git('ls-tree', 'HEAD', '--', name).split(' ', 1)[0]
        entries.append((status, name, mode))
    return entries


def browser_files():
    need(not os.environ.get('PLAYWRIGHT_BROWSERS_PATH') and not os.environ.get('PLAYWRIGHT_BASE_URL'),
         'unexpected browser executable or Test server configuration')
    directory = pathlib.Path.home() / '.cache/ms-playwright'
    roots = sorted(p for p in directory.iterdir() if re.fullmatch(r'[\w_-]+-\d+', p.name))
    need(all(any(p.name.startswith(x + '-') for p in roots) for x in ('chromium', 'firefox', 'webkit')),
         'missing Playwright browser inputs')
    entries = []
    for root in roots:
        need(root.is_dir() and not root.is_symlink(), 'invalid browser install root')
        for path in sorted(root.rglob('*')):
            name = str(path.relative_to(directory))
            if path.is_symlink():
                entries.append((name, 'symlink', os.readlink(path)))
            elif path.is_file():
                with path.open('rb') as handle:
                    entries.append((name, path.stat().st_mode & 0o777, hashlib.file_digest(handle, 'sha256').hexdigest()))
            need(len(entries) <= 10_000, 'browser manifest too large')
    return entries


def input_facts(suite):
    env = os.environ
    need(env.get('RUNNER_ENVIRONMENT') == 'github-hosted' and env.get('RUNNER_OS') == 'Linux'
         and env.get('RUNNER_ARCH') == 'X64' and env.get('ImageOS') and env.get('ImageVersion'),
         'unidentifiable runner image')
    endpoint = command('docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}').decode().strip()
    need(endpoint == 'unix:///var/run/docker.sock' and not env.get('DOCKER_HOST'), 'unexpected Docker endpoint')
    ids = command('docker', 'ps', '--filter', 'label=com.supabase.cli.project=barber-local-test',
                  '--format', '{{.ID}}').decode().split()
    need(3 <= len(ids) <= 24 and all(re.fullmatch(r'[a-f0-9]{12,64}', i) for i in ids), 'synthetic Test stack missing')
    services = command('docker', 'inspect', '--format', '{{.Name}} {{.Image}}', *ids).decode().splitlines()
    need(all(re.fullmatch(r'/supabase_[a-z0-9_]+_barber-local-test sha256:[a-f0-9]{64}', x) for x in services)
         and any(x.startswith('/supabase_db_') for x in services)
         and any(x.startswith('/supabase_auth_') for x in services), 'unknown synthetic Test image')
    versions = {
        'node': command('node', '--version').decode().strip(),
        'npm': command('npm', '--version').decode().strip(),
        'python': command('python3', '--version').decode().strip(),
        'docker': command('docker', 'version', '--format', '{{.Server.Version}}').decode().strip(),
        'kernel': command('uname', '-srvmo').decode().strip(),
    }
    need(versions['node'] == 'v24.20.0', 'Node pin changed')
    cpu = [row for row in pathlib.Path('/proc/cpuinfo').read_text().splitlines()
           if re.match(r'^(processor|vendor_id|cpu family|model name|model|stepping|flags)\s*:', row)]
    need(bool(cpu) and any(row.startswith('flags') for row in cpu), 'missing runner CPU evidence')
    facts = {'suite': suite, 'runner': [env['ImageOS'], env['ImageVersion'], env['RUNNER_ARCH']],
             'versions': versions, 'packages': sha(command('dpkg-query', '-W', '-f=${Package}=${Version}\n')),
             'cpu': sha('\n'.join(cpu).encode()), 'services': sorted(services), 'npmLock': sha(pathlib.Path('package-lock.json').read_bytes()),
             'platformLock': sha(pathlib.Path('ops/release/runtime-lock.json').read_bytes()),
             'localLock': sha(pathlib.Path('ops/local-test/runtime.json').read_bytes())}
    if suite == 'browser':
        facts['browsers'] = browser_files()
    return facts


def fingerprint(suite):
    facts = input_facts(suite)
    if 'browsers' in facts:
        facts['browsers'] = sha(json.dumps(facts['browsers'], separators=(',', ':')).encode())
    return sha(json.dumps(facts, sort_keys=True, separators=(',', ':')).encode())


def diagnose(stage):
    snapshot = pathlib.Path(os.environ['RUNNER_TEMP']) / 'shadow-browser-snapshot.json'
    facts = input_facts('browser')
    if stage == 'diagnose-before':
        snapshot.write_text(json.dumps(facts))
        return
    before = json.loads(snapshot.read_bytes())
    changed = sorted(key for key in facts if before[key] != facts[key])
    print('BROWSER_INPUT_COMPONENTS_CHANGED', json.dumps(changed))
    if 'browsers' in changed:
        old = {entry[0]: entry[1:] for entry in before['browsers']}
        new = {entry[0]: entry[1:] for entry in facts['browsers']}
        paths = [{'path': path, 'state': ('added' if path not in old else 'removed' if path not in new else 'modified')}
                 for path in sorted(set(old) | set(new))
                 if old.get(path) != new.get(path) and re.fullmatch(r'[\w./+-]{1,220}', path)]
        print('BROWSER_INPUT_INSTALL_PATHS_CHANGED', json.dumps(paths[:30]))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class Evidence:
    def __init__(self, token):
        need(bool(token), 'no GitHub evidence credential')
        self.headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                        'User-Agent': 'BarberPlusPlus-Verified-CI'}
        self.opener = urllib.request.build_opener(NoRedirect())

    def api(self, endpoint):
        req = urllib.request.Request(HOST + '/repos/' + REPO + endpoint, headers=self.headers)
        with self.opener.open(req, timeout=8) as response:
            payload = response.read(2_097_153)
        need(len(payload) <= 2_097_152, 'oversized GitHub evidence')
        return json.loads(payload)

    def artifact(self, artifact):
        aid = artifact['id']
        need(type(aid) is int and aid > 0 and type(artifact['size_in_bytes']) is int
             and 0 < artifact['size_in_bytes'] <= MAX_ARCHIVE
             and not artifact['expired']
             and re.fullmatch('sha256:[a-f0-9]{64}', artifact.get('digest', '')),
             'invalid GitHub artifact identity')
        req = urllib.request.Request(f'{HOST}/repos/{REPO}/actions/artifacts/{aid}/zip', headers=self.headers)
        try:
            with self.opener.open(req, timeout=8):
                raise NoProof('unexpected GitHub artifact transport')
        except urllib.error.HTTPError as error:
            with error:
                destination = error.headers.get('Location', '')
                parsed = urllib.parse.urlsplit(destination)
                need(error.code == 302 and parsed.scheme == 'https'
                     and re.fullmatch(r'[a-z0-9]+\.blob\.core\.windows\.net', parsed.netloc),
                     'unrecognized GitHub artifact storage')
        # The GitHub token is never forwarded to artifact storage.
        with self.opener.open(urllib.request.Request(destination), timeout=12) as response:
            archive = response.read(MAX_ARCHIVE + 1)
        return decode_proof(archive, artifact['digest'])


def decode_proof(archive, digest):
    need(len(archive) <= MAX_ARCHIVE and 'sha256:' + sha(archive) == digest, 'artifact digest mismatch')
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        files = z.infolist()
        need(len(files) == 1 and files[0].filename == 'release-inputs.json'
             and files[0].file_size <= MAX_PROOF
             and stat.S_IFMT(files[0].external_attr >> 16) in (0, stat.S_IFREG), 'unexpected proof archive')
        return json.loads(z.read(files[0]))


def require_jobs(job_response, suite):
    jobs = job_response['jobs']
    need(job_response['total_count'] == len(JOBS) == len(jobs)
         and {j['name'] for j in jobs} == JOBS and all(j['conclusion'] == 'success' for j in jobs),
         'required pre-merge CI checks did not all pass')
    run_steps = {
        'browser': {'Run npm run test:e2e', 'Run npm run test:e2e:qa',
                    'Verify scoped Apple popup transport without provider calls'},
        'database': {'Run npx supabase test db', 'Run npm run check:schema',
                     'Replay on the exact production PostgreSQL image', 'Rehearse deletion with pinned Auth and Storage',
                     'Verify local backend across service boundaries', 'Verify synthetic invitations and local email',
                     'Verify customer email, social profiles and booking ownership',
                     'Verify persistence and explicit synthetic reset'},
    }[suite] | {'Sample inputs for reviewed pre-merge validation',
                f'Record unchanged {suite} inputs after tests', f'Upload immutable {suite} input receipt'}
    steps = next(j['steps'] for j in jobs if j['name'] == suite)
    need(all([step['conclusion'] for step in steps if step['name'] == name] == ['success']
             for name in run_steps), 'required suite steps were not recorded as successful')


def fresh(checked, merge, now):
    return checked <= merge <= now and now - checked <= MAX_AGE


def require_proof(proof, suite, pr, run, final, inputs, now):
    need(isinstance(proof, dict) and proof.get('version') == 1 and proof.get('suite') == suite
         and proof.get('repo') == REPO and proof.get('pr') == pr['number']
         and proof.get('run') == run['id'] and proof.get('attempt') == run['run_attempt']
         and proof.get('ref') == f"refs/pull/{pr['number']}/merge"
         and proof.get('tree') == final['tree'] and proof.get('parents') == final['parents']
         and OID.fullmatch(proof.get('commit', '')) and HASH.fullmatch(proof.get('inputs', ''))
         and fresh(timestamp(run['updated_at']), timestamp(pr['merged_at']), now),
         'pre-merge receipt identity or age does not match')


def verify(suite, evidence, final, diff, inputs, now):
    need(frontend_only(diff), 'change requires full validation')
    prs = evidence.api(f"/commits/{final['commit']}/pulls?per_page=10")
    eligible = [p for p in prs if p.get('merge_commit_sha') == final['commit']
                and p.get('merged_at') and p['base']['ref'] == TARGET
                and p['base']['repo']['full_name'] == p['head']['repo']['full_name'] == REPO
                and p['head']['sha'] == final['parents'][1]]
    need(len(eligible) == 1, 'ambiguous or missing reviewed Test merge')
    pr = eligible[0]
    response = evidence.api(f"/actions/workflows/ci.yml/runs?event=pull_request&head_sha={final['parents'][1]}&per_page=30")
    need(response['total_count'] == len(response['workflow_runs']) <= 30, 'ambiguous CI run listing')
    runs = [
        run for run in response['workflow_runs']
        if run['event'] == 'pull_request' and run['path'] == CI and run['head_sha'] == final['parents'][1]
        and run['status'] == 'completed' and run['repository']['full_name'] == run['head_repository']['full_name'] == REPO
        and timestamp(run['created_at']) >= timestamp(pr['created_at'])
        and timestamp(run['created_at']) <= timestamp(pr['merged_at'])
    ]
    need(len(runs) == 1 and runs[0]['conclusion'] == 'success', 'ambiguous or unsuccessful pre-merge run')
    run = runs[0]
    rid, attempt = run['id'], run['run_attempt']
    need(type(rid) is int and type(attempt) is int and rid > 0 and attempt > 0, 'invalid run identity')
    require_jobs(evidence.api(f'/actions/runs/{rid}/attempts/{attempt}/jobs?per_page=20'), suite)
    artifacts = evidence.api(f'/actions/runs/{rid}/artifacts?per_page=20')
    need(artifacts['total_count'] == len(artifacts['artifacts']), 'ambiguous artifact listing')
    selected = [a for a in artifacts['artifacts'] if a['name'] == f'release-inputs-{suite}-{attempt}']
    need(len(selected) == 1, 'no matching pre-merge receipt')
    artifact = selected[0]
    need(timestamp(run['created_at']) <= timestamp(artifact['created_at']) <= timestamp(run['updated_at']),
         'artifact outside the selected CI execution')
    proof = evidence.artifact(artifact)
    require_proof(proof, suite, pr, run, final, inputs, now)
    candidate = evidence.api(f"/git/commits/{proof['commit']}")
    need(candidate['sha'] == proof['commit'] and candidate['tree']['sha'] == final['tree']
         and [p['sha'] for p in candidate['parents']] == final['parents'], 'actual tested Git objects differ')
    print(f'SHADOW_EVIDENCE suite={suite} receipt=match runner_inputs={"match" if proof["inputs"] == inputs else "different"} run={rid}')
    need(proof['inputs'] == inputs, 'runner input fingerprint differs from pre-merge CI')
    return rid


def candidate(suite, source):
    env = os.environ
    info = json.loads(pathlib.Path(env['GITHUB_EVENT_PATH']).read_text())['pull_request']
    need(env['GITHUB_EVENT_NAME'] == 'pull_request' and info['base']['ref'] == TARGET
         and info['base']['repo']['full_name'] == info['head']['repo']['full_name'] == REPO
         and source['parents'] == [info['base']['sha'], info['head']['sha']]
         and env['GITHUB_REF'] == f"refs/pull/{info['number']}/merge",
         'not the isolated pull-request test merge')
    need(frontend_only(changes()), 'change requires full validation')
    return {'version': 1, 'suite': suite, 'repo': REPO, 'pr': info['number'],
            'run': int(env['GITHUB_RUN_ID']), 'attempt': int(env['GITHUB_RUN_ATTEMPT']), 'ref': env['GITHUB_REF'],
            **source, 'inputs': fingerprint(suite)}


def output(name, value):
    with open(os.environ['GITHUB_OUTPUT'], 'a') as handle:
        handle.write(f'{name}={value}\n')


def disposition(mode):
    if mode == 'shadow-v1':
        return 'eligible', 'matched in shadow mode; full validation still runs'
    if mode == 'verified-v1':
        return 'reused', 'reused matching pre-merge CI'
    raise NoProof('verified reuse is disabled')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('sample', 'record', 'reuse', 'diagnose-before', 'diagnose-after'))
    parser.add_argument('suite', choices=SUITES)
    args = parser.parse_args()
    try:
        env = os.environ
        need(env.get('GITHUB_ACTIONS') == 'true' and env.get('GITHUB_REPOSITORY') == REPO,
             'not the Barber++ GitHub workflow')
        if args.mode.startswith('diagnose-'):
            diagnose(args.mode)
            return
        source = checkout()
        scratch = pathlib.Path(env['RUNNER_TEMP'])
        before = scratch / f'release-before-{args.suite}.json'
        if args.mode == 'sample':
            before.write_text(json.dumps(candidate(args.suite, source)))
        elif args.mode == 'record':
            proof = candidate(args.suite, source)
            need(json.loads(before.read_bytes()) == proof, 'CI inputs changed during validation')
            (scratch / 'release-inputs.json').write_text(json.dumps(proof) + '\n')
            output('recorded', 'true')
        else:
            need(env.get('GITHUB_EVENT_NAME') == 'push' and env.get('GITHUB_REF') == f'refs/heads/{TARGET}'
                 and env.get('GITHUB_WORKFLOW_REF') == f'{REPO}/{SHADOW}@refs/heads/{TARGET}'
                 and env.get('BARBER_VALIDATION_MODE') == 'shadow-v1',
                 'not the isolated observe-only workflow')
            key, description = disposition(env.get('BARBER_VALIDATION_MODE'))
            diff = changes()
            need(frontend_only(diff), 'change requires full validation')
            rid = verify(args.suite, Evidence(env.get('GH_TOKEN')), source, diff, fingerprint(args.suite), time.time())
            output(key, 'true')
            print(f'{args.suite}: {description} (run {rid})')
    except NoProof as error:
        print(f'{args.suite}: full validation remains required ({error})')
    except Exception:
        # No raw HTTP bodies, archive contents, Docker metadata or credentials in CI logs.
        print(f'{args.suite}: full validation remains required (evidence unavailable)')


if __name__ == '__main__':
    main()
