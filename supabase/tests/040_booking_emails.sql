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
select set_config('email.book',jsonb_build_object('id','fb101000-0000-4000-8000-000000000501','branch_id','fb101000-0000-4000-8000-000000000101','barber_id','fb101000-0000-4000-8000-000000000301','service_ids',jsonb_build_array('fb101000-0000-4000-8000-000000000201'),'date',current_setting('managed.day'),'time','10:00','name','Email Guest','guest_contact','email','email','guest@example.test','country_code','+965','phone','','language','ar')::text,true);
select is(public.customer_booking('book',current_setting('email.book')::jsonb)->>'status','pending','email guest books without a phone');
select ok((select c.email='guest@example.test' and c.phone is null from public.bookings b join public.customers c on c.id=b.customer_id where b.id='fb101000-0000-4000-8000-000000000501'),'email stored on canonical contact; absent phone stays null');
select is((select count(*)from private.customer_booking_owners where booking_id='fb101000-0000-4000-8000-000000000501'),0::bigint,'unverified email never attaches an account');
select is((select kind from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'),'received','pending booking gets request-received email');
select is((select language from private.customer_booking_email_context where booking_id='fb101000-0000-4000-8000-000000000501'),'ar','selected email language preserved');
select is(public.customer_booking('book',current_setting('email.book')::jsonb)->>'id','fb101000-0000-4000-8000-000000000501','guest request retry keeps original booking');
select is((select count(*)from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'),1::bigint,'retry creates no duplicate email');
select throws_ok($$select public.customer_booking('book',current_setting('email.book')::jsonb||'{"id":"fb101000-0000-4000-8000-000000000502","email":"bad"}')$$,'P0001','INVALID_REQUEST','SQL rejects malformed required email');
select throws_ok($$select public.customer_booking('book',current_setting('email.book')::jsonb||'{"id":"fb101000-0000-4000-8000-000000000502","email":null}')$$,'P0001','INVALID_REQUEST','SQL requires email');
select set_config('email.claim',public.customer_booking_email_claim()::text,true);
select ok((select state='sending'and message->>'email'='guest@example.test'from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'),'worker leases private recipient once');
select is(jsonb_array_length(public.customer_booking_email_claim()),0,'parallel claim cannot take live lease');
select ok((select public.customer_booking_email_validate(id,lease_id)from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'),'current lease validates');
select is((select public.customer_booking_email_validate(id,gen_random_uuid())from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'),false,'wrong lease denied');
select ok((select public.customer_booking_email_finish(id,lease_id,503,'')from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'),'uncertain send retries through durable job');
select ok((select state='pending'and attempts=1 and message is not null from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'),'frozen payload retained after uncertainty');
select set_config('email.frozen',(select message::text from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'),true);
update private.customer_booking_email_jobs set available_at=now()where booking_id='fb101000-0000-4000-8000-000000000501';
select public.customer_booking_email_claim();
select is((select message::text from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'),current_setting('email.frozen'),'retry uses same payload and idempotency key');
select ok((select public.customer_booking_email_finish(id,lease_id,200,'synthetic-capture')from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'),'accepted send marked sent');
select is(jsonb_array_length(public.customer_booking_email_claim()),0,'sent email never requeued');
update public.bookings set status='confirmed'where id='fb101000-0000-4000-8000-000000000501';
select is((select count(*)from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'and kind='confirmed'),1::bigint,'manager confirmation gets distinct email');
update public.bookings set notes='No email for internal note'where id='fb101000-0000-4000-8000-000000000501';
select is((select count(*)from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'),2::bigint,'note-only edits do not email');
update public.bookings set time='11:00'where id='fb101000-0000-4000-8000-000000000501';
select is((select count(*)from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'and kind='rescheduled'),1::bigint,'reschedule gets one email');
select public.customer_booking_email_claim();
select is((select state from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'and kind='confirmed'),'cancelled','superseded unsent confirmation suppressed');
select is((select message->>'time'from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'and kind='rescheduled'),'11:00','reschedule shows new time');
select set_config('request.jwt.claims',current_setting('managed.owner'),true);
update public.bookings set status='cancelled',staff_cancellation='{"reason":"Customer asked to cancel"}'where id='fb101000-0000-4000-8000-000000000501';
select set_config('request.jwt.claims','{}',true);
select public.customer_booking_email_claim();
select is((select kind from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'and state='sending'),'cancelled','cancellation suppresses old in-flight update');
select ok((select message->>'cancellationReason'is not null from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'and kind='cancelled'),'shop cancellation includes reason');
select ok(not has_function_privilege('anon','public.customer_booking_email_claim(integer)','EXECUTE'),'anonymous cannot read outbox');
select ok(not has_function_privilege('authenticated','public.customer_booking_email_configuration()','EXECUTE'),'customer cannot read dispatcher secret');
select ok(not has_function_privilege('authenticated','public.configure_customer_booking_email(boolean,text,text)','EXECUTE'),'staff cannot activate email delivery');
select ok((select relrowsecurity from pg_class where oid='private.customer_booking_email_jobs'::regclass),'private jobs use RLS');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values
 ('fb101000-0000-4000-8000-000000000007','guest@example.test',now(),'{"role":"customer"}'),
 ('fb101000-0000-4000-8000-000000000008','different@example.test',now(),'{"role":"customer"}');
insert into auth.sessions(id,user_id)values
 ('fb101000-0000-4000-8000-000000000017','fb101000-0000-4000-8000-000000000007'),
 ('fb101000-0000-4000-8000-000000000018','fb101000-0000-4000-8000-000000000008');
insert into public.customers(id,name,email,phone,country_code,created_by_type)values
 ('fb101000-0000-4000-8000-000000000907','Signed Customer','guest@example.test','59977669','+965','customer'),
 ('fb101000-0000-4000-8000-000000000908','Other Customer','different@example.test',null,'+965','customer');
insert into private.customer_accounts(user_id,customer_id)values
 ('fb101000-0000-4000-8000-000000000007','fb101000-0000-4000-8000-000000000907'),
 ('fb101000-0000-4000-8000-000000000008','fb101000-0000-4000-8000-000000000908');
select throws_ok($$select public.customer_claim_booking('fb101000-0000-4000-8000-000000000501','fb101000-0000-4000-8000-000000000008','fb101000-0000-4000-8000-000000000018')$$,'P0001','INVALID_REQUEST','another email cannot claim receipt');
select lives_ok($$select public.customer_claim_booking('fb101000-0000-4000-8000-000000000501','fb101000-0000-4000-8000-000000000007','fb101000-0000-4000-8000-000000000017')$$,'matching verified email and explicit receipt can claim exact booking');
select is((select customer_id::text from public.bookings where id='fb101000-0000-4000-8000-000000000501'),'fb101000-0000-4000-8000-000000000907','claimed appointment references canonical signed-in profile');
select is((select phone from public.customers where id='fb101000-0000-4000-8000-000000000907'),'59977669','claim does not overwrite saved phone with guest contact');
select lives_ok($$select public.customer_booking('book',current_setting('email.book')::jsonb||'{"id":"fb101000-0000-4000-8000-000000000502","time":"12:00"}')$$,'existing account email may be entered as guest');
select ok((select customer_id<>'fb101000-0000-4000-8000-000000000907'from public.bookings where id='fb101000-0000-4000-8000-000000000502'),'unverified email does not reuse existing account profile');
select is((select count(*)from private.customer_booking_owners where booking_id='fb101000-0000-4000-8000-000000000502'),0::bigint,'second guest booking never automatically linked by email');
select lives_ok($$select public.customer_booking('book',current_setting('email.book')::jsonb||'{"id":"fb101000-0000-4000-8000-000000000503","time":"13:00","email":"optional@example.test","phone":"59977668"}')$$,'optional valid phone accepted without verification');
select is((select count(*)from private.customer_phone_verifications v join public.bookings b on b.customer_id=v.customer_id where b.id='fb101000-0000-4000-8000-000000000503'),0::bigint,'unverified optional phone has no verification marker');
select throws_ok($$select public.customer_booking('book',current_setting('email.book')::jsonb||'{"id":"fb101000-0000-4000-8000-000000000504","time":"14:00","phone":"59977669"}')$$,'23505','duplicate key value violates unique constraint "customers_phone_unique"','optional phone cannot steal an existing account contact');
select public.customer_booking_email_claim();
update private.customer_booking_email_jobs set message=jsonb_set(message,'{email}','"changed@example.test"')where booking_id='fb101000-0000-4000-8000-000000000502';
select is((select private.customer_booking_email_allowed(id)from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000502'),false,'changed recipient cannot reuse frozen delivery identity');
update private.customer_booking_email_jobs set expires_at=now()-interval '1 second'where booking_id='fb101000-0000-4000-8000-000000000503';
select public.customer_booking_email_claim();
select is((select state from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000503'),'cancelled','expired message never sent');
update private.customer_booking_email_runtime set enabled=false;
select is((select private.customer_booking_email_allowed(id)from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000501'and kind='cancelled'),false,'pause disables delivery immediately');
select lives_ok($$select public.customer_booking('book',current_setting('email.book')::jsonb||'{"id":"fb101000-0000-4000-8000-000000000504","time":"14:00"}')$$,'booking still works while email is disabled');
select is((select count(*)from private.customer_booking_email_jobs where booking_id='fb101000-0000-4000-8000-000000000504'),0::bigint,'disabled period never queues historical mail');
select * from finish();
rollback;
