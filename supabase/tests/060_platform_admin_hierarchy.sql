-- Every fixture and administrative action rolls back. No existing identity is changed.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)values
 ('ad151500-0000-4000-8000-000000000001','hierarchy-super@example.test',now(),'{"role":"admin"}','{"name":"QA Super Admin"}'),
 ('ad151500-0000-4000-8000-000000000002','hierarchy-admin@example.test',now(),'{"role":"agent"}','{"name":"QA Admin"}'),
 ('ad151500-0000-4000-8000-000000000003','hierarchy-manager@example.test',now(),'{"role":"manager"}','{"name":"QA Manager","role":"admin"}'),
 ('ad151500-0000-4000-8000-000000000004','hierarchy-customer@example.test',now(),'{"role":"customer"}','{"name":"QA Customer"}'),
 ('ad151500-0000-4000-8000-000000000005','hierarchy-unverified@example.test',null,'{"role":"customer"}','{"name":"QA Unverified"}'),
 ('ad151500-0000-4000-8000-000000000006','hierarchy-target@example.test',now(),'{"role":"agent"}','{"name":"QA Target"}'),
 ('ad151500-0000-4000-8000-000000000007','hierarchy-no-mfa@example.test',now(),'{"role":"agent"}','{"name":"QA No MFA"}');
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,created_at,updated_at)values
 ('ad151500-0000-4000-8000-000000000011','ad151500-0000-4000-8000-000000000001','totp','verified','synthetic-test-only',now(),now()),
 ('ad151500-0000-4000-8000-000000000012','ad151500-0000-4000-8000-000000000002','totp','verified','synthetic-test-only',now(),now());
insert into auth.sessions(id,user_id,aal,factor_id)values
 ('ad151500-0000-4000-8000-000000000021','ad151500-0000-4000-8000-000000000001','aal2','ad151500-0000-4000-8000-000000000011'),
 ('ad151500-0000-4000-8000-000000000022','ad151500-0000-4000-8000-000000000002','aal2','ad151500-0000-4000-8000-000000000012'),
 ('ad151500-0000-4000-8000-000000000023','ad151500-0000-4000-8000-000000000003','aal1',null),
 ('ad151500-0000-4000-8000-000000000024','ad151500-0000-4000-8000-000000000004','aal1',null),
 ('ad151500-0000-4000-8000-000000000027','ad151500-0000-4000-8000-000000000007','aal1',null);
select ok(not has_function_privilege('anon','public.manage_administrators(text,jsonb)','EXECUTE'),'anonymous cannot manage administrators');
select ok(has_function_privilege('authenticated','public.manage_administrators(text,jsonb)','EXECUTE'),'authenticated API still checks live Super Admin capability');
select ok(not private.staff_session_factor_satisfied('ad151500-0000-4000-8000-000000000007','ad151500-0000-4000-8000-000000000027'),'Admin without any enrolled MFA has no administrative access');
select set_config('request.jwt.claims','{"sub":"ad151500-0000-4000-8000-000000000001","session_id":"ad151500-0000-4000-8000-000000000021","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
select ok(public.is_admin(),'Super Admin has platform capability');
select ok(public.is_super_admin(),'existing stored admin remains Super Admin');
select is(private.live_staff_role(),'admin','existing SQL administrative capabilities remain compatible');
select lives_ok($$select *from public.get_managers()$$,'Super Admin can read manager directory');
select lives_ok($$select public.manage_administrators('list')$$,'Super Admin can list administrative identities');
select throws_ok($$select public.manage_administrators('disable','{"userId":"ad151500-0000-4000-8000-000000000001"}')$$,'P0001','PROTECTED_ADMIN_ACCOUNT','Super Admin cannot suspend protected Super Admin identity');
select throws_ok($$select public.manage_administrators('add','{"email":"hierarchy-unverified@example.test"}')$$,'P0001','DIRECT_INVITATION_REQUIRED','unverified email cannot become Admin');
select throws_ok($$select public.manage_administrators('add','{"email":"missing-hierarchy@example.test"}')$$,'P0001','DIRECT_INVITATION_REQUIRED','unknown email cannot create an Auth identity');
select throws_ok($$select public.manage_administrators('add','{"email":"hierarchy-manager@example.test"}')$$,'P0001','DIRECT_INVITATION_REQUIRED','manager cannot be silently converted');
select throws_ok($$select public.manage_administrators('add','{"email":"hierarchy-admin@example.test"}')$$,'P0001','DIRECT_INVITATION_REQUIRED','duplicate Admin conversion rejected');
select throws_ok($$select public.manage_administrators('add','{"email":" HIERARCHY-CUSTOMER@EXAMPLE.TEST "}')$$,'P0001','DIRECT_INVITATION_REQUIRED','legacy promotion is replaced by direct invitations');
select is((select raw_app_meta_data->>'role'from auth.users where id='ad151500-0000-4000-8000-000000000004'),'customer','legacy promotion cannot alter an existing customer');
select ok((select not_after is null from auth.sessions where id='ad151500-0000-4000-8000-000000000024'),'rejected legacy promotion preserves the customer session');
select ok(not exists(select 1 from private.account_revoked_sessions where session_id='ad151500-0000-4000-8000-000000000024'),'rejected legacy promotion does not revoke the customer session');
select lives_ok($$select public.manage_administrators('disable','{"userId":"ad151500-0000-4000-8000-000000000006"}')$$,'Super Admin can suspend lower Admin');
select ok((select banned_until>now()from auth.users where id='ad151500-0000-4000-8000-000000000006'),'Admin suspension persists in Auth');
select lives_ok($$select public.manage_administrators('enable','{"userId":"ad151500-0000-4000-8000-000000000006"}')$$,'Super Admin can reactivate lower Admin');
select ok((select banned_until is null from auth.users where id='ad151500-0000-4000-8000-000000000006'),'reactivation clears ban');
select throws_ok($$select public.manage_administrators('promote-super-admin','{}')$$,'P0001','PROTECTED_ADMIN_ACCOUNT','API cannot mint extra Super Admins');
select set_config('request.jwt.claims','{"sub":"ad151500-0000-4000-8000-000000000002","session_id":"ad151500-0000-4000-8000-000000000022","role":"authenticated","aal":"aal2","app_metadata":{"role":"agent"}}',true);
select ok(public.is_admin(),'former Agent has platform Admin capability');
select ok(not public.is_super_admin(),'lower Admin cannot become Super Admin');
select is(private.live_staff_role(),'admin','existing administrative RPCs recognize lower Admin');
create temp table audit_baseline on commit drop as select count(*)as total from public.audit_logs;
grant select on audit_baseline to authenticated;
set local role authenticated;
select is((select count(*)from public.audit_logs),(select total from audit_baseline),'Admin RLS can read complete audit history');
select lives_ok($$insert into public.audit_logs(admin_user_id,action_type)values('ad151500-0000-4000-8000-000000000002','settings_changed')$$,'Admin can write attributed audit events');
select throws_ok($$insert into public.audit_logs(admin_user_id,action_type)values('ad151500-0000-4000-8000-000000000001','settings_changed')$$,'42501',null,'Admin cannot forge another actor in audit events');
reset role;
select lives_ok($$select *from public.get_managers()$$,'Admin can read manager directory');
select lives_ok($$select public.count_users_by_role('manager')$$,'Admin can read platform counts');
select lives_ok($$select public.manage_booking_policy(null)$$,'Admin can read global booking rules');
select lives_ok($$select public.manage_booking_policy(null,'{"cancel_minutes":120,"reschedule_minutes":120}')$$,'Admin can update global booking rules');
select lives_ok($$select public.shop_reviews(1)$$,'Admin can read private shop reviews');
select ok(case when pg_catalog.to_regclass('private.customer_booking_reviews') is null then public.shop_reviews(1)='{"total":0,"rows":[]}'::jsonb else true end,'unreleased review catalog stays optional');
select lives_ok($$select public.account_activity(null)$$,'Admin can read platform activity');
select lives_ok($$select public.set_manager_account_enabled('ad151500-0000-4000-8000-000000000003',false)$$,'Admin can suspend ordinary manager');
select lives_ok($$select public.set_manager_account_enabled('ad151500-0000-4000-8000-000000000003',true)$$,'Admin can restore ordinary manager');
select throws_ok($$select public.manage_administrators('list')$$,'42501','SUPER_ADMIN_REQUIRED','Admin cannot list protected management API');
select throws_ok($$select public.manage_administrators('add','{"email":"hierarchy-unverified@example.test","actor":"ad151500-0000-4000-8000-000000000001"}')$$,'42501','SUPER_ADMIN_REQUIRED','forged Super Admin actor ignored');
select throws_ok($$select public.manage_administrators('disable','{"userId":"ad151500-0000-4000-8000-000000000001"}')$$,'42501','SUPER_ADMIN_REQUIRED','Admin cannot suspend Super Admin');
select throws_ok($$select public.manage_administrators('enable','{"userId":"ad151500-0000-4000-8000-000000000006"}')$$,'42501','SUPER_ADMIN_REQUIRED','Admin cannot manage another Admin');
select ok(not exists(select 1 from jsonb_array_elements(public.admin_account_email('list','{"page":1}')->'users')x where x->>'role'in('admin','agent')),'lower Admin email-management list omits administrative identities');
select throws_ok($$select public.admin_account_email('change','{"userId":"ad151500-0000-4000-8000-000000000001","expectedEmail":"hierarchy-super@example.test","newEmail":"attacker@example.test","reason":"Attempted account takeover"}')$$,'42501','FORBIDDEN','Admin cannot take over Super Admin email');
select throws_ok($$select public.admin_account_email('change','{"userId":"ad151500-0000-4000-8000-000000000006","expectedEmail":"hierarchy-target@example.test","newEmail":"attacker@example.test","reason":"Attempted account takeover"}')$$,'42501','FORBIDDEN','Admin cannot take over another Admin email');
select lives_ok($$select private.require_announcement_admin('ad151500-0000-4000-8000-000000000002','ad151500-0000-4000-8000-000000000022')$$,'Admin has normal communications capability with MFA');
select ok(private.announcement_author_allowed('ad151500-0000-4000-8000-000000000002'),'campaign dispatcher accepts current Admin author');
select throws_ok($$select public.begin_admin_password_reset('ad151500-0000-4000-8000-000000000002','ad151500-0000-4000-8000-000000000006')$$,'P0001','Account role is not eligible for reset','Admin cannot reset another Admin password via service guard');
select throws_ok($$select public.begin_admin_password_reset('ad151500-0000-4000-8000-000000000002','ad151500-0000-4000-8000-000000000001')$$,'P0001','Account role is not eligible for reset','Admin cannot reset Super Admin password');
select set_config('request.jwt.claims','{"sub":"ad151500-0000-4000-8000-000000000002","session_id":"ad151500-0000-4000-8000-000000000022","role":"authenticated","aal":"aal1","app_metadata":{"role":"agent"}}',true);
select ok(not public.is_admin(),'stale aal1 token denied after session upgrade');
select throws_ok($$select public.manage_administrators('list')$$,'42501','ADMIN_MFA_REQUIRED','MFA required at backend entry');
select set_config('request.jwt.claims','{"sub":"ad151500-0000-4000-8000-000000000007","session_id":"ad151500-0000-4000-8000-000000000027","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
select ok(not public.is_admin(),'forged token assurance without matching factor/session denied');
insert into auth.sessions(id,user_id,aal)values('ad151500-0000-4000-8000-000000000028','ad151500-0000-4000-8000-000000000003','aal1');
select set_config('request.jwt.claims','{"sub":"ad151500-0000-4000-8000-000000000003","session_id":"ad151500-0000-4000-8000-000000000028","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"},"user_metadata":{"role":"admin"}}',true);
select ok(not public.is_admin(),'manager with forged metadata remains manager');
select ok(not public.is_super_admin(),'user-editable metadata cannot create Super Admin');
select throws_ok($$select public.manage_administrators('list')$$,'42501','SUPER_ADMIN_REQUIRED','ordinary manager cannot access administrative management');
select set_config('request.jwt.claims','{"sub":"ad151500-0000-4000-8000-000000000001","session_id":"ad151500-0000-4000-8000-000000000021","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
update auth.users set raw_app_meta_data='{"role":"agent"}'where id='ad151500-0000-4000-8000-000000000001';
select ok(public.is_admin(),'current lower role retains platform capability');
select ok(not public.is_super_admin(),'old Super Admin JWT cannot preserve removed privilege');
select throws_ok($$select public.manage_administrators('add','{"email":"hierarchy-unverified@example.test"}')$$,'42501','SUPER_ADMIN_REQUIRED','stale role token cannot grant administrative roles');
update auth.sessions set not_after=now()-interval'1 second'where id='ad151500-0000-4000-8000-000000000021';
select ok(not public.is_admin(),'expired administrative session denied');
select *from finish();
rollback;
