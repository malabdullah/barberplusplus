#!/usr/bin/env python3
"""Rebuild a disposable platform from the pinned official images, never Live data.

No source database, host port, production credential or ordinary Test stack is
used. Only generated fixtures and the committed migration/seed/test source enter
the containers. All named resources are removed in finally.
"""
import argparse, base64, hashlib, hmac, json, os, pathlib, re, secrets
import importlib.util, subprocess, time, uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='.')
    parser.add_argument('--evidence', default='.release-private/platform-rehearsal.json')
    args = parser.parse_args()
    root = pathlib.Path(args.source).resolve()
    evidence = (root / args.evidence).resolve()
    if os.environ.get('DOCKER_HOST') or os.environ.get('DOCKER_CONTEXT'):
        raise ValueError('Docker endpoint overrides refused')
    lock = json.loads((root / 'ops/release/runtime-lock.json').read_text())
    operation = 'barber-deletion-compat-' + uuid.uuid4().hex[:10]
    network, database, auth, storage = [operation + '-' + x for x in ['net', 'db', 'auth', 'storage']]
    probe = operation + '-probe'
    containers = []
    network_created = False
    jwt_secret, password = secrets.token_hex(32), secrets.token_hex(24)
    sensitive = [jwt_secret, password]
    checks = []
    def redact(value):
        for secret in sensitive:
            value = value.replace(secret, '[synthetic-secret]')
        return re.sub(r'eyJ[A-Za-z0-9_.-]+', '[synthetic-jwt]', value)
    def execute(command, data=None, timeout=240, check=True):
        result = subprocess.run(command, input=data, capture_output=True, timeout=timeout)
        if check and result.returncode:
            raise RuntimeError(redact(result.stderr.decode(errors='replace')[-2000:]))
        return result.stdout + (result.stderr if 'logs' in command[:5] else b'')
    context = json.loads(execute(['docker', 'context', 'inspect']))[0]
    endpoint = context['Endpoints']['docker']['Host']
    if not endpoint.startswith('unix:///'):
        raise ValueError('Local Unix Docker socket required')
    def docker(*command, data=None, timeout=240, check=True):
        return execute(['docker', '--host', endpoint, *command], data, timeout, check)
    def token(role):
        encode = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')
        data = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({'role': role, 'iss': 'supabase', 'iat': int(time.time()), 'exp': int(time.time()) + 7200})
        return data + '.' + base64.urlsafe_b64encode(hmac.new(jwt_secret.encode(), data.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    service, anon = token('service_role'), token('anon')
    sensitive += [service, anon]
    def start(name, image_name, entrypoint, command, environment=None, extra=None):
        image = lock['containers'][image_name]['digest']
        arguments = ['run', '-d', '--name', name, '--platform', 'linux/amd64', '--network', network,
                     '--label', 'barber.operation=' + operation, '--memory', '768m', '--cpus', '1']
        for key, value in (environment or {}).items():
            arguments += ['-e', key + '=' + value]
        docker(*arguments, *(extra or []), '--entrypoint', entrypoint, image, *command)
        containers.append(name)
        state = json.loads(docker('inspect', name))[0]
        if state['Image'] != lock['containers'][image_name]['imageId']:
            raise RuntimeError('Pinned image identity mismatch')
        if any((state['NetworkSettings'].get('Ports') or {}).values()):
            raise RuntimeError('Public ports refused')
    def sql(query, strict=True):
        return docker('exec', '-i', database, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres',
                      '-X', '-qAt', '-v', 'ON_ERROR_STOP=' + ('1' if strict else '0'), data=query.encode(), check=strict).decode()
    def record(name):
        checks.append(name)
        print('PASS ' + name, flush=True)
    def request(url, method='GET', body=None, headers=None, raw=None, timeout_ms=10000):
        payload = {'body': raw} if raw is not None else {'body': json.dumps(body)} if body is not None else {}
        options = json.dumps({'method': method, 'headers': headers or {}, **payload})
        program = 'try {const r=await fetch(' + json.dumps(url) + ',{...' + options + ',signal:AbortSignal.timeout(' + str(timeout_ms) + ')}); const text=await r.text(); let value;try{value=JSON.parse(text)}catch{value=text};process.stdout.write(JSON.stringify({status:r.status,value}),()=>process.exit(0));}catch(error){console.error(String(error));process.exit(1);}'
        program = program.replace('http://127.0.0.1:5000', 'http://' + storage + ':5000')
        return json.loads(docker('exec', '-i', probe, 'node', '--input-type=module', data=program.encode(), timeout=timeout_ms / 1000 + 30))
    def wait_http(url):
        for _ in range(60):
            try:
                if request(url)['status'] == 200:
                    return
            except (RuntimeError, ValueError):
                pass
            time.sleep(1)
        raise RuntimeError('Synthetic service did not become healthy: ' + url)
    try:
        docker('network', 'create', '--internal', '--label', 'barber.operation=' + operation, network)
        network_created = True
        command = (
            "umask 077 && od -An -N32 -tx1 /dev/urandom | tr -d ' \\n' > /tmp/compat-vault-key && "
            "printf '%s\\n' '#!/bin/sh' 'cat /tmp/compat-vault-key' > /var/lib/postgresql/barber-compat-getkey && chmod 700 /var/lib/postgresql/barber-compat-getkey && "
            'initdb -D /tmp/compat-pg --username=supabase_admin --auth=trust >/tmp/init.log 2>&1 && '
            "printf '%s\\n' 'host all all 0.0.0.0/0 trust' >> /tmp/compat-pg/pg_hba.conf && "
            'exec postgres -D /tmp/compat-pg -c listen_addresses=* -c unix_socket_directories=/tmp '
            '-c shared_preload_libraries=pgsodium,supabase_vault,pg_cron,pg_net,pg_stat_statements '
            '-c pgsodium.getkey_script=/var/lib/postgresql/barber-compat-getkey -c vault.getkey_script=/var/lib/postgresql/barber-compat-getkey '
            '-c cron.database_name=postgres -c cron.launch_active_jobs=off'
        )
        start(database, 'supabase-db', '/bin/bash', ['-lc', command], extra=['--user', 'postgres', '--tmpfs', '/tmp:rw,size=768m'])
        for _ in range(60):
            if not json.loads(docker('inspect', database))[0]['State']['Running']:
                raise RuntimeError('Synthetic PostgreSQL exited during startup')
            p = subprocess.run(['docker', '--host', endpoint, 'exec', database, 'pg_isready', '-h', '/tmp', '-U', 'supabase_admin'], capture_output=True)
            if p.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Synthetic PostgreSQL failed startup')
        docker('exec', database, 'psql', '-h', '/tmp', '-U', 'supabase_admin', '-d', 'postgres', '-q', '-c', 'create role postgres login superuser;')
        for script in ['00000000000000-initial-schema.sql', '00000000000001-auth-schema.sql', '00000000000002-storage-schema.sql', '00000000000003-post-setup.sql']:
            sql(docker('exec', database, 'cat', '/docker-entrypoint-initdb.d/init-scripts/' + script).decode())
        sql(docker('exec', database, 'cat', '/docker-entrypoint-initdb.d/migrations/20211124212715_update-auth-owner.sql').decode())
        sql('create extension if not exists supabase_vault cascade; create extension if not exists pg_net; create extension if not exists pg_cron;')
        auth_environment = {'GOTRUE_API_HOST': '0.0.0.0', 'GOTRUE_API_PORT': '9999', 'API_EXTERNAL_URL': 'http://' + auth + ':9999',
            'GOTRUE_SITE_URL': 'http://synthetic.invalid', 'GOTRUE_DB_DRIVER': 'postgres',
            'GOTRUE_DB_DATABASE_URL': 'postgres://supabase_auth_admin:' + password + '@' + database + ':5432/postgres',
            'GOTRUE_JWT_SECRET': jwt_secret, 'GOTRUE_JWT_EXP': '3600', 'GOTRUE_JWT_AUD': 'authenticated',
            'GOTRUE_JWT_DEFAULT_GROUP_NAME': 'authenticated',
            'GOTRUE_JWT_ADMIN_ROLES': 'service_role', 'GOTRUE_EXTERNAL_EMAIL_ENABLED': 'true',
            'GOTRUE_MAILER_AUTOCONFIRM': 'true', 'GOTRUE_DISABLE_SIGNUP': 'false'}
        auth_migrate = operation + '-auth-migrate'
        start(auth_migrate, 'supabase-auth', '/usr/local/bin/auth', ['migrate'], auth_environment)
        if docker('wait', auth_migrate, timeout=180).decode().strip() != '0':
            raise RuntimeError('Pinned Auth migration command failed')
        record('official pinned Auth migrations applied before API startup')
        start(auth, 'supabase-auth', '/usr/local/bin/auth', ['serve'], auth_environment)
        storage_environment = {'PORT': '5000', 'HOST': '0.0.0.0', 'TENANT_ID': 'synthetic', 'REGION': 'local',
            'DATABASE_URL': 'postgres://supabase_storage_admin:' + password + '@' + database + ':5432/postgres',
            'ANON_KEY': anon, 'SERVICE_KEY': service, 'PGRST_JWT_SECRET': jwt_secret, 'JWT_SECRET': jwt_secret,
            'STORAGE_BACKEND': 'file', 'FILE_STORAGE_BACKEND_PATH': '/tmp/objects', 'GLOBAL_S3_BUCKET': 'synthetic',
            'POSTGREST_URL': 'http://127.0.0.1:1', 'ENABLE_IMAGE_TRANSFORMATION': 'false'}
        start(storage, 'supabase-storage', '/usr/local/bin/node', ['/app/dist/start/server.js'], storage_environment,
              extra=['--tmpfs', '/tmp:rw,size=128m'])
        start(probe, 'supabase-storage', '/usr/local/bin/node', ['-e', 'setInterval(()=>{},1000)'])
        wait_http('http://' + auth + ':9999/health')
        wait_http('http://127.0.0.1:5000/status')
        if sql("select to_regprocedure('auth.jwt()') is not null;").strip() != 't':
            raise RuntimeError('Official Auth bootstrap omitted JWT helper')
        for script in ['20211115181400_update-auth-permissions.sql', '20220609081115_grant-supabase-auth-admin-and-supabase-storage-admin-to-postgres.sql', '20230327032006_grant_auth_roles_to_supabase_storage_admin.sql']:
            sql(docker('exec', database, 'cat', '/docker-entrypoint-initdb.d/migrations/' + script).decode())
        record('pinned PostgreSQL, Auth and Storage healthy; internal network, no public ports')
        migrations = sorted((root / 'supabase/migrations').glob('*.sql'))
        observed = root / '.release-private/production-readiness.jsonl'
        baseline_comparison = None
        for migration in migrations:
            if migration.name == '20261113131730_customer_account_deletion.sql' and observed.exists():
                baseline = json.loads(sql((root / 'ops/account-deletion/readiness.sql').read_text()))
                production = next(json.loads(line)['catalogue'] for line in observed.read_text().splitlines() if 'catalogue' in json.loads(line))
                differences = []
                for kind, keys in [('relations', ('schema', 'name')), ('routines', ('schema', 'name', 'args')), ('policies', ('schema', 'table', 'name'))]:
                    actual = {tuple(item[key] for key in keys): item for item in baseline[kind]}
                    for item in production[kind]:
                        identity = tuple(item[key] for key in keys)
                        if actual.get(identity) != item:
                            differences.append({'kind': kind, 'object': '.'.join(identity)})
                baseline_comparison = {'comparedRelations': len(production['relations']), 'comparedRoutines': len(production['routines']), 'comparedPolicies': len(production['policies']), 'differences': differences}
                (root / '.release-private/rebuilt-baseline-metadata.json').write_text(json.dumps(baseline, indent=2))
                (root / '.release-private/rebuilt-baseline-comparison.json').write_text(json.dumps(baseline_comparison, indent=2))
                if differences:
                    raise RuntimeError('Rebuilt baseline differs from observed production metadata: ' + json.dumps(differences))
                record('rebuilt baseline matches every selected production relation/routine/policy')
                # Synthetic-only operator config. Cron is disabled and this
                # internal network cannot contact that public destination.
                sql("update private.customer_booking_email_runtime set api_url='https://srv1073968.hstgr.cloud' where singleton;")
            try:
                sql(migration.read_text())
            except RuntimeError as error:
                raise RuntimeError('Migration ' + migration.name + ': ' + str(error)) from None
        record('all committed main and scoped deletion migrations replayed')
        schema = docker('exec', '-i', database, '/bin/bash', '-s', data=(root / 'ops/account-deletion/dump-rehearsal-schema.sh').read_bytes())
        schema_path = root / '.release-private/rehearsal-public-schema.sql'
        schema_path.write_bytes(schema)
        schema_path.chmod(0o600)
        schema_spec = importlib.util.spec_from_file_location('schema_normalizer', root / 'scripts/normalize-schema.py')
        normalizer = importlib.util.module_from_spec(schema_spec)
        schema_spec.loader.exec_module(normalizer)
        reviewed_roles = 'CREATE POLICY "Service role full access to rate_limits" ON "public"."rate_limits" TO "anon", "authenticated" USING (false) WITH CHECK (false);'
        original_roles = 'CREATE POLICY "Service role full access to rate_limits" ON "public"."rate_limits" TO "authenticated", "anon" USING (false) WITH CHECK (false);'
        actual_schema = normalizer.normalize(schema.decode()).replace(reviewed_roles, original_roles)
        if actual_schema != normalizer.normalize((root / 'supabase/schema.expected.sql').read_text()):
            raise RuntimeError('Rehearsed public schema differs from the reviewed expected schema')
        record('public schema matches reviewed snapshot, with only previously approved equivalent role ordering ignored')
        for seed in ['seed.sql', 'seed-customer-booking.sql']:
            path = root / 'supabase' / seed
            if path.exists():
                sql(path.read_text())
        total = 0
        suites = []
        failures = []
        for suite in sorted((root / 'supabase/tests').glob('*.sql')):
            try:
                output = sql(suite.read_text())
            except RuntimeError as error:
                output = str(error)
            plans = re.findall(r'^1\.\.(\d+)$', output, re.M)
            results = re.findall(r'^ok\b', output, re.M)
            passed = not re.search(r'^not ok\b', output, re.M) and len(plans) == 1 and len(results) == int(plans[0])
            suites.append({'suite': suite.name, 'passed': passed, 'assertions': len(results)})
            if not passed:
                failures.append(suite.name)
                diagnostic = root / '.release-private' / (suite.stem + '.log')
                diagnostic.write_text(redact(output))
                diagnostic.chmod(0o600)
            total += len(results)
        print(json.dumps({'databaseSuites': suites}), flush=True)
        if not failures:
            record(str(total) + ' database assertions passed')
        spec = importlib.util.spec_from_file_location('platform_scenarios', root / 'ops/account-deletion/platform_scenarios.py')
        scenarios = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(scenarios)
        scenarios.run(sql, request, record, 'http://' + auth + ':9999', 'http://' + storage + ':5000', service, anon)
        if failures:
            raise RuntimeError('Database suites still failing: ' + ', '.join(failures))
        evidence.parent.mkdir(parents=True, exist_ok=True)
        evidence.write_text(json.dumps({'status': 'PASS', 'checks': checks, 'authorizationAssertions': total,
            'platformImages': {key: lock['containers'][key] for key in ['supabase-db', 'supabase-auth', 'supabase-storage']},
            'bootstrap': 'stock verified images; no existing Test or production database dump',
            'observedBaselineComparison': baseline_comparison,
            'databaseSuites': suites,
            'productionRowsCopied': 0, 'productionCredentials': False, 'publishedPorts': 0, 'network': 'internal'}, indent=2) + '\n')
        evidence.chmod(0o600)
    except Exception as error:
        for name in containers:
            try:
                logs = docker('logs', '--tail', '20', name, check=False).decode(errors='replace')
                print(redact(name + '\n' + logs[-2000:]), flush=True)
            except Exception:
                pass
        raise RuntimeError(redact(str(error))) from None
    finally:
        for name in reversed(containers):
            existing = docker('inspect', name, check=False)
            if existing:
                state = json.loads(existing)[0]
                if state['Config'].get('Labels', {}).get('barber.operation') == operation:
                    docker('rm', '-f', name, check=False)
        if network_created:
            existing = docker('network', 'inspect', network, check=False)
            if existing and json.loads(existing)[0].get('Labels', {}).get('barber.operation') == operation:
                docker('network', 'rm', network, check=False)
        print('Removed only scoped rehearsal resources', flush=True)


if __name__ == '__main__':
    main()
