"""Bind the exact candidate SQL to a rollback-only namespace on hosted Test.

Auth/session and announcement-author checks delegate to deployed Test helpers.
iOS delegation and production runtime binding are contract doubles. No existing
function/table is replaced. No provider credential/network call is included.
"""
from pathlib import Path
import hashlib

root = Path(__file__).resolve().parents[3]
schema = 'qa_android_ann_1125'
sources = [root/'supabase/migrations'/n for n in (
    '20261125035222_android_announcements_transport.sql',
    '20261125095228_android_announcement_single_acceptance.sql',
    '20261125101118_android_registration_single_acceptance.sql')]
setup = f'''begin;
set local statement_timeout='55s';
create schema {schema};
create table {schema}.users(id uuid primary key,active boolean default true,admin boolean default false);
create table {schema}.sessions(id uuid primary key,user_id uuid references {schema}.users);
create table {schema}.delegations(n integer default 0);insert into {schema}.delegations values(0);
create table {schema}.vault_decrypted_secrets(name text,decrypted_secret text);
'''
for name in ('android_live_push_devices','android_live_push_runtime','android_live_push_closed','android_live_push_deliveries','announcement_deliveries','announcement_targets','announcement_campaigns',
             'announcement_preferences','customer_push_preferences','announcement_runtime'):
    setup += f'create table {schema}.{name}(like private.{name} including defaults including constraints including indexes);\n'
setup += f'''
create function {schema}.android_live_push_owner(u uuid,s uuid)returns boolean language sql as $$select private.android_live_push_owner(u,s)$$;
create function {schema}.android_live_push_bound(r {schema}.android_live_push_runtime)returns boolean language sql as $$select r.api_url='https://srv1073968.hstgr.cloud'$$;
create function {schema}.announcement_author_allowed(u uuid)returns boolean language sql as $$select private.announcement_author_allowed(u)$$;
create function {schema}.customer_announcement_api(text,jsonb)returns jsonb language sql as $$select '{{"ios":true}}'::jsonb$$;
create function {schema}.announcement_audience(jsonb)returns jsonb language plpgsql as $$begin
 -- left join {schema}.announcement_eligible_devices d on d.account_id=a.id
 return '{{}}';end$$;
create function {schema}.announcement_summary(uuid)returns jsonb language plpgsql as $$begin
 -- from {schema}.announcement_deliveries
 return '{{}}';end$$;
create function {schema}.admin_push_api(text,jsonb)returns jsonb language sql as $$select '{{}}'::jsonb$$;
create function {schema}.admin_push_worker(p_action text,p_data jsonb)returns jsonb language plpgsql as $$begin
 if p_action='configuration'then return jsonb_build_object('dispatchSecret',repeat('d',64));end if;
 update {schema}.delegations set n=n+1;return '[]';end$$;
create function {schema}.android_live_push_dispatch(text,jsonb)returns jsonb language sql as $$select '{{"enabled":false}}'::jsonb$$;
create function {schema}.kick_admin_push()returns void language sql as $$select null::void$$;
create view {schema}.customer_accounts as select * from private.customer_accounts where user_id='adab1125-0000-4000-8000-000000000001';
'''
base=(root/'supabase/migrations/20261120154434_android_live_fcm_transport.sql').read_text()
base=base[base.index('create function private.android_live_push_api('):base.index('create function private.android_live_push_configure(')]
setup+=base.replace('private.',schema+'.')
sql = setup
for source in sources:
    raw=source.read_text().strip()
    assert raw.startswith(('begin;', '--')) and raw.endswith('commit;')
    start=raw.index('begin;')
    body=raw[start+len('begin;'):-len('commit;')]
    body=body.replace('private.',schema+'.').replace('auth.users',schema+'.users').replace('auth.sessions',schema+'.sessions').replace('vault.decrypted_secrets',schema+'.vault_decrypted_secrets')
    body=body.replace('from '+schema+'.users person','from auth.users person')
    body=body.replace("notify pgrst,'reload schema';",'')
    sql += '\n'+body+'\n'
sql += (Path(__file__).parent/'rehearsal_checks.sql').read_text().replace('qa.',schema+'.')
sql += '\nrollback;\n'
out=Path(__file__).parent/'rehearsal.generated.sql'
out.write_text(sql)
print({'queryFile':str(out),'sourceSHA256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}})
