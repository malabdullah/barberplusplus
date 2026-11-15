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

select ok(not has_table_privilege('authenticated','private.admin_invitations','SELECT'),'invitation tokens stay private');
select ok(not has_table_privilege('service_role','private.admin_invitations','SELECT'),'service uses narrow invitation routines');
select ok(not has_function_privilege('authenticated','public.admin_invitation_service(text,jsonb)','EXECUTE'),'browser cannot finish invitations');
select ok(not has_function_privilege('anon','public.admin_invitation_service(text,jsonb)','EXECUTE'),'anonymous cannot use invitation service');
select set_config('request.jwt.claims','{"sub":"ad151500-0000-4000-8000-000000000001","session_id":"ad151500-0000-4000-8000-000000000021","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
select throws_ok($$select public.manage_administrators('invite','{"name":"QA","email":"hierarchy-customer@example.test","tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')$$,'P0001','EMAIL_IN_USE','existing customers cannot be silently converted');
select throws_ok($$select public.manage_administrators('invite','{"name":"QA","email":"invalid","tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')$$,'P0001','INVALID_DETAILS','invalid addresses are rejected');
select set_config('direct.invite',public.manage_administrators('invite','{"name":"Direct Admin","email":"DIRECT-ADMIN@example.test","tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')::text,true);
select is((select email from private.admin_invitations where id=(current_setting('direct.invite')::jsonb->>'id')::uuid),'direct-admin@example.test','email is normalized');
select ok(not exists(select 1 from auth.users where email='direct-admin@example.test'),'inviting creates no Auth or customer account');
select ok(exists(select 1 from jsonb_array_elements(public.manage_administrators('list')->'users')x where x->>'kind'='invitation'and x->>'email'='direct-admin@example.test'),'pending invitation is visible beside Admin accounts');
select throws_ok($$select public.manage_administrators('invite','{"name":"Duplicate","email":"direct-admin@example.test","tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')$$,'P0001','INVITE_EXISTS','duplicate invitations are rejected');
select throws_ok($$select public.manage_administrators('resend',jsonb_build_object('id',current_setting('direct.invite')::jsonb->>'id','tokenHash',repeat('b',64)))$$,'P0001','RATE_LIMITED','immediate repeated email is limited');
select throws_ok($$select public.admin_invitation_service('resolve',jsonb_build_object('id',current_setting('direct.invite')::jsonb->>'id','tokenHash',repeat('c',64)))$$,'P0001','INVITE_INVALID','wrong token cannot resolve the recipient');
select is(public.admin_invitation_service('resolve',jsonb_build_object('id',current_setting('direct.invite')::jsonb->>'id','tokenHash',repeat('a',64)))->>'email','direct-admin@example.test','valid link resolves only its bound email');
select set_config('direct.claim',public.admin_invitation_service('prepare',jsonb_build_object('id',current_setting('direct.invite')::jsonb->>'id','tokenHash',repeat('a',64)))::text,true);
select throws_ok($$select public.admin_invitation_service('prepare',jsonb_build_object('id',current_setting('direct.invite')::jsonb->>'id','tokenHash',repeat('a',64)))$$,'P0001','INVITE_PROCESSING','concurrent acceptance is serialized');
select throws_ok($$select public.manage_administrators('cancel',jsonb_build_object('id',current_setting('direct.invite')::jsonb->>'id'))$$,'P0001','INVITE_PROCESSING','cancel cannot race an active acceptance');
insert into auth.users(id,email,raw_app_meta_data)values('ad151500-0000-4000-8000-000000000008','direct-admin@example.test',jsonb_build_object('role','admin_invited','admin_invitation_id',current_setting('direct.invite')::jsonb->>'id'));
select throws_ok($$select public.admin_invitation_service('finish',jsonb_build_object('id',current_setting('direct.invite')::jsonb->>'id','tokenHash',repeat('a',64),'operation',current_setting('direct.claim')::jsonb->>'operation','userId','ad151500-0000-4000-8000-000000000004'))$$,'P0001','INVITE_INVALID','a different account cannot be granted Admin');
update auth.users set encrypted_password=extensions.crypt('OtherPassword123!',extensions.gen_salt('bf'))where id='ad151500-0000-4000-8000-000000000008';
select throws_ok($$select public.admin_invitation_service('finish',jsonb_build_object('id',current_setting('direct.invite')::jsonb->>'id','tokenHash',repeat('a',64),'operation',current_setting('direct.claim')::jsonb->>'operation','password','weak','userId','ad151500-0000-4000-8000-000000000008'))$$,'P0001','WEAK_PASSWORD','database validates the final administrative credential');
select lives_ok($$select public.admin_invitation_service('finish',jsonb_build_object('id',current_setting('direct.invite')::jsonb->>'id','tokenHash',repeat('a',64),'operation',current_setting('direct.claim')::jsonb->>'operation','password','LongTest1234!','userId','ad151500-0000-4000-8000-000000000008'))$$,'the bound pending identity accepts once');
select ok((select encrypted_password=extensions.crypt('LongTest1234!',encrypted_password)from auth.users where id='ad151500-0000-4000-8000-000000000008'),'atomic acceptance installs the recipient password');
select ok((select encrypted_password<>extensions.crypt('OtherPassword123!',encrypted_password)from auth.users where id='ad151500-0000-4000-8000-000000000008'),'a competing unconfirmed signup password cannot survive acceptance');
select is((select raw_app_meta_data->>'role'from auth.users where id='ad151500-0000-4000-8000-000000000008'),'agent','acceptance grants Admin, never Super Admin');
select ok((select email_confirmed_at is not null from auth.users where id='ad151500-0000-4000-8000-000000000008'),'link possession confirms its exact email');
select ok(not exists(select 1 from private.customer_accounts where user_id='ad151500-0000-4000-8000-000000000008'),'new Admin has no unnecessary customer profile');
select throws_ok($$select public.admin_invitation_service('resolve',jsonb_build_object('id',current_setting('direct.invite')::jsonb->>'id','tokenHash',repeat('a',64)))$$,'P0001','INVITE_USED','accepted link cannot be reused');
insert into auth.sessions(id,user_id,aal)values('ad151500-0000-4000-8000-000000000038','ad151500-0000-4000-8000-000000000008','aal1');
select set_config('request.jwt.claims','{"sub":"ad151500-0000-4000-8000-000000000008","session_id":"ad151500-0000-4000-8000-000000000038","role":"authenticated","aal":"aal1","app_metadata":{"role":"agent"}}',true);
select ok(not public.is_admin(),'newly invited Admin must enroll MFA before access');
select set_config('request.jwt.claims','{"sub":"ad151500-0000-4000-8000-000000000001","session_id":"ad151500-0000-4000-8000-000000000021","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
select set_config('direct.second',public.manage_administrators('invite','{"name":"Second QA","email":"second-direct@example.test","tokenHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}')::text,true);
update private.admin_invitations set expires_at=now()-interval'1 second',last_sent_at=now()-interval'2 minutes'where id=(current_setting('direct.second')::jsonb->>'id')::uuid;
select throws_ok($$select public.admin_invitation_service('resolve',jsonb_build_object('id',current_setting('direct.second')::jsonb->>'id','tokenHash',repeat('b',64)))$$,'P0001','INVITE_EXPIRED','expired links are denied');
select lives_ok($$select public.manage_administrators('resend',jsonb_build_object('id',current_setting('direct.second')::jsonb->>'id','tokenHash',repeat('c',64)))$$,'Super Admin can renew an expired invitation');
select throws_ok($$select public.admin_invitation_service('resolve',jsonb_build_object('id',current_setting('direct.second')::jsonb->>'id','tokenHash',repeat('b',64)))$$,'P0001','INVITE_INVALID','resend invalidates the old link');
select lives_ok($$select public.admin_invitation_service('resolve',jsonb_build_object('id',current_setting('direct.second')::jsonb->>'id','tokenHash',repeat('c',64)))$$,'new link is valid');
select lives_ok($$select public.manage_administrators('cancel',jsonb_build_object('id',current_setting('direct.second')::jsonb->>'id'))$$,'pending invitation can be cancelled');
select throws_ok($$select public.admin_invitation_service('resolve',jsonb_build_object('id',current_setting('direct.second')::jsonb->>'id','tokenHash',repeat('c',64)))$$,'P0001','INVITE_CANCELLED','cancelled link cannot create an Admin');
select lives_ok($$select public.manage_administrators('edit','{"userId":"ad151500-0000-4000-8000-000000000006","expectedEmail":"hierarchy-target@example.test","name":"Renamed Admin","email":"renamed-admin@example.test"}')$$,'Super Admin edits name and email from one action');
select is((select email::text from auth.users where id='ad151500-0000-4000-8000-000000000006'),'renamed-admin@example.test','audited email change is applied');
select is((select raw_user_meta_data->>'name'from auth.users where id='ad151500-0000-4000-8000-000000000006'),'Renamed Admin','name change is applied');
select throws_ok($$select public.manage_administrators('edit','{"userId":"ad151500-0000-4000-8000-000000000006","expectedEmail":"renamed-admin@example.test","name":"Renamed Admin","email":"hierarchy-customer@example.test"}')$$,'P0001','EMAIL_IN_USE','edit rejects an occupied email');
select throws_ok($$select public.manage_administrators('edit','{"userId":"ad151500-0000-4000-8000-000000000001","expectedEmail":"hierarchy-super@example.test","name":"Changed","email":"changed-super@example.test"}')$$,'P0001','PROTECTED_ADMIN_ACCOUNT','protected Super Admin cannot be edited');
select throws_ok($$select public.manage_administrators('delete-prepare','{"userId":"ad151500-0000-4000-8000-000000000001"}')$$,'P0001','PROTECTED_ADMIN_ACCOUNT','protected Super Admin cannot be deleted');
select set_config('request.jwt.claims','{"sub":"ad151500-0000-4000-8000-000000000002","session_id":"ad151500-0000-4000-8000-000000000022","role":"authenticated","aal":"aal2","app_metadata":{"role":"agent"}}',true);
select throws_ok($$select public.manage_administrators('invite','{"name":"Forged","email":"forged@example.test","tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')$$,'42501','SUPER_ADMIN_REQUIRED','Admin cannot invite another Admin');
select throws_ok($$select public.manage_administrators('edit','{"userId":"ad151500-0000-4000-8000-000000000006","name":"Forged","email":"forged@example.test"}')$$,'42501','SUPER_ADMIN_REQUIRED','Admin cannot edit another Admin');
select throws_ok($$select public.manage_administrators('delete-prepare','{"userId":"ad151500-0000-4000-8000-000000000006"}')$$,'42501','SUPER_ADMIN_REQUIRED','Admin cannot delete another Admin');
select set_config('request.jwt.claims','{"sub":"ad151500-0000-4000-8000-000000000001","session_id":"ad151500-0000-4000-8000-000000000021","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
insert into auth.sessions(id,user_id)values('ad151500-0000-4000-8000-000000000035','ad151500-0000-4000-8000-000000000006');
select set_config('direct.reset',public.begin_admin_password_reset('ad151500-0000-4000-8000-000000000001','ad151500-0000-4000-8000-000000000006')::text,true);
select lives_ok($$select public.finish_admin_password_reset(current_setting('direct.reset')::uuid,'ad151500-0000-4000-8000-000000000001','ad151500-0000-4000-8000-000000000006')$$,'Super Admin completes a guarded Admin password reset');
select ok(not exists(select 1 from auth.sessions where id='ad151500-0000-4000-8000-000000000035'),'Admin password reset ends existing sessions');
select ok(exists(select 1 from private.account_revoked_sessions where session_id='ad151500-0000-4000-8000-000000000035'),'Admin password reset persistently detaches realtime');
select ok(exists(select 1 from auth.sessions where id='ad151500-0000-4000-8000-000000000021'),'targeted reset preserves the Super Admin session');
insert into auth.sessions(id,user_id)values('ad151500-0000-4000-8000-000000000036','ad151500-0000-4000-8000-000000000006');
select set_config('direct.delete',public.manage_administrators('delete-prepare','{"userId":"ad151500-0000-4000-8000-000000000006"}')::text,true);
select ok((select banned_until>now()from auth.users where id='ad151500-0000-4000-8000-000000000006'),'deletion blocks access before contacting Auth');
select ok((select not_after<=now()from auth.sessions where id='ad151500-0000-4000-8000-000000000036'),'deletion revokes existing sessions');
select throws_ok($$select public.manage_administrators('enable','{"userId":"ad151500-0000-4000-8000-000000000006"}')$$,'P0001','ADMIN_DELETION_PENDING','pending deletion cannot be re-enabled');
select throws_ok($$update auth.users set deleted_at=now(),email='scrubbed@example.test'where id='ad151500-0000-4000-8000-000000000004'$$,'42501','EMAIL_ADMIN_ONLY','deletion email exception cannot scrub another role');
update auth.users set deleted_at=now(),email='deleted-admin@example.test',raw_app_meta_data='{}'where id='ad151500-0000-4000-8000-000000000006';
select lives_ok($$select public.admin_invitation_service('delete-finish',current_setting('direct.delete')::jsonb)$$,'queued Auth deletion finishes safely');
select lives_ok($$select public.admin_invitation_service('delete-finish',current_setting('direct.delete')::jsonb)$$,'duplicate finish is idempotent');
select is((select count(*)from public.audit_logs where target_user_id='ad151500-0000-4000-8000-000000000006'and action_type='user_deleted'),1::bigint,'deletion preserves one completed audit event');
select ok(not exists(select 1 from jsonb_array_elements(public.manage_administrators('list')->'users')x where x->>'id'='ad151500-0000-4000-8000-000000000006'),'deleted Admin is removed from directory');
select *from finish();
rollback;
