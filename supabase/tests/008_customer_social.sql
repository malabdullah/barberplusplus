begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='private.customer_social_identities'::regclass),'social mappings have RLS');
select ok(not has_table_privilege('authenticated','private.customer_social_identities','SELECT'),'customers cannot read mappings');
select ok(not has_table_privilege('service_role','private.customer_social_identities','INSERT'),'mapping writes require the gateway');
insert into auth.users(id,phone,phone_confirmed_at,raw_app_meta_data) values('88888888-0000-4000-8000-000000000101','96559999711',now(),'{"role":"customer"}');
select public.customer_account_api('link','{"user_id":"88888888-0000-4000-8000-000000000101","name":"Existing Customer","phone":"59999711","country_code":"+965","phone_e164":"+96559999711","email":"kept@customer.test"}');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('88888888-0000-4000-8000-000000000102','google@oauth.test','{"provider":"google"}','{"role":"admin"}'),
('88888888-0000-4000-8000-000000000103','apple@oauth.test','{"provider":"apple"}','{}'),
('88888888-0000-4000-8000-000000000104','other@oauth.test','{"provider":"google"}','{}'),
('88888888-0000-4000-8000-000000000105','staff@oauth.test','{"provider":"google","role":"manager"}','{}'),
('88888888-0000-4000-8000-000000000106','fresh@oauth.test','{"provider":"google"}','{}');
select is((select raw_app_meta_data->>'role' from auth.users where id='88888888-0000-4000-8000-000000000102'),'customer','Google gets customer role, ignoring editable metadata');
select is((select raw_app_meta_data->>'role' from auth.users where id='88888888-0000-4000-8000-000000000103'),'customer','Apple gets customer role');
select is((select raw_app_meta_data->>'role' from auth.users where id='88888888-0000-4000-8000-000000000105'),'manager','explicit staff role is preserved');
insert into auth.identities(user_id,provider,provider_id,identity_data) select id,raw_app_meta_data->>'provider',id::text,jsonb_build_object('sub',id::text) from auth.users where id in ('88888888-0000-4000-8000-000000000102','88888888-0000-4000-8000-000000000103','88888888-0000-4000-8000-000000000104','88888888-0000-4000-8000-000000000105','88888888-0000-4000-8000-000000000106');
insert into auth.sessions(id,user_id,created_at,updated_at) select ('88888888-0000-4000-8000-0000000003'||n)::uuid,('88888888-0000-4000-8000-0000000001'||n)::uuid,now(),now() from unnest(array['01','02','03','04','05','06']) n;
select set_config('test.social', '{"user_id":"88888888-0000-4000-8000-000000000102","session_id":"88888888-0000-4000-8000-000000000302"}',true);
select is(public.customer_account_api('social-status',current_setting('test.social')::jsonb)->'profile','null'::jsonb,'new provider user must complete phone verification');
select throws_ok($$select public.customer_account_api('profile',current_setting('test.social')::jsonb)$$,'P0001','AUTH_REQUIRED','unlinked provider cannot access account data');
select throws_ok($$select public.customer_account_api('social-status','{"user_id":"88888888-0000-4000-8000-000000000105","session_id":"88888888-0000-4000-8000-000000000305"}')$$,'P0001','AUTH_REQUIRED','staff OAuth session cannot enter customer onboarding');
select throws_ok($$select public.customer_account_api('social-status',current_setting('test.social')::jsonb||'{"session_id":"88888888-0000-4000-8000-000000000304"}')$$,'P0001','AUTH_REQUIRED','provider session must belong to that user');
select public.customer_account_api('issue',jsonb_build_object('id','88888888-0000-4000-8000-000000000401','purpose','social','phone_e164','+96559999711','code_hash','correct','payload',current_setting('test.social')::jsonb||'{"social_user_id":"88888888-0000-4000-8000-000000000102","social_session_id":"88888888-0000-4000-8000-000000000302","phone":"59999711","country_code":"+965","phone_e164":"+96559999711","name":"Must not replace existing name"}'));
select throws_ok($$select public.customer_account_api('social-link',current_setting('test.social')::jsonb||'{"challenge_id":"88888888-0000-4000-8000-000000000401","phone_e164":"+96559999711"}')$$,'P0001','INVALID_CODE','unconsumed phone challenge cannot link accounts');
select is(public.customer_account_api('consume','{"id":"88888888-0000-4000-8000-000000000401","purpose":"social","code_hash":"correct","user_id":"88888888-0000-4000-8000-000000000104","session_id":"88888888-0000-4000-8000-000000000304"}'),'null'::jsonb,'another identity cannot consume a phone challenge');
select is((select consumed_at is null from private.customer_auth_challenges where id='88888888-0000-4000-8000-000000000401'),true,'wrong identity does not consume the rightful code');
select set_config('test.payload',public.customer_account_api('consume',current_setting('test.social')::jsonb||'{"id":"88888888-0000-4000-8000-000000000401","purpose":"social","code_hash":"correct"}')::text,true);
select is(public.customer_account_api('social-link',current_setting('test.social')::jsonb||current_setting('test.payload')::jsonb)->>'id','88888888-0000-4000-8000-000000000101','verified phone links to existing account');
select is(public.customer_account_api('profile',current_setting('test.social')::jsonb)->>'name','Existing Customer','linking preserves existing name');
select is(public.customer_account_api('profile',current_setting('test.social')::jsonb)->>'email','kept@customer.test','linking preserves profile email');
select is(public.customer_account_api('social-status',current_setting('test.social')::jsonb)->'profile'->>'id','88888888-0000-4000-8000-000000000101','returning social identity resolves existing profile');
select is((select count(*) from private.customer_accounts where phone_e164='+96559999711'),1::bigint,'no duplicate customer account is created');
select throws_ok($$select public.customer_account_api('profile',current_setting('test.social')::jsonb||'{"session_id":"88888888-0000-4000-8000-000000000304"}')$$,'P0001','AUTH_REQUIRED','linked identity still cannot use another session');
-- A new phone creates a canonical customer; provider email stays Auth-only.
select set_config('test.new_social','{"user_id":"88888888-0000-4000-8000-000000000106","session_id":"88888888-0000-4000-8000-000000000306"}',true);
select public.customer_account_api('issue',jsonb_build_object('id','88888888-0000-4000-8000-000000000402','purpose','social','phone_e164','+96559999712','code_hash','correct','payload','{"social_user_id":"88888888-0000-4000-8000-000000000106","social_session_id":"88888888-0000-4000-8000-000000000306","phone":"59999712","country_code":"+965","phone_e164":"+96559999712","name":"New Social Customer"}'::jsonb));
select set_config('test.new_payload',public.customer_account_api('consume',current_setting('test.new_social')::jsonb||'{"id":"88888888-0000-4000-8000-000000000402","purpose":"social","code_hash":"correct"}')::text,true);
select is(public.customer_account_api('social-link',current_setting('test.new_social')::jsonb||current_setting('test.new_payload')::jsonb)->>'phone','59999712','new social customer gets verified phone');
select is(public.customer_account_api('profile',current_setting('test.new_social')::jsonb)->>'email',null,'provider email is not imported into contact profile');
select is(public.customer_account_api('update-profile',current_setting('test.new_social')::jsonb||'{"name":"New Social Customer","email":"later@customer.test"}')->>'email','later@customer.test','email can be added later in profile');
-- Phone recovery revokes both original and linked provider sessions.
select public.customer_account_api('issue','{"id":"88888888-0000-4000-8000-000000000403","purpose":"recovery","phone_e164":"+96559999711","code_hash":"reset","payload":{}}');
select public.customer_account_api('consume','{"id":"88888888-0000-4000-8000-000000000403","purpose":"recovery","code_hash":"reset"}');
select public.customer_account_api('finish-reset','{"user_id":"88888888-0000-4000-8000-000000000101","guard_id":"88888888-0000-4000-8000-000000000403"}');
select is((select count(*) from auth.sessions where user_id in ('88888888-0000-4000-8000-000000000101','88888888-0000-4000-8000-000000000102')),0::bigint,'reset revokes phone and linked OAuth sessions');
select throws_ok($$select public.customer_account_api('profile',current_setting('test.social')::jsonb)$$,'P0001','AUTH_REQUIRED','old linked OAuth session cannot read the account after reset');
select lives_ok($$select public.customer_account_api('profile',current_setting('test.new_social')::jsonb)$$,'recovery leaves unrelated account session valid');
select * from finish();
rollback;
