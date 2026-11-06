begin;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
('af220000-0000-4000-8000-000000000001','password-proof@customer.test','existing-auth-hash',now(),'{"role":"customer"}','{}'),
('af220000-0000-4000-8000-000000000002','provider-proof@customer.test','',now(),'{"role":"manager"}','{}'),
('af220000-0000-4000-8000-000000000003','other-proof@customer.test','other-auth-hash',now(),'{"role":"barber"}','{}');
insert into auth.sessions(id,user_id,created_at,updated_at) values
('af220000-0000-4000-8000-000000000011','af220000-0000-4000-8000-000000000001',now(),now()),
('af220000-0000-4000-8000-000000000012','af220000-0000-4000-8000-000000000001',now(),now()),
('af220000-0000-4000-8000-000000000021','af220000-0000-4000-8000-000000000002',now(),now()),
('af220000-0000-4000-8000-000000000031','af220000-0000-4000-8000-000000000003',now(),now());
select set_config('password.identity','{"user_id":"af220000-0000-4000-8000-000000000001","session_id":"af220000-0000-4000-8000-000000000011"}',true);
select set_config('password.provider','{"user_id":"af220000-0000-4000-8000-000000000002","session_id":"af220000-0000-4000-8000-000000000021"}',true);
select ok(not has_function_privilege('anon','public.customer_password_api(text,jsonb)','EXECUTE'),'anonymous cannot issue credential proofs');
select ok(not has_function_privilege('authenticated','public.customer_password_api(text,jsonb)','EXECUTE'),'signed-in clients cannot mint credential proofs');
select ok(not has_table_privilege('authenticated','private.customer_password_proofs','SELECT'),'proofs remain private');
select ok(not has_table_privilege('service_role','private.customer_password_requests','SELECT'),'service callers must use the bounded API');
select is(public.customer_password_api('status',current_setting('password.identity')::jsonb)->>'hasPassword','true','password capability comes from trusted Auth state');
select is(public.customer_password_api('status',current_setting('password.provider')::jsonb)->>'hasPassword','false','provider-only manager has no current password');
select throws_ok($$select public.customer_account_api('email-reset-guard',current_setting('password.identity')::jsonb)$$,'P0001','PASSWORD_PROOF_REQUIRED','ordinary session cannot use legacy email reset');
select throws_ok($$select public.customer_password_api('prepare',current_setting('password.identity')::jsonb||'{"proof":"af220000-0000-4000-8000-000000000099"}')$$,'P0001','PASSWORD_PROOF_REQUIRED','fabricated proof is rejected');
select throws_ok($$select public.customer_password_api('current-begin',current_setting('password.identity')::jsonb||'{"reauth_session_id":"af220000-0000-4000-8000-000000000011"}')$$,'P0001','CURRENT_PASSWORD_REQUIRED','original session is not fresh password proof');
select throws_ok($$select public.customer_password_api('current-begin',current_setting('password.identity')::jsonb||'{"reauth_session_id":"af220000-0000-4000-8000-000000000031"}')$$,'P0001','CURRENT_PASSWORD_REQUIRED','another user cannot reauthenticate this account');
set constraints auth.enforce_customer_password_proof immediate;
select throws_ok($$update auth.users set encrypted_password='bypassed' where id='af220000-0000-4000-8000-000000000001'$$,'P0001','PASSWORD_PROOF_REQUIRED','direct Auth password write is rejected');
select throws_ok($$update auth.users set encrypted_password='bypassed',raw_user_meta_data='{"barber_password_operation":"af220000-0000-4000-8000-000000000099"}' where id='af220000-0000-4000-8000-000000000001'$$,'P0001','PASSWORD_PROOF_REQUIRED','editable metadata cannot authorize a password');
set constraints auth.enforce_customer_password_proof deferred;
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at) values
(gen_random_uuid(),'af220000-0000-4000-8000-000000000012','password',now(),now());
select set_config('password.operation',(public.customer_password_api('current-begin',current_setting('password.identity')::jsonb||'{"reauth_session_id":"af220000-0000-4000-8000-000000000012"}')->>'operation'),true);
select ok(not exists(select 1 from auth.sessions where id='af220000-0000-4000-8000-000000000012'),'ephemeral password session is consumed');
select is((select count(*) from private.customer_password_reset_guards where user_id='af220000-0000-4000-8000-000000000001'),1::bigint,'one password operation guard exists');
update auth.users set encrypted_password='new-auth-generated-hash' where id='af220000-0000-4000-8000-000000000001';
update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('barber_password_operation',current_setting('password.operation')) where id='af220000-0000-4000-8000-000000000001';
set constraints auth.enforce_customer_password_proof immediate;
select is(public.customer_password_api('operation-result',current_setting('password.identity')::jsonb||jsonb_build_object('operation',current_setting('password.operation')))->>'applied','true','proof commits with credential change');
select is((select count(*) from auth.sessions where user_id='af220000-0000-4000-8000-000000000001'),0::bigint,'all sessions of the changed identity are revoked');
select ok(not exists(select 1 from private.customer_password_reset_guards where user_id='af220000-0000-4000-8000-000000000001'),'committed proof guard is removed');
select ok(not (select raw_app_meta_data ? 'barber_password_operation' from auth.users where id='af220000-0000-4000-8000-000000000001'),'operation marker is stripped before commit');
select is((select raw_app_meta_data->>'role' from auth.users where id='af220000-0000-4000-8000-000000000001'),'customer','role is unchanged');
select is((select count(*) from auth.sessions where user_id='af220000-0000-4000-8000-000000000003'),1::bigint,'other users retain their sessions');
select throws_ok($$update auth.users set encrypted_password='reused',raw_app_meta_data=raw_app_meta_data||jsonb_build_object('barber_password_operation',current_setting('password.operation')) where id='af220000-0000-4000-8000-000000000001'$$,'P0001','PASSWORD_PROOF_REQUIRED','applied operation cannot authorize another write');
select throws_ok($$select public.customer_password_api('status',current_setting('password.identity')::jsonb)$$,'P0001','AUTH_REQUIRED','revoked session cannot use the account API');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"af220000-0000-4000-8000-000000000001","session_id":"af220000-0000-4000-8000-000000000011","app_metadata":{"role":"customer"}}',true);
select throws_ok($$select public.enforce_password_session()$$,'PT401',case when to_regprocedure('public.enforce_account_session()') is null then 'AUTH_REQUIRED' else 'SESSION_ENDED' end,'revoked JWT cannot use the Data API');

-- Recovery/set proofs bind account, session, expiry and native device state.
select throws_ok($$select public.customer_password_api('request-start',current_setting('password.provider')::jsonb||'{"request_id":"af220000-0000-4000-8000-000000000081","purpose":"set","client":"ios","email":"attacker@example.test","native_state":"af220000-0000-4000-8000-000000000082"}')$$,'P0001','INVALID_REQUEST','native password requests require a verifier challenge');
select is(public.customer_password_api('request-start',current_setting('password.provider')::jsonb||'{"request_id":"af220000-0000-4000-8000-000000000081","purpose":"set","client":"web","email":"attacker@example.test"}')->>'email','provider-proof@customer.test','password setup derives the trusted email');
select is((select purpose from private.customer_password_requests where id='af220000-0000-4000-8000-000000000081'),'set','provider setup records an explicit verification purpose');
update auth.users set recovery_token='isolated-auth-generated-token' where id='af220000-0000-4000-8000-000000000002';
select public.customer_password_api('request-ready','{"request_id":"af220000-0000-4000-8000-000000000081"}');
select is(public.customer_password_api('request-load','{"request_id":"af220000-0000-4000-8000-000000000081","client":"web"}')->>'userId','af220000-0000-4000-8000-000000000002','recovery request binds only its original identity');
update private.customer_password_requests set expires_at=now()-interval '1 second' where id='af220000-0000-4000-8000-000000000081';
select throws_ok($$select public.customer_password_api('request-load','{"request_id":"af220000-0000-4000-8000-000000000081","client":"web"}')$$,'P0001','INVALID_CODE','expired recovery requests are rejected');
insert into private.customer_password_proofs(id,user_id,session_id,purpose,account_role,account_email,password_fingerprint,expires_at) values
('af220000-0000-4000-8000-000000000083','af220000-0000-4000-8000-000000000002','af220000-0000-4000-8000-000000000021','set','manager','provider-proof@customer.test',md5(''),now()-interval '1 second');
select throws_ok($$select public.customer_password_api('prepare',current_setting('password.provider')::jsonb||'{"proof":"af220000-0000-4000-8000-000000000083"}')$$,'P0001','PASSWORD_PROOF_REQUIRED','expired password proof is rejected');
update private.customer_password_proofs set expires_at=now()+interval '5 minutes' where id='af220000-0000-4000-8000-000000000083';
select throws_ok($$select public.customer_password_api('prepare',current_setting('password.provider')::jsonb||'{"proof":"af220000-0000-4000-8000-000000000083","session_id":"af220000-0000-4000-8000-000000000031"}')$$,'P0001','AUTH_REQUIRED','another person cannot use the verification session');
update private.customer_password_proofs set account_email='changed@example.test' where id='af220000-0000-4000-8000-000000000083';
select throws_ok($$select public.customer_password_api('prepare',current_setting('password.provider')::jsonb||'{"proof":"af220000-0000-4000-8000-000000000083"}')$$,'P0001','PASSWORD_PROOF_REQUIRED','changed account email invalidates a proof');
update private.customer_password_proofs set account_email='provider-proof@customer.test',account_role='customer' where id='af220000-0000-4000-8000-000000000083';
select throws_ok($$select public.customer_password_api('prepare',current_setting('password.provider')::jsonb||'{"proof":"af220000-0000-4000-8000-000000000083"}')$$,'P0001','PASSWORD_PROOF_REQUIRED','changed account role invalidates a proof');
select throws_ok($$select public.customer_password_api('invite-start','{"token_hash":"not-an-invitation"}')$$,'P0001','INVALID_CODE','bootstrap requires the exact pending invitation token');

select * from finish();
rollback;
