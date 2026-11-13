begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
select ok(not has_function_privilege('anon','public.increment_customer_booking_count(uuid,date)','EXECUTE'),'anonymous cannot mutate booking aggregates');
select ok(not has_function_privilege('authenticated','public.increment_customer_booking_count(uuid,date)','EXECUTE'),'staff cannot mutate booking aggregates directly');
insert into auth.users(id,email,raw_app_meta_data) values
 ('ed120000-0000-4000-8000-000000000001','security-admin@example.test','{"role":"admin"}'),
 ('ed120000-0000-4000-8000-000000000002','security-manager@example.test','{"role":"manager"}');
insert into auth.mfa_factors(created_at,updated_at,id,user_id,factor_type,status) values
 (now(),now(),'ed120000-0000-4000-8000-000000000011','ed120000-0000-4000-8000-000000000001','totp','verified'),
 (now(),now(),'ed120000-0000-4000-8000-000000000012','ed120000-0000-4000-8000-000000000002','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values
 ('ed120000-0000-4000-8000-000000000021','ed120000-0000-4000-8000-000000000001','aal2','ed120000-0000-4000-8000-000000000011'),
 ('ed120000-0000-4000-8000-000000000022','ed120000-0000-4000-8000-000000000002','aal1',null);
select ok(not public.staff_token_factor_satisfied('ed120000-0000-4000-8000-000000000002','ed120000-0000-4000-8000-000000000022','aal1'),'enrolled manager requires step-up');
update auth.sessions set aal='aal2',factor_id='ed120000-0000-4000-8000-000000000012' where id='ed120000-0000-4000-8000-000000000022';
select ok(not public.staff_token_factor_satisfied('ed120000-0000-4000-8000-000000000002','ed120000-0000-4000-8000-000000000022','aal1'),'old token remains denied after session upgrade');
select ok(public.staff_token_factor_satisfied('ed120000-0000-4000-8000-000000000002','ed120000-0000-4000-8000-000000000022','aal2'),'verified manager token accepted');
select set_config('request.jwt.claims','{"sub":"ed120000-0000-4000-8000-000000000001","session_id":"ed120000-0000-4000-8000-000000000021","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
select lives_ok($$select public.set_manager_account_enabled('ed120000-0000-4000-8000-000000000002',false)$$,'admin can suspend a manager with no shops');
select ok((select banned_until>now() from auth.users where id='ed120000-0000-4000-8000-000000000002'),'suspension applies to Auth identity');
select ok((select not_after<=now() from auth.sessions where id='ed120000-0000-4000-8000-000000000022'),'suspension ends existing sessions');
select ok(exists(select 1 from private.account_revoked_sessions where session_id='ed120000-0000-4000-8000-000000000022'),'suspension invalidates open Realtime subscriptions');
select is((select is_active from public.admin_manager_statuses() where id='ed120000-0000-4000-8000-000000000002'),false,'admin list reflects account status');
select lives_ok($$select public.set_manager_account_enabled('ed120000-0000-4000-8000-000000000002',true)$$,'admin can restore account');
select ok((select banned_until is null from auth.users where id='ed120000-0000-4000-8000-000000000002'),'restoration clears Auth ban');
select ok((select not_after<=now() from auth.sessions where id='ed120000-0000-4000-8000-000000000022'),'restoration does not revive ended sessions');
select ok(not has_function_privilege('authenticated','public.staff_token_factor_satisfied(uuid,uuid,text)','EXECUTE'),'service assurance RPC remains private');
select * from finish();
rollback;
