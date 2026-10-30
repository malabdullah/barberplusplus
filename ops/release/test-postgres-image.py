#!/usr/bin/env python3
"""Replay migrations/authorization tests on the exact production PostgreSQL.

Bootstrap uses schema-only platform metadata from the synthetic local CLI stack;
it does not claim identical production platform configuration or copy any rows.
"""
import hashlib, json, os, pathlib, re, subprocess, uuid

def main():
    root = pathlib.Path.cwd()
    if os.environ.get('DOCKER_HOST') or os.environ.get('DOCKER_CONTEXT'): raise ValueError('Docker endpoint overrides refused')
    def execute(args, data=None, check=True):
        p = subprocess.run(args, input=data, capture_output=True, timeout=240)
        if check and p.returncode:
            # This command consumes only the guarded synthetic profile/schema.
            # Keep a bounded diagnostic so platform-bootstrap failures are clear.
            raise RuntimeError('Synthetic compatibility command failed: ' + p.stderr.decode(errors='replace')[-2000:])
        return p.stdout
    context = json.loads(execute(['docker','context','inspect']))[0]
    endpoint = context['Endpoints']['docker']['Host']
    if not endpoint.startswith('unix:///'): raise ValueError('Local Unix Docker socket required')
    def docker(*args, data=None, check=True): return execute(['docker','--host',endpoint,*args],data,check)
    source = 'supabase_db_barber-local-test'
    info = json.loads(docker('inspect',source))[0]
    if info['Config']['Labels'].get('com.supabase.cli.project') != 'barber-local-test': raise ValueError('Synthetic source profile required')
    owner = json.loads(docker('volume','inspect','barber-local-test-workspace-owner'))[0]
    if owner['Labels'].get('barber.workspace') != str(root): raise ValueError('Source belongs to another checkout')
    image = json.loads((root/'ops/release/runtime-lock.json').read_text())['containers']['supabase-db']['digest']
    name = 'barber-postgres-compat-' + uuid.uuid4().hex[:10]
    # No role password hashes, table data, Vault contents or platform secrets.
    roles = docker('exec',source,'pg_dumpall','-U','supabase_admin','--roles-only','--no-role-passwords')
    # App-owned roles are recreated by their migrations, just like app-owned
    # Auth triggers and Storage policies below. Keep only platform role setup.
    roles = ('\n'.join(line for line in roles.decode().splitlines() if not re.match(r'^(CREATE|ALTER) ROLE "?barber_reminder_writer"?(?:\s|;)',line))+'\n').encode()
    platform = docker('exec',source,'pg_dump','-U','supabase_admin','-d','postgres','--format=custom','--schema-only','--no-owner','--exclude-schema=public','--exclude-schema=secure','--exclude-schema=private','--exclude-schema=supabase_migrations')
    started = False
    try:
        command = 'initdb -D /tmp/compat-pg --username=postgres --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /tmp/compat-pg -c listen_addresses= -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_cron,pg_net,pg_stat_statements -c cron.database_name=postgres -c cron.launch_active_jobs=off'
        docker('run','-d','--name',name,'--platform','linux/amd64','--label','barber.operation=postgres-compatibility','--network','none','--memory','1g','--cpus','1','--user','postgres','--tmpfs','/tmp:rw,size=768m','--entrypoint','/bin/bash',image,'-lc',command); started=True
        import time
        for _ in range(60):
            result = subprocess.run(['docker','--host',endpoint,'exec',name,'pg_isready','-h','/tmp','-U','postgres'],capture_output=True)
            if result.returncode==0: break
            time.sleep(1)
        else: raise RuntimeError('Compatibility database did not start')
        def sql(text, strict=True): return docker('exec','-i',name,'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP='+('1' if strict else '0'),data=text.encode(),check=strict).decode()
        sql(roles.decode(),False)
        docker('exec','-i',name,'sh','-c','cat > /tmp/platform.dump',data=platform)
        toc = docker('exec',name,'pg_restore','--list','/tmp/platform.dump').decode()
        # Exclude only application-owned Auth/Storage objects whose versioned
        # migrations reinstall them after their public/private dependencies.
        toc = '\n'.join(line for line in toc.splitlines() if not (
            ' TRIGGER auth users assign_default_manager_role ' in line or
            ' TRIGGER auth users block_guarded_role_changes ' in line or
            ' POLICY storage objects Barber avatars ' in line)) + '\n'
        docker('exec','-i',name,'sh','-c','cat > /tmp/platform.list',data=toc.encode())
        docker('exec',name,'pg_restore','-h','/tmp','-U','postgres','-d','postgres','--no-owner','--clean','--if-exists','--exit-on-error','--use-list=/tmp/platform.list','/tmp/platform.dump')
        for p in sorted((root/'supabase/migrations').glob('*.sql')): sql(p.read_text())
        for seed_name in ['seed.sql', 'seed-customer-booking.sql']:
            seed_path = root / 'supabase' / seed_name
            if seed_path.exists(): sql(seed_path.read_text())
        total = 0
        for p in sorted((root/'supabase/tests').glob('*.sql')):
            output = sql(p.read_text())
            plans = re.findall(r'^1\.\.(\d+)$',output,re.M)
            actual = re.findall(r'^ok\b',output,re.M)
            if re.search(r'^not ok\b',output,re.M) or len(plans)!=1 or len(actual)!=int(plans[0]): raise RuntimeError('Production image pgTAP failure: '+p.name)
            total += len(actual)
        print(json.dumps({'status':'PASS','image':image,'platform':'linux/amd64','network':'none','publishedPorts':0,'source':'schema-only synthetic CLI platform bootstrap; app migrations and synthetic seed replayed','productionRowsCopied':0,'authorizationTests':total}))
    finally:
        if started: docker('rm','-f',name,check=False)

if __name__=='__main__': main()
