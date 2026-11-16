begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
-- This suite runs before real FCM configuration. All identities, fake token
-- hashes, Vault data, activation and counters below roll back; no provider call.
select ok(not exists(select 1 from private.customer_android_push_runtime)and not exists(select 1 from vault.secrets where name='customer_android_fcm'),'fresh isolated transport required before fixture setup');
insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)values
('ad650000-0000-4000-8000-000000000001','android-fcm-a@example.test','synthetic',now(),'{"role":"customer"}','{}'),
('ad650000-0000-4000-8000-000000000002','android-fcm-b@example.test','synthetic',now(),'{"role":"customer"}','{}');
insert into public.customers(id,name,email)values
('ad650000-0000-4000-8000-000000000031','Synthetic FCM A','android-fcm-a@example.test'),
('ad650000-0000-4000-8000-000000000032','Synthetic FCM B','android-fcm-b@example.test');
insert into private.customer_accounts(user_id,customer_id)values
('ad650000-0000-4000-8000-000000000001','ad650000-0000-4000-8000-000000000031'),
('ad650000-0000-4000-8000-000000000002','ad650000-0000-4000-8000-000000000032');
insert into auth.sessions(id,user_id,created_at,updated_at)values
('ad650000-0000-4000-8000-000000000021','ad650000-0000-4000-8000-000000000001',now(),now()),
('ad650000-0000-4000-8000-000000000022','ad650000-0000-4000-8000-000000000002',now(),now());
select set_config('fcm.a',jsonb_build_object('deviceId','ad650000-0000-4000-8000-000000000011','deviceSecret',repeat('a',64),'version',1,'user_id','ad650000-0000-4000-8000-000000000001','session_id','ad650000-0000-4000-8000-000000000021','projectId','barber-plus-plus-phone-test','packageName','com.barberplusplus.customer.test','token',repeat('synthetic-fcm-a:',10),'language','en','permission',true)::text,true);
select set_config('fcm.b',jsonb_build_object('deviceId','ad650000-0000-4000-8000-000000000012','deviceSecret',repeat('b',64),'version',1,'user_id','ad650000-0000-4000-8000-000000000002','session_id','ad650000-0000-4000-8000-000000000022','projectId','barber-plus-plus-phone-test','packageName','com.barberplusplus.customer.test','token',repeat('synthetic-fcm-b:',10),'language','ar','permission',true)::text,true);
select set_config('fcm.allowed',jsonb_build_array(
 jsonb_build_object('deviceId','ad650000-0000-4000-8000-000000000011','accountId','ad650000-0000-4000-8000-000000000001','tokenHashes',jsonb_build_array(encode(digest(repeat('synthetic-fcm-a:',10),'sha256'),'hex'))),
 jsonb_build_object('deviceId','ad650000-0000-4000-8000-000000000012','accountId','ad650000-0000-4000-8000-000000000002','tokenHashes',jsonb_build_array(encode(digest(repeat('synthetic-fcm-b:',10),'sha256'),'hex'))))::text,true);
select ok(not has_function_privilege('anon','public.customer_android_push_api(text,jsonb)','EXECUTE'),'anonymous cannot register Android transport');
select ok(not has_function_privilege('authenticated','public.customer_android_push_api(text,jsonb)','EXECUTE'),'app users must use validated gateway');
select ok(not has_function_privilege('anon','public.customer_android_push_dispatch(text,jsonb)','EXECUTE'),'anonymous cannot read provider configuration');
select ok(not has_function_privilege('authenticated','public.customer_android_push_dispatch(text,jsonb)','EXECUTE'),'user JWT cannot read key or activate/send');
select ok(not has_table_privilege('service_role','private.customer_android_push_devices','SELECT'),'tokens require bounded service API');
select ok(not has_table_privilege('service_role','private.customer_android_push_runtime','UPDATE'),'service callers cannot reset counters directly');
select is(public.customer_android_push_dispatch('configure',jsonb_build_object('allowed',current_setting('fcm.allowed')::jsonb))->>'mode','capture','initial configuration captures only');
select ok((public.customer_android_push_dispatch('configuration')->'credential')='null'::jsonb,'capture setup requires no server key');
select lives_ok($$select public.customer_android_push_api('push-register',current_setting('fcm.a')::jsonb)$$,'first allowlisted live owner registers');
select lives_ok($$select public.customer_android_push_api('push-register',current_setting('fcm.b')::jsonb)$$,'second allowlisted live owner registers');
select is((public.customer_android_push_dispatch('status')->>'registrations')::int,2,'exact two registrations accounted');
select ok(public.customer_android_push_api('push-status',current_setting('fcm.a')::jsonb)::text not like'%synthetic-fcm-a%'and public.customer_android_push_api('push-status',current_setting('fcm.a')::jsonb)::text not like'%deviceSecret%','generic responses contain no token or capability');
select throws_ok($$select public.customer_android_push_api('push-register',current_setting('fcm.a')::jsonb||'{"projectId":"live"}')$$,'P0001','INVALID_REQUEST','wrong Firebase project is rejected');
select throws_ok($$select public.customer_android_push_api('push-status',current_setting('fcm.a')::jsonb||jsonb_build_object('deviceSecret',repeat('c',64)))$$,'P0001','FORBIDDEN','device capability cannot be replaced');
select throws_ok($$select public.customer_android_push_dispatch('configure',jsonb_build_object('allowed',jsonb_build_array(current_setting('fcm.allowed')::jsonb->0)))$$,'P0001','TEST_RUNTIME_LOCKED','registered runtime allowlist cannot be rewritten');
select is(public.customer_android_push_dispatch('configure',jsonb_build_object('allowed',current_setting('fcm.allowed')::jsonb))->>'mode','capture','idempotent configure reports actual capture mode');

select public.customer_android_push_api('push-preferences',current_setting('fcm.a')::jsonb||'{"preferences":{"updates":false,"reminder24":true,"reminder2":true,"reviews":true}}');
select public.customer_android_push_api('push-preferences',current_setting('fcm.a')::jsonb||'{"preferences":{"updates":true,"reminder24":true,"reminder2":true,"reviews":true}}');
select throws_ok($$select public.customer_android_push_api('push-preferences',current_setting('fcm.b')::jsonb||'{"preferences":{"updates":true,"reminder24":true,"reminder2":true,"reviews":true}}')$$,'P0001','TEST_BUDGET_EXHAUSTED','third preference write cannot widen approved budget');
select set_config('fcm.capture',public.customer_android_push_dispatch('enqueue-test','{"deviceId":"ad650000-0000-4000-8000-000000000011","taskKey":"ad650000-0000-4000-8000-000000000041"}')->>'id',true);
select set_config('fcm.capturelease',(public.customer_android_push_dispatch('claim')->0)::text,true);
select is(current_setting('fcm.capturelease')::jsonb->>'mode','capture','default queue claims no real delivery');
select public.customer_android_push_dispatch('finish',(current_setting('fcm.capturelease')::jsonb-'token')||'{"outcome":"captured"}');
select is((public.customer_android_push_dispatch('status')->>'reservedAttempts')::int,0,'captured job consumes zero actual-attempt reservations');
select is((select state from private.customer_android_push_deliveries where id=current_setting('fcm.capture')::uuid),'captured','capture acknowledgment is terminal');

-- Deliberately unusable synthetic private-key text, stored only inside this
-- rolled-back transaction to exercise credential ACL/configuration state.
select public.customer_android_push_dispatch('credential',jsonb_build_object('credential',jsonb_build_object('type','service_account','project_id','barber-plus-plus-phone-test','client_email','barber-android-test-sender@barber-plus-plus-phone-test.iam.gserviceaccount.com','private_key_id',repeat('a',40),'private_key','-----BEGIN PRIVATE KEY-----synthetic-never-sent','token_uri','https://oauth2.googleapis.com/token')));
select throws_ok($$select public.customer_android_push_dispatch('activate-real',jsonb_build_object('jobIds',jsonb_build_array(current_setting('fcm.capture')),'expiresAt',now()+interval'10 minutes'))$$,'P0001','INVALID_REQUEST','captured jobs cannot be replayed as real pushes');
select set_config('fcm.jobs',jsonb_build_array(
 public.customer_android_push_dispatch('enqueue-test','{"deviceId":"ad650000-0000-4000-8000-000000000011","taskKey":"ad650000-0000-4000-8000-000000000042"}')->>'id',
 public.customer_android_push_dispatch('enqueue-test','{"deviceId":"ad650000-0000-4000-8000-000000000011","taskKey":"ad650000-0000-4000-8000-000000000043"}')->>'id',
 public.customer_android_push_dispatch('enqueue-test','{"deviceId":"ad650000-0000-4000-8000-000000000012","taskKey":"ad650000-0000-4000-8000-000000000044"}')->>'id')::text,true);
select throws_ok($$select public.customer_android_push_dispatch('activate-real',jsonb_build_object('jobIds',current_setting('fcm.jobs')::jsonb,'expiresAt',now()+interval'31 minutes'))$$,'P0001','INVALID_REQUEST','real window cannot exceed thirty minutes');
select lives_ok($$select public.customer_android_push_dispatch('activate-real',jsonb_build_object('jobIds',current_setting('fcm.jobs')::jsonb,'expiresAt',now()+interval'10 minutes'))$$,'exact reviewed pending jobs can be activated once');
select throws_ok($$select public.customer_android_push_dispatch('configure',jsonb_build_object('allowed',current_setting('fcm.allowed')::jsonb))$$,'P0001','TEST_RUNTIME_LOCKED','configure cannot misreport or reset an activated runtime');
select set_config('fcm.claims',public.customer_android_push_dispatch('claim')::text,true);
select is(jsonb_array_length(current_setting('fcm.claims')::jsonb),3,'claim reserves maximum three real attempts atomically');
select is((public.customer_android_push_dispatch('status')->>'reservedAttempts')::int,3,'reservation accounting persists before provider network');
select is(jsonb_array_length(public.customer_android_push_dispatch('claim')),0,'sending jobs are never automatically reclaimed');
select set_config('fcm.rotate',jsonb_build_object('deviceId','ad650000-0000-4000-8000-000000000011','accountId','ad650000-0000-4000-8000-000000000001','expectedVersion',1,'expectedTokenHash',encode(digest(repeat('synthetic-fcm-a:',10),'sha256'),'hex'),'newTokenHash',encode(digest(repeat('synthetic-fcm-a-rotated:',10),'sha256'),'hex'))::text,true);
select throws_ok($$select public.customer_android_push_dispatch('append-rotation-hash',current_setting('fcm.rotate')::jsonb||'{"accountId":"ad650000-0000-4000-8000-000000000002"}')$$,'P0001','INVALID_REQUEST','rotation append cannot substitute owner');
select throws_ok($$select public.customer_android_push_dispatch('append-rotation-hash',current_setting('fcm.rotate')::jsonb||'{"expectedVersion":2}')$$,'P0001','INVALID_REQUEST','rotation append requires exact registration version');
select throws_ok($$select public.customer_android_push_dispatch('append-rotation-hash',current_setting('fcm.rotate')::jsonb||jsonb_build_object('expectedTokenHash',repeat('f',64)))$$,'P0001','INVALID_REQUEST','rotation append requires exact old token hash');
select lives_ok($$select public.customer_android_push_dispatch('append-rotation-hash',current_setting('fcm.rotate')::jsonb)$$,'one new hash may be appended to the same device and owner');
select throws_ok($$select public.customer_android_push_dispatch('append-rotation-hash',current_setting('fcm.rotate')::jsonb)$$,'P0001','TEST_BUDGET_EXHAUSTED','rotation append cannot be replayed');
select lives_ok($$select public.customer_android_push_api('push-register',current_setting('fcm.a')::jsonb||jsonb_build_object('version',2,'token',repeat('synthetic-fcm-a-rotated:',10)))$$,'one actual token rotation is accepted');
select is((public.customer_android_push_dispatch('status')->>'rotations')::int,1,'rotation budget is monotonic');
select public.customer_android_push_api('push-register',current_setting('fcm.a')::jsonb);
select ok((select token=repeat('synthetic-fcm-a-rotated:',10)and registration_version=2 from private.customer_android_push_devices where id='ad650000-0000-4000-8000-000000000011'),'stale registration cannot restore old token');
select throws_ok($$select public.customer_android_push_api('push-register',current_setting('fcm.a')::jsonb||'{"version":3}')$$,'P0001','TEST_BUDGET_EXHAUSTED','a second token rotation is blocked');
select ok(not(public.customer_android_push_dispatch('validate',(select value from jsonb_array_elements(current_setting('fcm.claims')::jsonb)where value->>'token'=repeat('synthetic-fcm-a:',10)limit 1))::boolean),'rotated in-flight binding is invalidated before send');
select public.customer_android_push_dispatch('finish',(select value||'{"outcome":"invalid-token"}'from jsonb_array_elements(current_setting('fcm.claims')::jsonb)where value->>'token'=repeat('synthetic-fcm-a:',10)limit 1));
select ok((select permission and token=repeat('synthetic-fcm-a-rotated:',10)from private.customer_android_push_devices where id='ad650000-0000-4000-8000-000000000011'),'late invalid-token result never disables new binding');
select public.customer_android_push_dispatch('finish',value||'{"outcome":"uncertain"}')from jsonb_array_elements(current_setting('fcm.claims')::jsonb)where value->>'token'=repeat('synthetic-fcm-a:',10);
select public.customer_android_push_dispatch('finish',value||'{"outcome":"invalid-token"}')from jsonb_array_elements(current_setting('fcm.claims')::jsonb)where value->>'token'=repeat('synthetic-fcm-b:',10);
select ok((select token is null and not permission from private.customer_android_push_devices where id='ad650000-0000-4000-8000-000000000012'),'unregistered result disables only its exact current binding');
select is((public.customer_android_push_dispatch('status')->>'reservedAttempts')::int,3,'uncertainty never refunds attempt accounting');
select throws_ok($$select public.customer_android_push_dispatch('activate-real',jsonb_build_object('jobIds',current_setting('fcm.jobs')::jsonb,'expiresAt',now()+interval'10 minutes'))$$,'P0001','TEST_BUDGET_EXHAUSTED','real activation cannot reset attempt budget');
select public.customer_android_push_dispatch('capture');
select is((public.customer_android_push_dispatch('status')->>'reservedAttempts')::int,3,'restoring capture preserves used budget');
select public.customer_android_push_api('push-detach',current_setting('fcm.a')::jsonb||'{"version":3}');
select public.customer_android_push_api('push-detach',current_setting('fcm.b')::jsonb||'{"version":2}');
select throws_ok($$select public.customer_android_push_api('push-detach',current_setting('fcm.b')::jsonb||'{"version":3}')$$,'P0001','TEST_BUDGET_EXHAUSTED','third detach cannot exceed approved cap');
delete from auth.sessions where id='ad650000-0000-4000-8000-000000000021';
select ok(not exists(select 1 from private.customer_android_push_devices where id='ad650000-0000-4000-8000-000000000011'),'session deletion removes Android registration and dependent deliveries');
insert into auth.sessions(id,user_id,created_at,updated_at)values('ad650000-0000-4000-8000-000000000023','ad650000-0000-4000-8000-000000000001',now(),now());
select throws_ok($$select public.customer_android_push_api('push-register',current_setting('fcm.a')::jsonb||'{"session_id":"ad650000-0000-4000-8000-000000000023","version":4}')$$,'P0001','TEST_BUDGET_EXHAUSTED','session reset never silently grants a third registration');
select is((public.customer_android_push_dispatch('status')->>'registrations')::int,2,'registration accounting survives cascade');
select *from finish();
rollback;
