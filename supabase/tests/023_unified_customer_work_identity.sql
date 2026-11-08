begin;
-- These legacy authorization fixtures represent already-published shops.
alter table public.branches alter column publication_state set default 'published';
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
('df110000-0000-4000-8000-000000000001','unified-manager@example.test',now(),'{"role":"manager"}','{"name":"Personal Manager","phone":"+96559997401"}'),
('df110000-0000-4000-8000-000000000002','unified-barber@example.test',now(),'{"role":"barber"}','{"name":"Personal Barber","phone":"+96559997402"}'),
('df110000-0000-4000-8000-000000000003','unified-customer@example.test',now(),'{"role":"customer"}','{"name":"Personal Customer"}'),
('df110000-0000-4000-8000-000000000004','unified-other@example.test',now(),'{"role":"manager"}','{"name":"Other Manager","phone":"+96559997404"}');
insert into auth.sessions(id,user_id) values
('df110000-0000-4000-8000-000000000011','df110000-0000-4000-8000-000000000001'),
('df110000-0000-4000-8000-000000000012','df110000-0000-4000-8000-000000000002'),
('df110000-0000-4000-8000-000000000013','df110000-0000-4000-8000-000000000003'),
('df110000-0000-4000-8000-000000000014','df110000-0000-4000-8000-000000000004');
select set_config('unified.manager','{"user_id":"df110000-0000-4000-8000-000000000001","session_id":"df110000-0000-4000-8000-000000000011"}',true);
select set_config('unified.barber','{"user_id":"df110000-0000-4000-8000-000000000002","session_id":"df110000-0000-4000-8000-000000000012"}',true);
select set_config('unified.customer','{"user_id":"df110000-0000-4000-8000-000000000003","session_id":"df110000-0000-4000-8000-000000000013","name":"Personal Customer"}',true);
select set_config('unified.other','{"user_id":"df110000-0000-4000-8000-000000000004","session_id":"df110000-0000-4000-8000-000000000014"}',true);
insert into public.branches(id,manager_id,name,status) values
('df110000-0000-4000-8000-000000000101','df110000-0000-4000-8000-000000000001','Unified Own Shop','active'),
('df110000-0000-4000-8000-000000000102','df110000-0000-4000-8000-000000000004','Unified Other Shop','active');
insert into public.barbers(id,user_id,branch_id,name,status,phone,country_code) values
('df110000-0000-4000-8000-000000000201','df110000-0000-4000-8000-000000000002','df110000-0000-4000-8000-000000000101','Professional Barber','inactive','59997402','+965'),
('df110000-0000-4000-8000-000000000202',null,'df110000-0000-4000-8000-000000000102','Other Barber','inactive',null,'+965');
select set_config('unified.profile',public.customer_account_api('profile',current_setting('unified.manager')::jsonb)::text,true);
select is(current_setting('unified.profile')::jsonb->>'id','df110000-0000-4000-8000-000000000001','manager customer mode keeps the same Auth identity');
select is(current_setting('unified.profile')::jsonb->>'phone','59997401','manager reuses own existing phone');
select is(public.customer_account_api('profile',current_setting('unified.manager')::jsonb)->>'customerId',current_setting('unified.profile')::jsonb->>'customerId','repeat switch reuses one canonical customer');
select is((select count(*) from private.customer_accounts where user_id='df110000-0000-4000-8000-000000000001'),1::bigint,'switching never duplicates the persona');
select is((select raw_app_meta_data->>'role' from auth.users where id='df110000-0000-4000-8000-000000000001'),'manager','mode switch never rewrites role');
select set_config('unified.barberprofile',public.customer_account_api('profile',current_setting('unified.barber')::jsonb)::text,true);
select is(current_setting('unified.barberprofile')::jsonb->>'phone','59997402','barber reuses own phone across all existing sources');
select is(current_setting('unified.barberprofile')::jsonb->'ownBarberIds','["df110000-0000-4000-8000-000000000201"]'::jsonb,'customer UI knows only its own barber IDs');
select public.customer_account_api('email-ensure',current_setting('unified.customer')::jsonb);
select public.customer_account_api('profile',current_setting('unified.other')::jsonb);
select throws_ok($$select public.customer_account_api('update-profile',current_setting('unified.customer')::jsonb||'{"name":"Customer","phone":"59997402","country_code":"+965"}')$$,'23505','PHONE_IN_USE','different customer cannot claim staff phone');
select throws_ok($$update public.branches set phone='59997402',country_code='+965' where id='df110000-0000-4000-8000-000000000102'$$,'23505','PHONE_IN_USE','shop contact cannot claim staff/customer phone');
select throws_ok($$select private.resolve_booking_customer('df110000-0000-4000-8000-000000000001','df110000-0000-4000-8000-000000000012')$$,'P0001','AUTH_REQUIRED','other staff session cannot impersonate manager persona');
select is(private.resolve_booking_customer('df110000-0000-4000-8000-000000000001','df110000-0000-4000-8000-000000000011'),(current_setting('unified.profile')::jsonb->>'customerId')::uuid,'staff customer booking resolves the same live identity');
select ok(not public.customer_checkout_phone((current_setting('unified.profile')::jsonb->>'customerId')::uuid,'+965','59997401',false),'work phone does not automatically count as SMS verified');
select ok(public.customer_checkout_phone((current_setting('unified.profile')::jsonb->>'customerId')::uuid,'+965','59997401',true),'valid provider proof verifies staff personal checkout phone');
select public.customer_account_api('update-profile',current_setting('unified.manager')::jsonb||'{"name":"Updated Personal Manager","phone":"59997405","country_code":"+965"}');
select is((select raw_user_meta_data->>'phone' from auth.users where id='df110000-0000-4000-8000-000000000001'),'+96559997405','personal phone update reaches work Settings');
select ok(not public.customer_checkout_phone((current_setting('unified.profile')::jsonb->>'customerId')::uuid,'+965','59997405',false),'number changes clear phone verification');
select ok(not exists(select 1 from private.phone_numbers where phone='+96559997401'),'old phone is released after a canonical update');
update public.barbers set phone='59997406' where id='df110000-0000-4000-8000-000000000201';
select is(public.customer_account_api('profile',current_setting('unified.barber')::jsonb)->>'phone','59997406','work profile phone update reaches customer mode');
select is((select raw_user_meta_data->>'phone' from auth.users where id='df110000-0000-4000-8000-000000000002'),'+96559997406','work phone update also reaches account contact');
select is((select name::text from public.barbers where id='df110000-0000-4000-8000-000000000201'),'Professional Barber','professional display name remains separate');
select public.customer_account_api('update-profile',current_setting('unified.barber')::jsonb||'{"name":"Updated Personal Barber","phone":"59997407","country_code":"+965"}');
select is((select phone::text from public.barbers where id='df110000-0000-4000-8000-000000000201'),'59997407','canonical phone updates barber compatibility field');
select ok(not exists(select 1 from private.phone_numbers where phone in ('+96559997402','+96559997406')),'old staff numbers are released without leaving stale claims');
update auth.users set raw_user_meta_data=raw_user_meta_data||'{"phone":"+96559997408"}' where id='df110000-0000-4000-8000-000000000002';
select is(public.customer_account_api('profile',current_setting('unified.barber')::jsonb)->>'phone','59997408','Auth account contact update reaches canonical contact');
select throws_ok($$insert into public.bookings(branch_id,barber_id,customer_id,date,time,status,added_by_type) values('df110000-0000-4000-8000-000000000101','df110000-0000-4000-8000-000000000201',(current_setting('unified.barberprofile')::jsonb->>'customerId')::uuid,'2020-01-02','09:00','completed','customer')$$,'P0001','SELF_BOOKING_NOT_ALLOWED','database blocks barber self-booking even through direct inserts');
select set_config('request.jwt.claims','{"sub":"df110000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
insert into public.barbers(id,user_id,branch_id,name,manager_chair,status) values('df110000-0000-4000-8000-000000000203','df110000-0000-4000-8000-000000000001','df110000-0000-4000-8000-000000000101','Manager Chair',true,'inactive');
select is(public.is_manager(),true,'customer mode does not remove manager work permissions');
select is(public.is_barber(),false,'My Chair still does not create a separate barber role');
reset role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$insert into public.bookings(branch_id,barber_id,customer_id,date,time,status,added_by_type) values('df110000-0000-4000-8000-000000000101','df110000-0000-4000-8000-000000000203',(current_setting('unified.profile')::jsonb->>'customerId')::uuid,'2020-01-02','09:00','completed','customer')$$,'P0001','SELF_BOOKING_NOT_ALLOWED','database also blocks manager self-booking with their chair');
insert into public.bookings(id,branch_id,barber_id,customer_id,date,time,status,added_by_type) values
('df110000-0000-4000-8000-000000000301','df110000-0000-4000-8000-000000000102','df110000-0000-4000-8000-000000000202',(current_setting('unified.profile')::jsonb->>'customerId')::uuid,'2020-01-02','09:00','completed','customer');
select private.record_customer_booking_owner('df110000-0000-4000-8000-000000000301','df110000-0000-4000-8000-000000000001','df110000-0000-4000-8000-000000000011');
select is(public.customer_account_api('bookings',current_setting('unified.manager')::jsonb)->0->>'id','df110000-0000-4000-8000-000000000301','manager can see own personal booking outside work shop');
select is(public.customer_account_api('bookings',current_setting('unified.barber')::jsonb),'[]'::jsonb,'barber never sees other person’s personal history');
select lives_ok($$select public.customer_account_api('rate-booking',current_setting('unified.manager')::jsonb||'{"booking_id":"df110000-0000-4000-8000-000000000301","shop_rating":4,"barber_rating":5,"review":"Private personal review"}')$$,'staff personal customer can rate their own completed booking');
select lives_ok($$select public.customer_favourites_api('favourites-save',current_setting('unified.manager')::jsonb||'{"kind":"shop","target_id":"df110000-0000-4000-8000-000000000102"}')$$,'staff personal customer can save a favourite shop');
select set_config('request.jwt.claims','{"sub":"df110000-0000-4000-8000-000000000001","session_id":"df110000-0000-4000-8000-000000000011","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select is((select count(*) from public.branches where id='df110000-0000-4000-8000-000000000102'),0::bigint,'personal booking grants no work access to other shop');
select ok(not has_function_privilege('authenticated','public.customer_account_api(text,jsonb)','execute'),'customer gateway remains service-only');
select ok(not has_function_privilege('anon','public.customer_session_is_live(uuid,uuid)','execute'),'anonymous user cannot inspect live personal sessions');
reset role;
update auth.sessions set not_after=now() where id='df110000-0000-4000-8000-000000000011';
select throws_ok($$select public.customer_account_api('profile',current_setting('unified.manager')::jsonb)$$,'P0001','AUTH_REQUIRED','ending a staff session also ends customer-mode access');
select throws_ok($$select private.resolve_booking_customer('df110000-0000-4000-8000-000000000001','df110000-0000-4000-8000-000000000011')$$,'P0001','AUTH_REQUIRED','expired staff session cannot book');
update auth.users set banned_until=now()+interval '1 hour' where id='df110000-0000-4000-8000-000000000002';
select throws_ok($$select public.customer_account_api('profile',current_setting('unified.barber')::jsonb)$$,'P0001','AUTH_REQUIRED','suspended staff cannot bypass suspension in customer mode');
select * from finish();
rollback;
