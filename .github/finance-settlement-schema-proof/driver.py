"""One fixed hosted synthetic supplement; never a production execution path."""
import hashlib, json, os, pathlib, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = 'f14c2ff8cd05956186bbe52dda90fe377f61d371'
BRANCH = 'refs/heads/codex/reconciliation-schema-proof-20261121'

def verify(root):
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_EVENT_NAME') != 'push' or os.environ.get('GITHUB_REF') != BRANCH:
        raise ValueError('Exact hosted supplement push required')
    m = json.loads((HERE / 'manifest.json').read_text())
    if m['source'] != SOURCE or subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip() != SOURCE:
        raise ValueError('Frozen application source required')
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=root, text=True).strip():
        raise ValueError('Application tracked source changed')
    for name, expected in m['sourceFileSha256'].items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Source input differs: ' + name)
    rows = [{'name': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted((root / 'supabase/migrations').glob('*.sql'))]
    if rows != m['baselineMigrations'] + m['pendingMigrations'] or len(rows) != 157:
        raise ValueError('Migration input differs')
    if hashlib.sha256((HERE / 'gateway-schema-only.sql').read_bytes()).hexdigest() != m['fixtureSha256']:
        raise ValueError('Gateway fixture differs')
    return m

def main():
    root = pathlib.Path.cwd()
    verify(root)
    # Execute the unchanged, hash-pinned synthetic image harness with exactly
    # its migration-loop call replaced. No installed backend/controller code,
    # automatic_sql policy, tests, seed, bootstrap or cleanup is replaced.
    source = (root / 'ops/release/test-postgres-image.py').read_text()
    old = "        for p in sorted((root/'supabase/migrations').glob('*.sql')): sql(p.read_text())"
    new = '        from gateway_schema_proof import replay_migrations\n        replay_migrations(root, sql, docker, name)'
    if source.count(old) != 1:
        raise ValueError('Exact pinned replay boundary missing')
    sys.path.insert(0, str(HERE))
    exec(compile(source.replace(old, new), 'PINNED_SYNTHETIC_IMAGE_HARNESS', 'exec'), {'__name__': '__main__'})

if __name__ == '__main__':
    main()
