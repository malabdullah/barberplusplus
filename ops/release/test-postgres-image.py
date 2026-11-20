#!/usr/bin/env python3
"""Replay migrations/authorization tests on the exact production PostgreSQL.

Bootstrap uses schema-only platform metadata from the synthetic local CLI stack;
it does not claim identical production platform configuration or copy any rows.
"""
import concurrent.futures, datetime, hashlib, json, os, pathlib, re, subprocess, threading, uuid

def platform_objects_for_replay(toc):
    # Application migrations recreate these only after their dependencies exist.
    owned = (
        ' TRIGGER auth users assign_default_manager_role ',
        ' TRIGGER auth users block_guarded_role_changes ',
        ' TRIGGER auth users block_customer_recovery_role_changes ',
        ' TRIGGER auth users enforce_global_phone ',
        ' TRIGGER auth users sync_customer_confirmed_email ',
        ' TRIGGER auth users sync_personal_work_contact ',
        ' TRIGGER auth users enforce_customer_password_proof ',
        ' TRIGGER auth users guard_account_email ',
        ' TRIGGER auth sessions detach_customer_session_push ',
        ' TRIGGER auth sessions android_live_push_session_retire ',
        ' POLICY storage objects Barber avatars ',
        ' POLICY storage objects Enrolled staff require verified MFA ',
        ' POLICY storage objects Storage requires a live account session ',
    )
    return '\n'.join(line for line in toc.splitlines() if not any(item in line for item in owned)) + '\n'

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
    # These schemas and the migration ledger are created during the replay.
    replayed_schemas = ('public', 'secure', 'private', 'shop_handover', 'shop_publishing', 'subscription_billing', 'supabase_migrations')
    platform = docker(
        'exec', source, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres',
        '--format=custom', '--schema-only', '--no-owner',
        *(f'--exclude-schema={schema}' for schema in replayed_schemas),
    )
    started = False
    try:
        # Vault writes need pgsodium's server-key mode. Generate a fresh key
        # inside this network-isolated container's tmpfs, never from the source
        # profile or production. Neither the key nor its contents leave /tmp.
        # Vault embeds its own key state: preloading pgsodium alone does not
        # initialize supabase_vault. Both use this synthetic per-container key.
        # https://github.com/supabase/vault/blob/main/src/supabase_vault.c
        command = (
            "umask 077 && od -An -N32 -tx1 /dev/urandom | tr -d ' \\n' > /tmp/compat-vault-key && "
            "printf '%s\\n' '#!/bin/sh' 'cat /tmp/compat-vault-key' > /var/lib/postgresql/barber-compat-getkey && "
            'chmod 700 /var/lib/postgresql/barber-compat-getkey && '
            'initdb -D /tmp/compat-pg --username=postgres --auth=trust >/tmp/init.log 2>&1 && '
            'exec postgres -D /tmp/compat-pg -c listen_addresses= -c unix_socket_directories=/tmp '
            '-c shared_preload_libraries=pgsodium,supabase_vault,pg_cron,pg_net,pg_stat_statements '
            '-c pgsodium.getkey_script=/var/lib/postgresql/barber-compat-getkey '
            '-c vault.getkey_script=/var/lib/postgresql/barber-compat-getkey '
            '-c cron.database_name=postgres -c cron.launch_active_jobs=off'
        )
        docker('run','-d','--name',name,'--platform','linux/amd64','--label','barber.operation=postgres-compatibility','--network','none','--memory','1g','--cpus','1','--user','postgres','--tmpfs','/tmp:rw,size=768m','--entrypoint','/bin/bash',image,'-lc',command); started=True
        import time
        for _ in range(60):
            result = subprocess.run(['docker','--host',endpoint,'exec',name,'pg_isready','-h','/tmp','-U','postgres'],capture_output=True)
            if result.returncode==0: break
            time.sleep(1)
        else:
            # Only this synthetic container's startup log; mask any accidental
            # 32-byte hex value before including a bounded diagnostic.
            logs = subprocess.run(['docker','--host',endpoint,'logs',name], capture_output=True, timeout=30)
            startup = (logs.stdout + logs.stderr).decode(errors='replace')[-2000:]
            startup = re.sub(r'\b[0-9a-fA-F]{64}\b', '[redacted]', startup)
            raise RuntimeError('Compatibility database did not start: ' + startup)
        def sql(text, strict=True): return docker('exec','-i',name,'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP='+('1' if strict else '0'),data=text.encode(),check=strict).decode()
        sql(roles.decode(),False)
        docker('exec','-i',name,'sh','-c','cat > /tmp/platform.dump',data=platform)
        toc = docker('exec',name,'pg_restore','--list','/tmp/platform.dump').decode()
        # Exclude only application-owned Auth/Storage objects whose versioned
        # migrations reinstall them after their public/private dependencies.
        toc = platform_objects_for_replay(toc)
        docker('exec','-i',name,'sh','-c','cat > /tmp/platform.list',data=toc.encode())
        docker('exec',name,'pg_restore','-h','/tmp','-U','postgres','-d','postgres','--no-owner','--clean','--if-exists','--exit-on-error','--use-list=/tmp/platform.list','/tmp/platform.dump')
        # Verify the actual Vault encryption path, not just pgsodium's separate
        # root-key state. Return a marker only, and roll back the synthetic row.
        bootstrap = sql("""
begin;
do $probe$
declare probe_id uuid;
begin
  if position('supabase_vault' in current_setting('shared_preload_libraries'))=0
    or current_setting('vault.getkey_script',true) is distinct from '/var/lib/postgresql/barber-compat-getkey'
  then raise exception 'COMPATIBILITY_VAULT_NOT_PRELOADED'; end if;
  probe_id:=vault.create_secret('synthetic compatibility probe','barber-compat-bootstrap-probe');
  if not exists(select 1 from vault.decrypted_secrets where id=probe_id and decrypted_secret='synthetic compatibility probe')
  then raise exception 'COMPATIBILITY_VAULT_ROUNDTRIP_FAILED'; end if;
end $probe$;
rollback;
select 'COMPATIBILITY_VAULT_READY';
""")
        if bootstrap.strip() != 'COMPATIBILITY_VAULT_READY': raise RuntimeError('Compatibility Vault readiness probe failed')
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
        # Two separate psql connections on this owned, network-isolated exact
        # production image prove overlap. Hosted SQL tools serialize commands.
        ids = {key: str(uuid.uuid4()) for key in ['manager','shop','service','one','two','three','four']}
        sql(f"""
insert into auth.users(id,email,raw_app_meta_data)values('{ids['manager']}','{ids['manager']}@example.test','{{"role":"manager"}}');
insert into public.branches(id,manager_id,name)values('{ids['shop']}','{ids['manager']}','Isolated capacity QA');
insert into public.services(id,branch_id,name,duration,price)values('{ids['service']}','{ids['shop']}','QA Cut',30,3);
""" + 'insert into public.barbers(id,branch_id,name,status,management_mode,service_ids)values' + ','.join(
            f"('{ids[key]}','{ids['shop']}','QA {key}','{'active' if key in ['one','two'] else 'inactive'}','managed',array['{ids['service']}']::uuid[])"
            for key in ['one','two','three','four']) + f""";
update private.billing_subscriptions set paid_capacity=3,period_started_at=clock_timestamp()-interval'15 days',period_ends_at=clock_timestamp()+interval'15 days'where business_id=(select business_id from private.billing_shops where branch_id='{ids['shop']}');
update private.billing_enforcement set enabled=true;
""")
        barrier = threading.Barrier(2)
        def activate(key):
            barrier.wait(timeout=10)
            output = sql(f"""begin;
create temp table capacity_outcome(started timestamptz,finished timestamptz,result text)on commit drop;
do $probe$declare t timestamptz:=clock_timestamp();begin begin
 update public.barbers set status='active'where id='{ids[key]}';perform pg_sleep(3);
 insert into capacity_outcome values(t,clock_timestamp(),'activated');
exception when others then insert into capacity_outcome values(t,clock_timestamp(),sqlerrm);end;end$probe$;
select row_to_json(r)from capacity_outcome r;commit;""")
            return json.loads(output.strip())
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(activate,['three','four']))
        parse = datetime.datetime.fromisoformat
        if sorted(r['result'] for r in results) != ['BILLING_CAPACITY_REQUIRED','activated']:
            raise RuntimeError('Concurrent capacity outcome was not exactly one activation/one denial')
        if max(parse(r['started']) for r in results) >= min(parse(r['finished']) for r in results):
            raise RuntimeError('Capacity connections did not actually overlap')
        if sql(f"select private.billing_active_count(business_id)from private.billing_shops where branch_id='{ids['shop']}';").strip() != '3':
            raise RuntimeError('Concurrent capacity exceeded three paid places')
        print(json.dumps({'subscriptionConcurrency':'PASS','overlappingConnections':2,'activated':1,'capacityDenied':1,'activeCount':3,'paidCapacity':3,'productionAccess':False}))
        print(json.dumps({'status':'PASS','image':image,'platform':'linux/amd64','network':'none','publishedPorts':0,'source':'schema-only synthetic CLI platform bootstrap; app migrations and synthetic seed replayed','productionRowsCopied':0,'authorizationTests':total}))
    except Exception as error:
        # SQL-stage failures need the same bounded, redacted startup evidence
        # as boot failures. Never expose the ephemeral encryption key.
        diagnostic = ''
        if started:
            try:
                logs = subprocess.run(['docker','--host',endpoint,'logs',name],capture_output=True,timeout=30)
                diagnostic = (logs.stdout + logs.stderr).decode(errors='replace')[-2000:]
            except Exception:
                diagnostic = 'Startup diagnostics unavailable'
        message = re.sub(r'\b[0-9a-fA-F]{64}\b','[redacted]',str(error) + '\nCompatibility startup diagnostics: ' + diagnostic)
        raise RuntimeError(message) from None
    finally:
        if started: docker('rm','-f',name,check=False)

if __name__=='__main__': main()
