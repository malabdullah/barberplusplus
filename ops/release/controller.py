#!/usr/bin/env python3
"""Root-owned, outbound-only release consumer. Disabled until initial cutover passes."""
import argparse, fcntl, hashlib, io, json, os, pathlib, re, stat
import subprocess, time, urllib.request, urllib.error, urllib.parse, zipfile

REPO = 'malabdullah/barberplusplus'
WORKFLOW = '.github/workflows/release.yml'
SHA = re.compile(r'[a-f0-9]{40}')
HASH = re.compile(r'[a-f0-9]{64}')
IMAGE = re.compile(r'ghcr.io/malabdullah/barberplusplus@sha256:[a-f0-9]{64}')

def digest(data): return hashlib.sha256(data).hexdigest()
def validate(m, run, repo_id):
    if run.get('repository', {}).get('id') != repo_id or run.get('head_repository', {}).get('id') != repo_id:
        raise ValueError('Foreign repository run')
    if run.get('path') != WORKFLOW or run.get('event') != 'push' or run.get('head_branch') != 'main' or run.get('conclusion') != 'success':
        raise ValueError('Untrusted workflow run')
    expected = {'schemaVersion': 1, 'repository': REPO, 'ref': 'refs/heads/main', 'workflow': WORKFLOW, 'commit': run['head_sha'], 'runId': str(run['id']), 'runAttempt': run['run_attempt'], 'backendFile': 'backend.tar.gz', 'compatibility': 'backward-compatible'}
    for k, v in expected.items():
        if m.get(k) != v: raise ValueError('Release identity mismatch: ' + k)
    if not SHA.fullmatch(m['commit']) or not IMAGE.fullmatch(m.get('frontendImage', '')): raise ValueError('Mutable or invalid image/source')
    for key in ['backendSha256', 'runtimeLockSha256', 'expectedSchemaSha256']:
        if not HASH.fullmatch(m.get(key, '')): raise ValueError('Invalid artifact hash')
    previous = ''
    if not m.get('migrations'): raise ValueError('Missing migration tree')
    for row in m['migrations']:
        if not re.fullmatch(r'\d{14}_[a-z0-9_]+\.sql', row.get('name', '')) or row['name'] <= previous or not HASH.fullmatch(row.get('sha256', '')): raise ValueError('Invalid migration tree')
        previous = row['name']
    return m

def unpack_release(raw, expected_digest, destination):
    if expected_digest != 'sha256:' + digest(raw): raise ValueError('GitHub artifact archive digest mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        entries = z.infolist()
        if sorted(x.filename for x in entries) != ['backend.tar.gz', 'release.json'] or any(x.file_size > 256 * 1024 * 1024 for x in entries): raise ValueError('Unexpected artifact members/size')
        for entry in entries:
            if stat.S_ISLNK(entry.external_attr >> 16): raise ValueError('Artifact symlink refused')
            (destination / entry.filename).write_bytes(z.read(entry))
    return json.loads((destination / 'release.json').read_text())

def private_file(path):
    p = pathlib.Path(path)
    if p.is_symlink() or p.stat().st_uid != 0 or p.stat().st_mode & 0o077: raise ValueError('Unsafe private file ownership/mode')
    return p.read_text().strip()

def acceptance(config):
    a = json.loads(private_file(config['initialAcceptanceFile']))
    if a.get('status') != 'PASS' or a.get('applicationId') != config['applicationId'] or a.get('repositoryId') != config['repositoryId']:
        raise ValueError('Initial cutover acceptance identity mismatch')
    for field in ['baselineRehearsal', 'backupRestore', 'rollback', 'productionSmoke']:
        if a.get(field) != 'PASS': raise ValueError('Incomplete initial cutover acceptance')
    if not SHA.fullmatch(a.get('commit', '')) or not IMAGE.fullmatch(a.get('frontendImage', '')):
        raise ValueError('Initial accepted release is not immutable')
    return a

def resume_policy(previous, commit):
    phase = previous.get('phase', '')
    if phase.startswith('FAILED'):
        raise ValueError('Failed release requires operator acknowledgement before retry')
    if phase in ['RECEIVED', 'BACKEND_APPLIED', 'FRONTEND_REQUESTED']:
        # An interrupted operation may have completed remotely. Do not infer its
        # outcome or overwrite the original rollback image on the next poll.
        raise ValueError('Interrupted release requires operator reconciliation')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

class Controller:
    def __init__(self, config):
        self.c = config
        self.root = pathlib.Path(config['stateDirectory'])
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.token = private_file(config['githubTokenFile']) if config.get('githubTokenFile') else None
        self.key = private_file(config['dokployKeyFile'])
        self.env = dict(os.environ, GH_CONFIG_DIR=str(self.root / 'gh'), XDG_CACHE_HOME=str(self.root / 'cache'))
        if self.token: self.env['GH_TOKEN'] = self.token

    def github(self, path):
        headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
        if self.token: headers['Authorization'] = 'Bearer ' + self.token
        req = urllib.request.Request('https://api.github.com/repos/' + REPO + path, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response: return json.load(response)

    def artifact(self, artifact):
        # Never forward GitHub authorization to signed storage redirects.
        url = artifact['archive_download_url']
        if urllib.parse.urlsplit(url).hostname != 'api.github.com': raise ValueError('Foreign artifact API URL')
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + self.token} if self.token else {})
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response: data = response.read(256 * 1024 * 1024 + 1)
        except urllib.error.HTTPError as e:
            if e.code not in [301, 302, 303, 307, 308]: raise
            target = e.headers['Location']; parsed = urllib.parse.urlsplit(target)
            if parsed.scheme != 'https' or not any((parsed.hostname or '').endswith(s) for s in ['.blob.core.windows.net', '.actions.githubusercontent.com', '.githubusercontent.com']): raise ValueError('Untrusted artifact redirect')
            with urllib.request.urlopen(target, timeout=60) as response: data = response.read(256 * 1024 * 1024 + 1)
        if len(data) > 256 * 1024 * 1024: raise ValueError('Oversized release')
        return data

    def dokploy(self, method, action, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request('http://127.0.0.1:3000/api/' + action, method=method, data=data, headers={'x-api-key': self.key, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as response: return json.load(response)

    def command(self, args, input=None):
        p = subprocess.run(args, input=input, capture_output=True, env=self.env, timeout=900)
        if p.returncode:
            # Commands can include privileged service responses. Keep diagnostics
            # in the protected state directory, never in the public job log.
            log = self.root / 'last-command-error.log'
            log.write_bytes(p.stderr[-1024 * 1024:]); log.chmod(0o600)
            raise RuntimeError('Release command failed; private diagnostics retained')
        return p.stdout

    def attest(self, path, commit, subject_digest):
        # Certificate/source policy is independent of fields inside the manifest.
        rows = self.github('/attestations/sha256:' + subject_digest).get('attestations', [])
        if not rows: raise ValueError('No GitHub provenance for subject')
        bundle = self.root / ('attestation-' + subject_digest + '.jsonl')
        bundle.write_text('\n'.join(json.dumps(row['bundle']) for row in rows)); bundle.chmod(0o600)
        # Offline-bundle verification needs no GitHub login. The API response
        # cannot forge Sigstore certificates; repository numeric ID was checked
        # separately before using the name-based certificate identity policy.
        verified = json.loads(self.command(['gh', 'attestation', 'verify', str(path), '--bundle', str(bundle), '--repo', REPO, '--signer-workflow', REPO + '/' + WORKFLOW, '--source-ref', 'refs/heads/main', '--source-digest', commit, '--deny-self-hosted-runners', '--format', 'json']))
        if not verified or any(str(row['verificationResult']['signature']['certificate']['sourceRepositoryIdentifier']) != str(self.c['repositoryId']) for row in verified):
            raise ValueError('Attestation certificate repository ID mismatch')

    def backend(self, mode, manifest, raw=None):
        host = self.c['backendHost']
        if not re.fullmatch(r'[a-z0-9_.@-]+', host): raise ValueError('Unsafe backend host')
        command = 'barber-backend ' + mode + ' ' + manifest['commit']
        if raw is not None: command += ' ' + digest(raw)
        output = self.command(['ssh', '-T', '-i', self.c['backendKeyFile'], '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', host, command], input=raw)
        return json.loads(output)

    def state(self, record):
        path = self.root / 'state.json'; tmp = self.root / 'state.next'
        tmp.write_text(json.dumps(record, indent=2)); tmp.chmod(0o600); tmp.replace(path)

    def frontend(self, image):
        if not IMAGE.fullmatch(image): raise ValueError('Frontend digest required')
        token = private_file(self.c['registryTokenFile']) if self.c.get('registryTokenFile') else None
        self.dokploy('POST', 'application.saveDockerProvider', {'applicationId': self.c['applicationId'], 'dockerImage': image, 'registryUrl': 'ghcr.io', 'username': self.c.get('registryUsername') if token else None, 'password': token})
        self.dokploy('POST', 'application.deploy', {'applicationId': self.c['applicationId'], 'title': 'Verified immutable production release'})

    def healthy(self, manifest):
        origin = self.c['appUrl']
        if urllib.parse.urlsplit(origin).scheme != 'https': raise ValueError('Production HTTPS required')
        for _ in range(120):
            try:
                with urllib.request.urlopen(origin + '/healthz', timeout=5) as r: health = r.status == 200
                with urllib.request.urlopen(origin + '/runtime-config.js', timeout=5) as r: config = r.read(8192).decode()
                service = json.loads(self.command(['docker', 'service', 'inspect', self.c['appName']]))[0]
                image = service['Spec']['TaskTemplate']['ContainerSpec']['Image']
                runtime = dict(re.findall(r"\b(environment|appUrl|release)\s*:\s*'([^'\\\n]*)'", config))
                if health and runtime == {'environment': 'production', 'appUrl': origin, 'release': manifest['commit']} and image == manifest['frontendImage']: return
            except (OSError, ValueError, RuntimeError): pass
            time.sleep(5)
        raise RuntimeError('Production health/release/image verification failed')

    def once(self):
        if not self.c.get('enabled'): return {'status': 'DISABLED_PENDING_INITIAL_CUTOVER'}
        accepted = acceptance(self.c)
        lock = (self.root / 'controller.lock').open('a')
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return {'status': 'ANOTHER_RELEASE_RUNNING'}
        with lock:
            # Public Git transport avoids spending REST quota every unchanged
            # minute. No API or registry write credential is needed for a public
            # repository/package. Rate limits still fail closed during delivery.
            ref = self.command(['git', 'ls-remote', '--refs', 'https://github.com/' + REPO + '.git', 'refs/heads/main']).decode().split()
            if len(ref) != 2 or ref[1] != 'refs/heads/main' or not SHA.fullmatch(ref[0]): raise ValueError('Invalid main ref')
            commit = ref[0]
            previous = json.loads((self.root / 'state.json').read_text()) if (self.root / 'state.json').exists() else {}
            if previous.get('deployedCommit') == commit: return {'status': 'UNCHANGED', 'commit': commit}
            resume_policy(previous, commit)
            repo = self.github('')
            if repo['id'] != self.c['repositoryId']: raise ValueError('Repository identity changed')
            runs = self.github('/actions/workflows/release.yml/runs?branch=main&event=push&status=success&per_page=100')['workflow_runs']
            selected = next((x for x in runs if x['head_sha'] == commit), None)
            if selected is None: return {'status': 'WAITING_FOR_MAIN_VALIDATION', 'commit': commit}
            run = self.github('/actions/runs/' + str(selected['id']))
            artifacts = self.github('/actions/runs/' + str(run['id']) + '/artifacts?per_page=100')['artifacts']
            matches = [a for a in artifacts if a['name'] == 'production-release-' + commit and not a['expired']]
            if len(matches) != 1: raise ValueError('Missing/ambiguous release artifact')
            raw = self.artifact(matches[0]); destination = self.root / commit
            destination.mkdir(mode=0o700, exist_ok=True)
            m = unpack_release(raw, matches[0].get('digest'), destination); validate(m, run, repo['id'])
            if digest((destination / 'backend.tar.gz').read_bytes()) != m['backendSha256']: raise ValueError('Backend payload mismatch')
            for p in [destination / 'release.json', destination / 'backend.tar.gz']: self.attest(p, commit, digest(p.read_bytes()))
            self.attest('oci://' + m['frontendImage'], commit, m['frontendImage'].split('sha256:')[1])
            current = self.dokploy('GET', 'application.one?applicationId=' + self.c['applicationId'])
            previous_image = current.get('dockerImage')
            if not IMAGE.fullmatch(previous_image or ''): raise ValueError('Verified rollback image required')
            previous_commit = previous.get('deployedCommit') or accepted['commit']
            if not SHA.fullmatch(previous_commit): raise ValueError('Previous release identity missing')
            record = {'commit': commit, 'runId': run['id'], 'previousImage': previous_image, 'deployedCommit': previous_commit, 'phase': 'RECEIVED'}
            self.backend('receive', m, raw); self.backend('preflight', m)
            self.state(record)
            try:
                self.backend('apply', m); record['phase'] = 'BACKEND_APPLIED'; self.state(record)
                self.frontend(m['frontendImage']); record['phase'] = 'FRONTEND_REQUESTED'; self.state(record)
                self.healthy(m)
                record.update(phase='COMPLETE', deployedCommit=commit, deployedImage=m['frontendImage']); self.state(record)
                return {'status': 'DEPLOYED', 'commit': commit}
            except Exception:
                # Backend rollback restores Functions only, never undoes SQL/data.
                rollback_ok = True
                try: self.frontend(previous_image)
                except Exception: rollback_ok = False
                try: self.backend('rollback', m)
                except Exception: rollback_ok = False
                try: self.healthy({'commit': previous_commit, 'frontendImage': previous_image})
                except Exception: rollback_ok = False
                record['phase'] = 'FAILED_ROLLED_BACK' if rollback_ok else 'FAILED_REQUIRES_OPERATOR'; self.state(record)
                raise RuntimeError(record['phase']) from None

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--config', default='/etc/barber-release/controller.json'); args = parser.parse_args()
    config = json.loads(private_file(args.config))
    if not config.get('enabled'): print(json.dumps({'status': 'DISABLED_PENDING_INITIAL_CUTOVER'})); return
    try: print(json.dumps(Controller(config).once()))
    except Exception as error: print(json.dumps({'status': 'RELEASE_BLOCKED', 'reason': type(error).__name__})); raise SystemExit(1)
if __name__ == '__main__': main()
