"""Single hosted synthetic protocol proof; no Live/app/provider operations."""
import hashlib, importlib.util, json, os, pathlib, subprocess, time, uuid
from credential_protocol_probe import run_probe

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent

def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_EVENT_NAME') != 'push' or os.environ.get('GITHUB_REF') != 'refs/heads/codex/android-secret-transport-proof-20261120':
        raise ValueError('FIXED_HOSTED_PROOF_REQUIRED')
    if os.environ.get('DOCKER_HOST') or os.environ.get('DOCKER_CONTEXT'):
        raise ValueError('DOCKER_OVERRIDE_REFUSED')
    def command(args, data=None):
        r = subprocess.run(args, input=data, capture_output=True, timeout=180)
        if r.returncode:
            raise RuntimeError('SYNTHETIC_COMMAND_FAILED')
        return r.stdout
    pinned = '81b0f05d3be62febd7ae1087523cc5bd0e3d68a44cd4d1e33dc91ce0ca66a2b7'
    runtime = (ROOT / 'ops/release/runtime-lock.json').read_bytes()
    if hashlib.sha256(runtime).hexdigest() != pinned:
        raise ValueError('PINNED_RUNTIME_CHANGED')
    image = json.loads(runtime)['containers']['supabase-db']['digest']
    source = '7e0ef06761cb22e8df1c5cb35c02501ad0c181fc'
    if command(['git', 'rev-parse', 'HEAD:ops/release/runtime-lock.json']) != command(['git', 'rev-parse', source + ':ops/release/runtime-lock.json']):
        raise ValueError('SOURCE_RUNTIME_MISMATCH')
    context = json.loads(command(['docker', 'context', 'inspect']))[0]
    if not context['Endpoints']['docker']['Host'].startswith('unix:///'):
        raise ValueError('OWNED_LOCAL_RUNNER_SOCKET_REQUIRED')
    name = 'barber-secret-protocol-' + uuid.uuid4().hex[:10]
    started = False
    # Only the Vault fixture's own ephemeral root key is generated inside the
    # network-isolated tmpfs. No Google/dispatch credential is generated/read.
    startup = (
        "umask 077 && od -An -N32 -tx1 /dev/urandom | tr -d ' \\n' > /tmp/fixture-vault-key && "
        "printf '%s\\n' '#!/bin/sh' 'cat /tmp/fixture-vault-key' > /var/lib/postgresql/barber-fixture-getkey && "
        'chmod 700 /var/lib/postgresql/barber-fixture-getkey && '
        'initdb -D /tmp/fixture-pg --username=postgres --auth=trust >/tmp/init.log 2>&1 && '
        'exec postgres -D /tmp/fixture-pg -c listen_addresses= -c unix_socket_directories=/tmp '
        '-c shared_preload_libraries=pgsodium,supabase_vault '
        '-c pgsodium.getkey_script=/var/lib/postgresql/barber-fixture-getkey '
        '-c vault.getkey_script=/var/lib/postgresql/barber-fixture-getkey'
    )
    try:
        command(['docker', 'run', '-d', '--name', name, '--platform', 'linux/amd64', '--label', 'barber.operation=android-secret-protocol', '--network', 'none', '--memory', '768m', '--cpus', '1', '--user', 'postgres', '--tmpfs', '/tmp:rw,size=512m', '--entrypoint', '/bin/bash', image, '-lc', startup])
        started = True
        for _ in range(60):
            r = subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '/tmp', '-U', 'postgres'], capture_output=True, timeout=10)
            if r.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('SYNTHETIC_POSTGRES_START_FAILED')
        def sql(text):
            return command(['docker', 'exec', '-i', name, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], text.encode()).decode()
        sql('create role anon;create role authenticated;create role service_role;create role supabase_admin superuser;create schema extensions;create extension pgcrypto with schema extensions;create extension pgsodium;create extension supabase_vault;')
        result = run_probe(ROOT, sql, None, name)
        result.update({'frozenApplicationSource': source, 'proofHead': os.environ['GITHUB_SHA'], 'pinnedImage': image, 'network': 'none', 'publishedPorts': 0, 'fullAppOrGatewaySuitesRepeated': False, 'sourceHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in HERE.glob('*.py')}})
        path = pathlib.Path(os.environ['RUNNER_TEMP']) / 'android-secret-transport-proof.json'
        path.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    finally:
        if started:
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=30, check=True)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'SYNTHETIC_PROTOCOL_PROOF_FAILED', 'reason': str(error) if isinstance(error, ValueError) else type(error).__name__, 'rawErrorsPrinted': False, 'productionAccess': False}))
        raise SystemExit(1)
