begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(13);

insert into auth.sessions(id,user_id,created_at) values
  ('dc110000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',now()),
  ('dc110000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',now()),
  ('dc110000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001',now()),
  ('dc110000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003',now());
insert into private.account_activity(kind,branch_id,actor_user_id,actor_role) values
  ('shop_hours_changed','10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','manager'),
  ('booking_deadlines_changed',null,'00000000-0000-4000-8000-000000000001','admin');
select ok(not has_table_privilege('authenticated','private.account_activity','SELECT'),'activity table is private');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","session_id":"dc110000-0000-4000-8000-000000000003","aal":"aal1"}',true);
select throws_ok('select public.enforce_account_session()','42501','ADMIN_MFA_REQUIRED','admin needs MFA');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","session_id":"dc110000-0000-4000-8000-000000000003","aal":"aal2"}',true);
select throws_ok('select public.enforce_account_session()','42501','ADMIN_MFA_REQUIRED','AAL2 claims require a verified TOTP session');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002","session_id":"dc110000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select is((select count(*) from jsonb_array_elements(public.account_sessions()) item where item->>'id' like 'dc110000-%'),2::bigint,
  'manager sees only their own new sessions');
select ok(not exists(select 1 from jsonb_array_elements(public.account_sessions('dc110000-0000-4000-8000-000000000004')) item
  where item->>'id'='dc110000-0000-4000-8000-000000000004'),'other account session is not exposed');
select throws_ok($$select public.account_sessions('dc110000-0000-4000-8000-000000000001')$$,
  'P0001','USE_SIGN_OUT_FOR_CURRENT_SESSION','current session has its own sign-out action');
select is((select array_agg(item->>'id') from jsonb_array_elements(public.account_sessions('dc110000-0000-4000-8000-000000000002')) item
  where item->>'id' like 'dc110000-%'),array['dc110000-0000-4000-8000-000000000001'],'ending another session keeps the current session');
select ok((select bool_and(item->>'kind' <> 'booking_deadlines_changed') from jsonb_array_elements(public.account_activity()) item),
  'manager sees shop activity without platform policy activity');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002","session_id":"dc110000-0000-4000-8000-000000000002","aal":"aal1"}',true);
select throws_ok('select public.account_sessions()','PT401','SESSION_ENDED','ended token cannot use account APIs');
reset role;
select ok((select not_after is null from auth.sessions where id='dc110000-0000-4000-8000-000000000004'),'other account session remains live');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002","session_id":"dc110000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select is(public.account_realtime_not_revoked(),true,'current live session can receive authorized realtime rows');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002","session_id":"dc110000-0000-4000-8000-000000000002","aal":"aal1"}',true);
select is(public.account_realtime_not_revoked(),false,'ended session cannot receive realtime rows');
reset role;
select ok(not exists (
  select 1 from pg_constraint
  where conrelid='private.account_revoked_sessions'::regclass and contype='f'
), 'revocation markers have no cascade dependency on Auth session cleanup');
select * from finish();
rollback;
