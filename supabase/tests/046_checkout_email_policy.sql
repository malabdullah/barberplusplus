begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into private.customer_booking_email_runtime(singleton,enabled,api_url)values(true,true,'https://qvkucvcjmojjbphlzlks.supabase.co')on conflict(singleton)do update set enabled=true,enabled_since=clock_timestamp();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
 ('fb101000-0000-4000-8000-000000000001','managed-manager@example.test',now(),'{"role":"manager"}'),
 ('fb101000-0000-4000-8000-000000000002','managed-other@example.test',now(),'{"role":"manager"}'),
 ('fb101000-0000-4000-8000-000000000003','managed-admin@example.test',now(),'{"role":"admin"}'),
 ('fb101000-0000-4000-8000-000000000004','managed-barber@example.test',now(),'{"role":"barber"}');
insert into auth.sessions(id,user_id) select ('fb101000-0000-4000-8000-00000000001'||n)::uuid,('fb101000-0000-4000-8000-00000000000'||n)::uuid from generate_series(1,4)n;
insert into public.branches(id,manager_id,name,city,governorate_id,area_id,image_url,working_hours)
select 'fb101000-0000-4000-8000-000000000101','fb101000-0000-4000-8000-000000000001','Managed QA Shop','Managed QA City',9001,9001,'/booking-demo/market-street.png',
 jsonb_object_agg(day,'{"open":"09:00","close":"18:00"}'::jsonb) from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day;
insert into public.branches(id,manager_id,name) values('fb101000-0000-4000-8000-000000000102','fb101000-0000-4000-8000-000000000002','Managed Other Shop');
insert into public.services(id,branch_id,name,duration,price) values
 ('fb101000-0000-4000-8000-000000000201','fb101000-0000-4000-8000-000000000101','Managed Cut',30,3),
 ('fb101000-0000-4000-8000-000000000202','fb101000-0000-4000-8000-000000000101','Managed Beard',15,2),
 ('fb101000-0000-4000-8000-000000000203','fb101000-0000-4000-8000-000000000102','Other Service',30,4);
select set_config('managed.owner','{"sub":"fb101000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fb101000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
select set_config('managed.profile','{"id":"fb101000-0000-4000-8000-000000000301","name":"Managed QA Barber"}',true);
select set_config('request.jwt.claims',current_setting('managed.owner'),true);
set local role authenticated;
select is(public.create_managed_barber('fb101000-0000-4000-8000-000000000101',current_setting('managed.profile')::jsonb)->>'status','inactive','name-only profile starts inactive');
select is(public.create_managed_barber('fb101000-0000-4000-8000-000000000101',current_setting('managed.profile')::jsonb)->>'id','fb101000-0000-4000-8000-000000000301','retry uses same profile ID');
select is((select count(*) from public.barbers where id='fb101000-0000-4000-8000-000000000301'),1::bigint,'retry creates no duplicate');
select ok((select user_id is null and email is null and phone is null and management_mode='managed' and auto_confirm_bookings and availability_approved_at is null from public.barbers where id='fb101000-0000-4000-8000-000000000301'),'no credentials or required contact; auto-confirm on');
select throws_ok($$update public.barbers set status='active' where id='fb101000-0000-4000-8000-000000000301'$$,'P0001','BARBER_SERVICES_REQUIRED','cannot activate without services');
select throws_ok($$update public.barbers set service_ids=array['fb101000-0000-4000-8000-000000000203']::uuid[] where id='fb101000-0000-4000-8000-000000000301'$$,'P0001','INVALID_SERVICE_ASSIGNMENT','services cannot come from another shop');
update public.barbers set service_ids=array['fb101000-0000-4000-8000-000000000201','fb101000-0000-4000-8000-000000000202']::uuid[] where id='fb101000-0000-4000-8000-000000000301';
select throws_ok($$update public.barbers set status='active' where id='fb101000-0000-4000-8000-000000000301'$$,'P0001','BARBER_HOURS_REQUIRED','cannot activate without hours');
select set_config('managed.hours',(select jsonb_build_object('availability',jsonb_object_agg(day,'{"enabled":true,"start":"09:00","end":"18:00"}'::jsonb),'time_offs','[]'::jsonb,'vacations','[]'::jsonb,'max_booking_days',30)::text from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day),true);
select lives_ok($$select public.barber_availability('direct',jsonb_build_object('barber_id','fb101000-0000-4000-8000-000000000301','base_revision',0,'proposal',current_setting('managed.hours')::jsonb))$$,'manager sets approved hours without barber login');
update public.barbers set status='active' where id='fb101000-0000-4000-8000-000000000301';
select ok((select availability_approved_at is not null from public.barbers where id='fb101000-0000-4000-8000-000000000301'),'manager-approved hours saved');
select is(public.set_barber_auto_confirm('fb101000-0000-4000-8000-000000000301',false)->>'auto_confirm_bookings','false','manager turns auto-confirm off');
select throws_ok($$select public.set_barber_auto_confirm('fb101000-0000-4000-8000-000000000399',false)$$,'42501','NOT_AUTHORIZED','unknown profile denied');
select throws_ok($$update public.barbers set management_mode='account' where id='fb101000-0000-4000-8000-000000000301'$$,'42501','NOT_AUTHORIZED','manager cannot attach an account by direct update');
reset role;
select set_config('request.jwt.claims','{"sub":"fb101000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fb101000-0000-4000-8000-000000000012","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select throws_ok($$select public.create_managed_barber('fb101000-0000-4000-8000-000000000101','{"name":"Wrong manager"}')$$,'42501','NOT_AUTHORIZED','other manager cannot add a managed barber');
select throws_ok($$select public.set_barber_auto_confirm('fb101000-0000-4000-8000-000000000301',true)$$,'42501','NOT_AUTHORIZED','other manager cannot change preference');
select throws_ok($$select public.barber_availability('get','{"barber_id":"fb101000-0000-4000-8000-000000000301"}')$$,'42501','NOT_AUTHORIZED','other manager cannot manage schedule');
reset role;
select set_config('request.jwt.claims','{"sub":"fb101000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"fb101000-0000-4000-8000-000000000013","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$update public.barbers set name='Admin changed' where id='fb101000-0000-4000-8000-000000000301'$$,'42501','NOT_AUTHORIZED','admin cannot manage this profile');
select throws_ok($$select public.set_barber_auto_confirm('fb101000-0000-4000-8000-000000000301',true)$$,'42501','NOT_AUTHORIZED','admin cannot change managed preference');
select is(public.can_write_avatar_object('barbers/fb101000-0000-4000-8000-000000000301-123.png'),false,'admin cannot replace managed profile photo');
reset role;
select set_config('request.jwt.claims',current_setting('managed.owner'),true);
select public.manage_shop_publication('fb101000-0000-4000-8000-000000000101','publish','draft');
select set_config('request.jwt.claims','{}',true);
select set_config('managed.day',((clock_timestamp() at time zone 'Asia/Kuwait')::date+2)::text,true);

select public.configure_customer_checkout_policy('standard');
select is(public.customer_checkout_policy(),'standard','standard policy can be restored');
select is(public.configure_customer_checkout_policy('email_only'),'email_only','operator can pause requirement');
select ok(not has_function_privilege('anon','public.configure_customer_checkout_policy(text)','EXECUTE'),'anonymous cannot change policy');
select ok(not has_function_privilege('authenticated','public.customer_checkout_policy()','EXECUTE'),'policy RPC is service-only');
select throws_ok($$select public.configure_customer_checkout_policy('anything')$$,'P0001','INVALID_REQUEST','unknown mode rejected');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
 ('fb121000-0000-4000-8000-000000000001','policy@example.test',now(),'{"role":"customer"}'),
 ('fb121000-0000-4000-8000-000000000002','unverified@example.test',null,'{"role":"customer"}');
insert into auth.sessions(id,user_id) values
 ('fb121000-0000-4000-8000-000000000011','fb121000-0000-4000-8000-000000000001'),
 ('fb121000-0000-4000-8000-000000000012','fb121000-0000-4000-8000-000000000002');
insert into public.customers(id,name,email,phone,country_code,created_by_type) values
 ('fb121000-0000-4000-8000-000000000101','Policy Customer','policy@example.test',null,'+965','customer'),
 ('fb121000-0000-4000-8000-000000000102','Unverified Customer','unverified@example.test',null,'+965','customer');
insert into private.customer_accounts(user_id,customer_id) values
 ('fb121000-0000-4000-8000-000000000001','fb121000-0000-4000-8000-000000000101'),
 ('fb121000-0000-4000-8000-000000000002','fb121000-0000-4000-8000-000000000102');
select set_config('policy.book',jsonb_build_object('id','fb121000-0000-4000-8000-000000000501','branch_id','fb101000-0000-4000-8000-000000000101','barber_id','fb101000-0000-4000-8000-000000000301','service_ids',jsonb_build_array('fb101000-0000-4000-8000-000000000201'),'date',current_setting('managed.day'),'time','10:00','name','Policy Customer','country_code','+965','phone','','account_user_id','fb121000-0000-4000-8000-000000000001','session_id','fb121000-0000-4000-8000-000000000011','expected_price',3,'expected_duration',30)::text,true);
set local role service_role;
select lives_ok($$select public.native_customer_booking('book',current_setting('policy.book')::jsonb)$$,'verified email books with no phone');
reset role;
select is((select customer_id::text from public.bookings where id='fb121000-0000-4000-8000-000000000501'),'fb121000-0000-4000-8000-000000000101','account canonical record reused');
select is((select account_user_id::text from private.customer_booking_owners where booking_id='fb121000-0000-4000-8000-000000000501'),'fb121000-0000-4000-8000-000000000001','live account owns booking');
select is((select count(*) from private.customer_phone_verifications where customer_id='fb121000-0000-4000-8000-000000000101'),0::bigint,'phone is not marked verified');
select is(private.customer_booking_email_message('fb121000-0000-4000-8000-000000000501')->>'email','policy@example.test','email uses verified Auth address');
select lives_ok($$select public.native_customer_booking('book',current_setting('policy.book')::jsonb)$$,'same native attempt returns committed booking');
select is((select count(*) from public.bookings where id='fb121000-0000-4000-8000-000000000501'),1::bigint,'retry never duplicates');
select throws_ok($$select public.native_customer_booking('book',current_setting('policy.book')::jsonb||'{"id":"fb121000-0000-4000-8000-000000000502","time":"11:00","expected_price":99}')$$,'P0001','PRICE_CHANGED','native price contract retained');
select throws_ok($$select public.native_customer_booking('book',current_setting('policy.book')::jsonb||'{"id":"fb121000-0000-4000-8000-000000000502","time":"11:00","session_id":"fb121000-0000-4000-8000-000000000012"}')$$,'P0001','AUTH_REQUIRED','foreign live session cannot bind owner');
select throws_ok($$select public.native_customer_booking('book',current_setting('policy.book')::jsonb||'{"id":"fb121000-0000-4000-8000-000000000502","time":"11:00","account_user_id":"fb121000-0000-4000-8000-000000000002","session_id":"fb121000-0000-4000-8000-000000000012"}')$$,'P0001','AUTH_REQUIRED','unverified account rejected');
select public.configure_customer_checkout_policy('standard');
select throws_ok($$select public.native_customer_booking('book',current_setting('policy.book')::jsonb||'{"id":"fb121000-0000-4000-8000-000000000502","time":"11:00"}')$$,'P0001','INVALID_REQUEST','restoring standard requires phone again');
select public.configure_customer_checkout_policy('email_only');
set local role service_role;
select lives_ok($$select public.native_customer_booking('book',(current_setting('policy.book')::jsonb-'account_user_id'-'session_id')||'{"id":"fb121000-0000-4000-8000-000000000503","time":"12:00","guest_contact":"email","email":"policy@example.test"}')$$,'guest may supply existing email as contact only');
reset role;
select is((select count(*) from private.customer_booking_owners where booking_id='fb121000-0000-4000-8000-000000000503'),0::bigint,'guest email does not link account');
select lives_ok($$select public.customer_claim_booking('fb121000-0000-4000-8000-000000000503','fb121000-0000-4000-8000-000000000001','fb121000-0000-4000-8000-000000000011')$$,'matching verified account can explicitly claim receipt');
select is((select customer_id::text from public.bookings where id='fb121000-0000-4000-8000-000000000503'),'fb121000-0000-4000-8000-000000000101','claim references same canonical customer');
select * from finish();
rollback;
