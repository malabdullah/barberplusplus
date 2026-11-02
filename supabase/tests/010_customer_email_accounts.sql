begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
('99999999-0000-4000-8000-000000000101','email-one@customer.test',now(),'{"role":"customer"}','{"name":"Customer One"}'),
('99999999-0000-4000-8000-000000000102','email-two@customer.test',now(),'{"role":"customer"}','{"name":"Customer Two"}'),
('99999999-0000-4000-8000-000000000103','unconfirmed@customer.test',null,'{"role":"customer"}','{}'),
('99999999-0000-4000-8000-000000000104','manager@customer.test',now(),'{"role":"manager"}','{}');
insert into auth.sessions(id,user_id,created_at,updated_at) select ('99999999-0000-4000-8000-0000000003'||n)::uuid,('99999999-0000-4000-8000-0000000001'||n)::uuid,now(),now() from unnest(array['01','02','03','04']) n;
select set_config('email.one','{"user_id":"99999999-0000-4000-8000-000000000101","session_id":"99999999-0000-4000-8000-000000000301","name":"Customer One"}',true);
select set_config('email.two','{"user_id":"99999999-0000-4000-8000-000000000102","session_id":"99999999-0000-4000-8000-000000000302","name":"Customer Two"}',true);
select throws_ok($$select public.customer_account_api('email-ensure','{"user_id":"99999999-0000-4000-8000-000000000103","session_id":"99999999-0000-4000-8000-000000000303","name":"Unconfirmed"}')$$,'P0001','AUTH_REQUIRED','unconfirmed email cannot create profile');
select throws_ok($$select public.customer_account_api('email-ensure','{"user_id":"99999999-0000-4000-8000-000000000104","session_id":"99999999-0000-4000-8000-000000000304","name":"Manager"}')$$,'P0001','AUTH_REQUIRED','staff session cannot create customer profile');
select is(public.customer_account_api('email-ensure',current_setting('email.one')::jsonb)->>'email','email-one@customer.test','confirmed customer creates profile using trusted email');
select is(public.customer_account_api('profile',current_setting('email.one')::jsonb)->>'phone',null,'phone is optional before booking');
select ok((select customer_id is not null from private.customer_accounts where user_id='99999999-0000-4000-8000-000000000101'),'signup creates a canonical customer without claiming a guest record');
select is(public.customer_account_api('email-ensure',current_setting('email.two')::jsonb)->>'email','email-two@customer.test','another customer gets independent profile');
select public.customer_account_api('update-profile',current_setting('email.one')::jsonb||'{"phone":"50009999","country_code":"+965","email":"forged@test.invalid"}');
select throws_ok($$select public.customer_account_api('update-profile',current_setting('email.two')::jsonb||'{"phone":"50009999","country_code":"+965"}')$$,'23505','PHONE_IN_USE','second customer cannot share the first phone');
select public.customer_account_api('update-profile',current_setting('email.two')::jsonb||'{"phone":"50009998","country_code":"+965"}');
select is((select count(*) from private.customer_account_profiles where phone='50009999'),1::bigint,'customer contact number remains unique');
select is(public.customer_account_api('profile',current_setting('email.one')::jsonb)->>'email','email-one@customer.test','untrusted profile email cannot replace Auth identity');
select throws_ok($$select public.customer_account_api('profile',current_setting('email.one')::jsonb||'{"session_id":"99999999-0000-4000-8000-000000000302"}')$$,'P0001','AUTH_REQUIRED','another session cannot access profile');
select is(public.customer_account_api('bookings',current_setting('email.one')::jsonb),'[]'::jsonb,'empty account has no inferred phone-based history');
insert into public.bookings(id,branch_id,barber_id,service_ids,date,time,duration,price,status,added_by_type) values
('99999999-0000-4000-8000-000000000401','10000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000121',array['20000000-0000-4000-8000-000000000121']::uuid[],current_date-1,'09:00',30,5,'completed','system');
update public.bookings set customer_id=(select customer_id from private.customer_accounts where user_id='99999999-0000-4000-8000-000000000101') where id='99999999-0000-4000-8000-000000000401';
select private.record_customer_booking_owner('99999999-0000-4000-8000-000000000401','99999999-0000-4000-8000-000000000101','99999999-0000-4000-8000-000000000301');
select is(public.customer_account_api('bookings',current_setting('email.one')::jsonb)->0->>'branch_id','10000000-0000-4000-8000-000000000012','owned history returns exact shop ID for rebooking');
select is(public.customer_account_api('bookings',current_setting('email.one')::jsonb)->0->>'barber_id','30000000-0000-4000-8000-000000000121','owned history returns exact barber ID for rebooking');
select is(public.customer_account_api('bookings',current_setting('email.one')::jsonb)->0->'service_ids','["20000000-0000-4000-8000-000000000121"]'::jsonb,'owned history retains service IDs for the iOS client');
select is(public.customer_account_api('bookings',current_setting('email.two')::jsonb),'[]'::jsonb,'another customer cannot read rebooking selections');
select throws_ok($$select public.customer_account_api('bookings',current_setting('email.one')::jsonb||'{"session_id":"99999999-0000-4000-8000-000000000302"}')$$,'P0001','AUTH_REQUIRED','rebooking history requires the original customer session');
select ok(not has_table_privilege('authenticated','private.customer_accounts','SELECT'),'customers cannot directly read private profiles');
select * from finish();
rollback;
