begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
select is((select count(*) from information_schema.columns where table_schema='private' and table_name='customer_accounts' and column_name in ('name','phone','phone_e164','email','country_code')),0::bigint,'account table only links identity to the canonical profile');
select ok(not has_table_privilege('authenticated','private.customer_account_profiles','SELECT'),'computed account projection remains private');
select ok((select relrowsecurity from pg_class where oid='public.customer_staff_details'::regclass),'staff annotations have RLS');
select is((select count(*) from information_schema.columns where table_schema='public' and table_name='customers' and column_name in ('notes','tags')),0::bigint,'internal notes are separate from customer contacts');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('ab920000-0000-4000-8000-000000000101','canonical-one@example.test',now(),'{"role":"customer"}'),
('ab920000-0000-4000-8000-000000000102','canonical-two@example.test',now(),'{"role":"customer"}');
insert into auth.sessions(id,user_id) values
('ab920000-0000-4000-8000-000000000201','ab920000-0000-4000-8000-000000000101'),
('ab920000-0000-4000-8000-000000000202','ab920000-0000-4000-8000-000000000102');
select set_config('canonical.one','{"user_id":"ab920000-0000-4000-8000-000000000101","session_id":"ab920000-0000-4000-8000-000000000201","name":"Canonical Customer"}',true);
select set_config('canonical.two','{"user_id":"ab920000-0000-4000-8000-000000000102","session_id":"ab920000-0000-4000-8000-000000000202","name":"Other Customer"}',true);
select set_config('canonical.profile',public.customer_account_api('email-ensure',current_setting('canonical.one')::jsonb)::text,true);
select public.customer_account_api('email-ensure',current_setting('canonical.two')::jsonb);
select is(current_setting('canonical.profile')::jsonb->>'id','ab920000-0000-4000-8000-000000000101','existing API id remains the account identity for web and iOS');
select ok((current_setting('canonical.profile')::jsonb->>'customerId')::uuid is not null,'API exposes the canonical customer reference');
select public.customer_account_api('update-profile',current_setting('canonical.one')::jsonb||'{"name":"Changed Once","phone":"59998401","country_code":"+965"}');
select is((select name::text from public.customers where id=(current_setting('canonical.profile')::jsonb->>'customerId')::uuid),'Changed Once','customer edit changes the actual staff/booking profile');
select is((select phone::text from public.customers where id=(current_setting('canonical.profile')::jsonb->>'customerId')::uuid),'59998401','phone is stored in the one customer record');
update public.customers set name='Staff Correction' where id=(current_setting('canonical.profile')::jsonb->>'customerId')::uuid;
select is(public.customer_account_api('profile',current_setting('canonical.one')::jsonb)->>'name','Staff Correction','staff correction is visible to the customer without synchronizing copies');
select throws_ok($$select public.customer_account_api('update-profile',current_setting('canonical.two')::jsonb||'{"phone":"59998401","country_code":"+965"}')$$,'23505','PHONE_IN_USE','another profile cannot take the number');
select is(private.resolve_booking_customer('ab920000-0000-4000-8000-000000000101','ab920000-0000-4000-8000-000000000201'),(current_setting('canonical.profile')::jsonb->>'customerId')::uuid,'booking resolves the canonical customer using the live account link');
select throws_ok($$select private.resolve_booking_customer('ab920000-0000-4000-8000-000000000101','ab920000-0000-4000-8000-000000000202')$$,'P0001','AUTH_REQUIRED','another customer session cannot resolve the account');
select is(public.customer_account_api('bookings',current_setting('canonical.two')::jsonb),'[]'::jsonb,'new profile has no inferred history');
update auth.users set email='canonical-confirmed@example.test' where id='ab920000-0000-4000-8000-000000000101';
select is((select email::text from public.customers where id=(current_setting('canonical.profile')::jsonb->>'customerId')::uuid),'canonical-confirmed@example.test','confirmed login-email change reaches the canonical contact');
select set_config('request.jwt.claims','{"sub":"ab920000-0000-4000-8000-000000000101","role":"authenticated","app_metadata":{"role":"customer"}}',true);
set local role authenticated;
select is((select count(*) from public.customers where id=(current_setting('canonical.profile')::jsonb->>'customerId')::uuid),0::bigint,'customer cannot bypass the account API and read staff records');
select is((select count(*) from public.customer_staff_details),0::bigint,'customer cannot read staff notes');
select throws_ok($$select public.save_customer_profile(null,'{"name":"Forged staff record"}')$$,'42501','NOT_AUTHORIZED','customer cannot execute staff contact writes');
reset role;
insert into public.bookings(id,customer_id,branch_id,barber_id,service_ids,date,time,duration,price,status,added_by_type)
values('ab920000-0000-4000-8000-000000000301',(current_setting('canonical.profile')::jsonb->>'customerId')::uuid,'10000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000121',array['20000000-0000-4000-8000-000000000121']::uuid[],'2039-01-02','09:00',30,5,'completed','system');
select private.record_customer_booking_owner('ab920000-0000-4000-8000-000000000301','ab920000-0000-4000-8000-000000000101','ab920000-0000-4000-8000-000000000201');
select public.customer_account_api('update-profile',current_setting('canonical.one')::jsonb||'{"phone":"59998402","country_code":"+965"}');
select is((select customer_id from public.bookings where id='ab920000-0000-4000-8000-000000000301'),(current_setting('canonical.profile')::jsonb->>'customerId')::uuid,'phone change retains the booking customer ID');
select is(public.customer_account_api('bookings',current_setting('canonical.one')::jsonb)->0->>'id','ab920000-0000-4000-8000-000000000301','owned history survives a phone change');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"role":"agent"}}',true);
set local role authenticated;
select lives_ok($$select public.save_customer_profile((current_setting('canonical.profile')::jsonb->>'customerId')::uuid,'{"name":"Agent Correction","notes":"Internal only","tags":["test"]}')$$,'agent atomically saves contact and separate annotations');
select is((select notes from public.customer_staff_details where customer_id=(current_setting('canonical.profile')::jsonb->>'customerId')::uuid),'Internal only','staff annotation references the same customer');
reset role;
select is(public.customer_account_api('profile',current_setting('canonical.one')::jsonb)->>'name','Agent Correction','staff RPC edits are visible in the customer profile');
select ok(not (public.customer_account_api('profile',current_setting('canonical.one')::jsonb) ? 'notes'),'customer API never exposes staff notes');
select * from finish();
rollback;
