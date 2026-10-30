#!/usr/bin/env python3
"""Restricted backend release command. Install only after baseline adoption.

The SSH key must have a forced command pointing at this file, with no PTY,
forwarding, agent forwarding or user rc. It never accepts an arbitrary shell.
"""
import fcntl, hashlib, importlib.util, io, json, os, pathlib, re, shutil, stat
import subprocess, sys, tarfile, time, zipfile
from state_store import atomic_json
from backup_policy import verify_backup_readiness

SHA = re.compile(r'[a-f0-9]{40}')
HASH = re.compile(r'[a-f0-9]{64}')
MIGRATION = re.compile(r'\d{14}_[a-z0-9_]+\.sql')
LIMIT = 256 * 1024 * 1024

def digest(data): return hashlib.sha256(data).hexdigest()
def staged_path(live, commit, name): return live / ('.barber-next-' + commit + '-' + name)

def private_json(path):
    p = pathlib.Path(path)
    if p.is_symlink() or p.stat().st_uid != 0 or p.stat().st_mode & 0o077:
        raise ValueError('Unsafe private configuration')
    return json.loads(p.read_text())

def automatic_sql(text):
    if re.search(r'''--|/\*|\$|['"\\]|\b(?:drop|truncate|delete|update|insert|grant|revoke|policy|trigger|function|procedure|do|copy|execute)\b''', text, re.I): return False
    ident = r'[a-z_][a-z0-9_]*'
    index = rf'create\s+(?:unique\s+)?index\s+{ident}\s+on\s+public\.{ident}\s*\(\s*{ident}(?:\s*,\s*{ident})*\s*\)'
    column = rf'alter\s+table\s+public\.{ident}\s+add\s+column\s+{ident}\s+(?:text|boolean|integer|bigint|uuid|date|jsonb|timestamptz|numeric)\s*'
    statements = [s.strip() for s in text.split(';') if s.strip()]
    return bool(statements) and all(re.fullmatch(index, s, re.I) or re.fullmatch(column, s, re.I) for s in statements)

def extract_bundle(raw, commit, target):
    # Frontend consumer independently verifies GitHub/Sigstore attestations.
    # This endpoint binds the exact received archive to its forced SSH command.
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        infos = z.infolist()
        if sorted(i.filename for i in infos) != ['backend.tar.gz', 'release.json'] or sum(i.file_size for i in infos) > LIMIT:
            raise ValueError('Invalid release archive')
        if any(stat.S_ISLNK(i.external_attr >> 16) for i in infos): raise ValueError('Symlink refused')
        m = json.loads(z.read('release.json')); backend = z.read('backend.tar.gz')
    if m.get('commit') != commit or m.get('repository') != 'malabdullah/barberplusplus' or m.get('ref') != 'refs/heads/main' or m.get('compatibility') != 'backward-compatible':
        raise ValueError('Release identity mismatch')
    if m.get('backendSha256') != digest(backend): raise ValueError('Payload digest mismatch')
    with tarfile.open(fileobj=io.BytesIO(backend), mode='r:gz') as tar:
        entries = tar.getmembers()
        if sum(e.size for e in entries) > LIMIT: raise ValueError('Expanded payload too large')
        for e in entries:
            p = pathlib.PurePosixPath(e.name)
            if p.is_absolute() or '..' in p.parts or not (e.isfile() or e.isdir()): raise ValueError('Unsafe archive member')
            if p.parts and ('.env' in p.name or p.parts[0] not in ['supabase', 'scripts', 'ops']): raise ValueError('Unexpected payload member')
        for e in entries:
            p = target / e.name
            if e.isdir(): p.mkdir(parents=True, exist_ok=True)
            else:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(tar.extractfile(e).read()); p.chmod(0o600)
    if digest((target / 'ops/release/runtime-lock.json').read_bytes()) != m.get('runtimeLockSha256'): raise ValueError('Runtime lock mismatch')
    if digest((target / 'supabase/schema.expected.sql').read_bytes()) != m.get('expectedSchemaSha256'): raise ValueError('Schema digest mismatch')
    files = sorted((target / 'supabase/migrations').glob('*'))
    expected = [{'name': p.name, 'sha256': digest(p.read_bytes())} for p in files]
    if any(not MIGRATION.fullmatch(p.name) for p in files) or expected != m.get('migrations'): raise ValueError('Migration tree mismatch')
    return m

class Backend:
    def __init__(self, config):
        self.c = config
        self.root = pathlib.Path(config['stateDirectory'])
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def command(self, args, text=None):
        p = subprocess.run(args, input=text, text=True, capture_output=True, timeout=180)
        if p.returncode:
            log = self.root / 'last-error.log'; log.write_text(p.stderr[-1024 * 1024:]); log.chmod(0o600)
            raise RuntimeError('Backend command failed; private diagnostics retained')
        return p.stdout

    def sql(self, text):
        return self.command(['docker', 'exec', '-i', self.c['databaseContainer'], 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], text)

    def schema_fingerprint(self):
        # These are installed, reviewed root-owned tools, not executable files
        # taken from the incoming release payload.
        spec = importlib.util.spec_from_file_location('schema_normalizer', pathlib.Path(__file__).with_name('normalize-schema.py'))
        normalizer = importlib.util.module_from_spec(spec); spec.loader.exec_module(normalizer)
        dump = self.command(['/bin/bash', '/usr/local/lib/barber-release/dump-production-schema.sh'])
        return digest(normalizer.behavioral_schema(dump).encode())

    def preflight(self, target, m):
        if not self.c.get('enabled'): raise ValueError('Backend release path disabled pending adoption')
        adoption = private_json(self.c['adoptionFile'])
        if adoption.get('status') != 'PASS' or adoption.get('rehearsal') != 'PASS': raise ValueError('Unaccepted production migration baseline')
        evidence = private_json(self.c['backupEvidenceFile'])
        verify_backup_readiness(evidence, release_commit=m.get('commit'), system_id=self.c.get('backupSystemId'))
        lock = json.loads((target / 'ops/release/runtime-lock.json').read_text())
        for name, expected in lock['containers'].items():
            actual = json.loads(self.command(['docker', 'inspect', name]))[0]
            state = actual['State']
            if actual['Image'] != expected['imageId'] or state.get('Running') is not True or state.get('Health', {}).get('Status') != 'healthy':
                raise ValueError('Production runtime changed/unhealthy')
        runtime = json.loads(self.command(['docker','inspect',self.c['functionsContainer']]))[0]
        environment = dict(item.split('=',1) for item in runtime['Config']['Env'] if '=' in item)
        if environment.get('APP_ENV')!='production' or environment.get('APP_URL')!=self.c['appUrl'] or not all(environment.get(name) for name in ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','CRON_SHARED_SECRET']):
            raise ValueError('Production Functions environment is incomplete')
        # This private hash table is created in the separately reviewed adoption
        # transaction, never by the automatic release path.
        applied = json.loads(self.sql("BEGIN READ ONLY; SELECT coalesce(json_agg(json_build_object('name',name,'sha256',sha256) ORDER BY name),'[]') FROM barber_release.migrations; COMMIT;"))
        recorded = self.sql("BEGIN READ ONLY; SELECT fingerprint FROM barber_release.schema_state WHERE singleton=true; COMMIT;").strip()
        if not HASH.fullmatch(recorded) or self.schema_fingerprint() != recorded: raise ValueError('Unrecorded production schema drift')
        if m['migrations'][:len(applied)] != applied: raise ValueError('Applied migration history was edited or removed')
        pending = m['migrations'][len(applied):]
        if any(not automatic_sql((target / 'supabase/migrations' / x['name']).read_text()) for x in pending): raise ValueError('Migration needs a separately reviewed release')
        return pending

    def apply(self, target, m):
        pending = self.preflight(target, m)
        self.journal({'commit':m['commit'], 'phase':'SQL_APPLYING', 'names':[]})
        # SQL and hash history commit together. Repeated delivery never reapplies
        # committed migrations; interrupted Functions changes require inspection.
        if pending:
            statements = ["BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'; SELECT pg_advisory_xact_lock(18491723);"]
            for item in pending:
                statements.append((target / 'supabase/migrations' / item['name']).read_text())
                statements.append("INSERT INTO barber_release.migrations(name,sha256) VALUES ('" + item['name'] + "','" + item['sha256'] + "');")
                version, name = item['name'].removesuffix('.sql').split('_', 1)
                statements.append("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('"+version+"','"+name+"',ARRAY[]::text[]);")
            statements.append('COMMIT;'); self.sql('\n'.join(statements))
        # A crash between SQL commit and this fingerprint update deliberately
        # fails closed on the next attempt, requiring operator reconciliation.
        fingerprint = self.schema_fingerprint()
        self.sql("UPDATE barber_release.schema_state SET fingerprint='" + fingerprint + "' WHERE singleton=true;")
        self.journal({'commit':m['commit'], 'phase':'SQL_APPLIED', 'names':[]})
        self.functions(target, m['commit'])
        # A healthy start is insufficient if another service failed during the
        # update, or the resulting schema/history no longer matches this release.
        if self.preflight(target, m): raise ValueError('Unapplied migrations remain after backend update')
        return {'status': 'BACKEND_APPLIED', 'migrationsApplied': len(pending)}

    def functions(self, target, commit):
        source = target / 'supabase/functions'
        live = pathlib.Path(self.c['functionsDirectory'])
        # Preserve the separately managed production main gateway and secrets.
        incoming = sorted(p.name for p in source.iterdir() if p.is_dir())
        active_file = self.root / 'active-functions.json'
        previous = private_json(active_file)['names'] if active_file.exists() else private_json(self.c['adoptionFile'])['functionNames']
        if not isinstance(previous,list) or any(not isinstance(n,str) for n in previous) or len(previous)!=len(set(previous)): raise ValueError('Invalid managed Function inventory')
        names = sorted(set(previous) | set(incoming))
        if 'main' in names or any(not re.fullmatch(r'[a-z0-9_-]+', n) for n in names): raise ValueError('Unexpected Function name')
        def tree(directory):
            return {str(p.relative_to(directory)):digest(p.read_bytes()) for p in directory.rglob('*') if p.is_file() and p.suffix in ['.ts','.js','.json'] and not p.name.endswith('_test.ts')}
        if set(incoming)==set(previous) and all((live/name).is_dir() and tree(source/name)==tree(live/name) for name in incoming):
            self.journal({'commit':commit,'phase':'FUNCTIONS_UNCHANGED','names':[]})
            return
        before = self.root / commit / 'functions-before'
        if before.exists(): raise ValueError('Function operation already attempted; reconcile interruption')
        before.mkdir(mode=0o700)
        state = {'commit': commit, 'names': names, 'previousNames':previous, 'newNames':incoming, 'existed':[], 'phase': 'FUNCTIONS_PREPARING'}
        self.journal(state)
        # Finish every backup and staged replacement before changing any live
        # code. A failed copy cannot cause rollback to erase an unbacked worker.
        for name in names:
            current = live / name
            if current.is_symlink(): raise ValueError('Function symlink refused')
            if current.exists():
                if any(p.name.startswith('.env') or p.suffix in ['.pem','.key'] for p in current.rglob('*')): raise ValueError('Move Function-local secrets to protected configuration before deployment')
                shutil.copytree(current, before / name); state['existed'].append(name)
            prepared = staged_path(live,commit,name)
            if prepared.exists(): raise ValueError('Unresolved Function staging directory')
            if name in incoming: shutil.copytree(source / name, prepared)
        state['phase']='FUNCTIONS_CHANGING'; self.journal(state)
        self.command(['docker','stop','--time','30',self.c['functionsContainer']])
        for name in names:
            current = live/name; prepared = staged_path(live,commit,name)
            # Bind mount root stays in place; child-directory replacement is
            # visible inside the runtime. Drain before replacing shared modules.
            if current.exists(): shutil.rmtree(current)
            if name in incoming: prepared.rename(current)
        self.command(['docker','start',self.c['functionsContainer']])
        self.wait_functions()
        atomic_json(active_file,{'names':incoming})
        state['phase'] = 'FUNCTIONS_APPLIED'; self.journal(state)

    def journal(self, value):
        atomic_json(self.root/'state.json',value)

    def wait_functions(self):
        for _ in range(30):
            container=json.loads(self.command(['docker','inspect',self.c['functionsContainer']]))[0]
            state=container['State']
            if state.get('Running') and state.get('Health',{}).get('Status','healthy')=='healthy':return
            time.sleep(1)
        raise RuntimeError('Functions runtime did not become healthy')

    def rollback(self, commit):
        state = private_json(self.root / 'state.json')
        if state.get('commit') != commit: raise ValueError('Rollback identity mismatch')
        before = self.root / commit / 'functions-before'
        live = pathlib.Path(self.c['functionsDirectory'])
        if state['phase'] in ['SQL_APPLYING','SQL_APPLIED','FUNCTIONS_UNCHANGED','FUNCTIONS_PREPARING']:
            # No live Function was changed in these phases. In particular an
            # incomplete backup must never be interpreted as a deleted worker.
            for name in state['names']:
                prepared=staged_path(live,commit,name)
                if prepared.exists():shutil.rmtree(prepared)
            return {'status':'FUNCTIONS_UNCHANGED_SQL_PRESERVED'}
        if any(not (before/name).is_dir() for name in state['existed']):raise ValueError('Incomplete rollback backup')
        self.command(['docker','stop','--time','30',self.c['functionsContainer']])
        for name in state['names']:
            current = live / name
            if current.exists(): shutil.rmtree(current)
            if (before / name).exists(): shutil.copytree(before / name, current)
        self.command(['docker','start',self.c['functionsContainer']])
        self.wait_functions()
        atomic_json(self.root/'active-functions.json',{'names':state['previousNames']})
        state['phase'] = 'FUNCTIONS_ROLLED_BACK'; self.journal(state)
        return {'status': 'FUNCTIONS_ROLLED_BACK_SQL_PRESERVED'}

def main():
    parts = os.environ.get('SSH_ORIGINAL_COMMAND', '').split()
    if len(parts) not in [3, 4] or parts[0] != 'barber-backend' or parts[1] not in ['receive', 'preflight', 'apply', 'rollback'] or not SHA.fullmatch(parts[2]): raise ValueError('Restricted command refused')
    mode, commit = parts[1:3]
    config = private_json('/etc/barber-release/backend.json'); backend = Backend(config)
    if mode in ['apply','rollback'] and not config.get('enabled'):raise ValueError('Backend release path is disabled')
    with (backend.root / 'backend.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        target = backend.root / commit / 'source'
        if mode == 'receive':
            if len(parts) != 4 or not HASH.fullmatch(parts[3]): raise ValueError('Archive hash required')
            raw = sys.stdin.buffer.read(LIMIT + 1)
            if len(raw) > LIMIT or digest(raw) != parts[3]: raise ValueError('Received archive mismatch')
            if target.exists(): raise ValueError('Existing release requires operator reconciliation')
            target.mkdir(parents=True, mode=0o700)
            m = extract_bundle(raw, commit, target)
            atomic_json(backend.root / commit / 'manifest.json',m)
            result = {'status': 'RECEIVED'}
        else:
            m = private_json(backend.root / commit / 'manifest.json')
            result = {'status': 'PREFLIGHT_PASS', 'pendingMigrations': len(backend.preflight(target, m))} if mode == 'preflight' else backend.apply(target, m) if mode == 'apply' else backend.rollback(commit)
        print(json.dumps(result))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'status': 'BACKEND_BLOCKED', 'reason': type(error).__name__})); raise SystemExit(1)
