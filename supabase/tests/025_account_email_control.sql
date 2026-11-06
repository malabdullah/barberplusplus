begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,encrypted_password,email_confirmed_at,confirmation_token,raw_app_meta_data,raw_user_meta_data) values
('ae250000-0000-4000-8000-000000000001','email-pending@customer.test',extensions.crypt('Synthetic12!',extensions.gen_salt('bf')),null,'old-code','{"role":"customer"}','{}'),
('ae250000-0000-4000-8000-000000000002','email-confirmed@customer.test',extensions.crypt('Synthetic12!',extensions.gen_salt('bf')),now(),'','{"role":"customer"}','{}'),
('ae250000-0000-4000-8000-000000000003','email-admin@staff.test',extensions.crypt('Synthetic12!',extensions.gen_salt('bf')),now(),'','{"role":"admin"}','{}');
insert into auth.identities(user_id,provider_id,provider,identity_data) values
('ae250000-0000-4000-8000-000000000001','ae250000-0000-4000-8000-000000000001','email','{"sub":"ae250000-0000-4000-8000-000000000001","email":"email-pending@customer.test"}'),
('ae250000-0000-4000-8000-000000000002','ae250000-0000-4000-8000-000000000002','email','{"sub":"ae250000-0000-4000-8000-000000000002","email":"email-confirmed@customer.test"}');
select ok(not has_function_privilege('anon','public.correct_registration_email(text,text,text,text)','execute'),'anonymous cannot call privileged correction RPC');
select ok(not has_function_privilege('authenticated','public.correct_registration_email(text,text,text,text)','execute'),'signed-in users cannot call privileged correction RPC');
select ok(not has_function_privilege('service_role','private.write_account_email(uuid,text,uuid,text,text)','execute'),'service role cannot call unrestricted email writer');
select ok(not has_function_privilege('anon','public.admin_account_email(text,jsonb)','execute'),'admin API is not anonymous');
select ok(not has_table_privilege('authenticated','private.account_email_changes','select'),'email audit is private');
select throws_ok($$update auth.users set email_change='bypass@example.test' where id='ae250000-0000-4000-8000-000000000002'$$,'42501','EMAIL_ADMIN_ONLY','direct email-change request blocked');
select throws_ok($$update auth.users set email='bypass@example.test' where id='ae250000-0000-4000-8000-000000000002'$$,'42501','EMAIL_ADMIN_ONLY','direct primary email write blocked');
select throws_ok($$update auth.users set email='bypass@example.test',raw_user_meta_data='{"role":"admin"}' where id='ae250000-0000-4000-8000-000000000002'$$,'42501','EMAIL_ADMIN_ONLY','editable metadata cannot authorize email changes');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.correct_registration_email('email-pending@customer.test','email-fixed@customer.test','WrongPassword12!','customer')$$,'P0001','REGISTRATION_CANNOT_CORRECT','wrong password denied');
select throws_ok($$select public.correct_registration_email('email-pending@customer.test','email-fixed@customer.test','Synthetic12!','team')$$,'P0001','REGISTRATION_CANNOT_CORRECT','wrong audience denied');
select throws_ok($$select public.correct_registration_email('email-confirmed@customer.test','email-fixed@customer.test','Synthetic12!','customer')$$,'P0001','REGISTRATION_CANNOT_CORRECT','verified customer cannot use correction exception');
select throws_ok($$select public.correct_registration_email('email-pending@customer.test','email-confirmed@customer.test','Synthetic12!','customer')$$,'P0001','EMAIL_IN_USE','existing account address protected');
select is(public.correct_registration_email('email-pending@customer.test','email-fixed@customer.test','Synthetic12!','customer')->>'id','ae250000-0000-4000-8000-000000000001','correction keeps the same account');
select is((select email from auth.users where id='ae250000-0000-4000-8000-000000000001'),'email-fixed@customer.test'::varchar,'corrected primary address stored');
select is((select identity_data->>'email' from auth.identities where user_id='ae250000-0000-4000-8000-000000000001'),'email-fixed@customer.test','email provider identity updated');
select is((select confirmation_token from auth.users where id='ae250000-0000-4000-8000-000000000001'),''::varchar,'old confirmation invalidated');
select ok((select email_confirmed_at is null from auth.users where id='ae250000-0000-4000-8000-000000000001'),'correction never confirms ownership');
select is(public.correct_registration_email('email-pending@customer.test','email-fixed@customer.test','Synthetic12!','customer')->>'email','email-fixed@customer.test','lost-response retry remains safe');
update auth.users set email_confirmed_at=now() where id='ae250000-0000-4000-8000-000000000001';
select throws_ok($$select public.correct_registration_email('email-fixed@customer.test','email-again@customer.test','Synthetic12!','customer')$$,'P0001','REGISTRATION_CANNOT_CORRECT','verification closes correction even with an old registration page');
insert into auth.mfa_factors(id,user_id,status,factor_type,secret,created_at,updated_at) values
('ae250000-0000-4000-8000-000000000031','ae250000-0000-4000-8000-000000000003','verified','totp','qa-only',now(),now());
insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at) values
('ae250000-0000-4000-8000-000000000032','ae250000-0000-4000-8000-000000000003','aal2','ae250000-0000-4000-8000-000000000031',now(),now()),
('ae250000-0000-4000-8000-000000000021','ae250000-0000-4000-8000-000000000002','aal1',null,now(),now());
select set_config('request.jwt.claims','{"role":"authenticated","sub":"ae250000-0000-4000-8000-000000000003","session_id":"ae250000-0000-4000-8000-000000000032","aal":"aal2"}',true);
select is(jsonb_typeof(public.admin_account_email('list','{"page":1}')->'users'),'array','MFA admin can list accounts');
select throws_ok($$select public.admin_account_email('change','{"userId":"ae250000-0000-4000-8000-000000000002","expectedEmail":"stale@example.test","newEmail":"email-admin-fixed@customer.test","reason":"User confirmed correct address"}')$$,'P0001','EMAIL_CHANGED_REFRESH','stale admin changes blocked');
select is(public.admin_account_email('change','{"userId":"ae250000-0000-4000-8000-000000000002","expectedEmail":"email-confirmed@customer.test","newEmail":"email-admin-fixed@customer.test","reason":"User confirmed correct address"}')->>'success','true','admin can change a verified address');
select ok(not exists(select 1 from auth.sessions where user_id='ae250000-0000-4000-8000-000000000002'),'target sessions ended');
select is((select count(*) from private.account_email_changes where user_id='ae250000-0000-4000-8000-000000000002' and actor_id='ae250000-0000-4000-8000-000000000003' and kind='admin_change'),1::bigint,'actor and reason recorded');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"ae250000-0000-4000-8000-000000000003","session_id":"ae250000-0000-4000-8000-000000000032","aal":"aal1"}',true);
select throws_ok($$select public.admin_account_email('list','{"page":1}')$$,'42501','ADMIN_MFA_REQUIRED','admin cannot bypass MFA with an AAL1 token');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"ae250000-0000-4000-8000-000000000003","session_id":"ae250000-0000-4000-8000-000000000032","aal":"aal2"}',true);
select is(public.admin_account_email('change','{"userId":"ae250000-0000-4000-8000-000000000003","expectedEmail":"email-admin@staff.test","newEmail":"email-admin-fixed@staff.test","reason":"Admin confirmed their own new address"}')->>'signedOut','true','admin can change own email through the guarded admin journey');
select ok(not exists(select 1 from auth.sessions where user_id='ae250000-0000-4000-8000-000000000003'),'admin self-change ends their session too');
select * from finish();
rollback;
