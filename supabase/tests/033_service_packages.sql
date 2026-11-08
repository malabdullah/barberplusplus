begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('fa180000-0000-4000-8000-000000000001','packages-manager@example.test',now(),'{"role":"manager"}'),
('fa180000-0000-4000-8000-000000000002','packages-barber@example.test',now(),'{"role":"barber"}'),
('fa180000-0000-4000-8000-000000000003','packages-other@example.test',now(),'{"role":"manager"}'),
('fa180000-0000-4000-8000-000000000004','packages-customer@example.test',now(),'{"role":"customer"}');
insert into auth.sessions(id,user_id) select ('fa180000-0000-4000-8000-00000000001'||n)::uuid,('fa180000-0000-4000-8000-00000000000'||n)::uuid from generate_series(1,4)n;
select set_config('packages.owner','{"user_id":"fa180000-0000-4000-8000-000000000004","session_id":"fa180000-0000-4000-8000-000000000014","name":"Packages Customer"}',true);
select public.customer_account_api('email-ensure',current_setting('packages.owner')::jsonb);
select set_config('packages.today',((clock_timestamp() at time zone 'Asia/Kuwait')::date)::text,true);
select set_config('packages.day',((clock_timestamp() at time zone 'Asia/Kuwait')::date+1)::text,true);
insert into public.branches(id,name,manager_id,city,governorate_id,area_id,image_url,working_hours)
select 'fa180000-0000-4000-8000-000000000101','Package QA Shop','fa180000-0000-4000-8000-000000000001','Package QA City',9001,9001,'/booking-demo/market-street.png',jsonb_object_agg(day,'{"open":"09:00","close":"20:00","closed":false}'::jsonb)
from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])day;
insert into public.services(id,branch_id,name,duration,price) values
('fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000101','QA Haircut',30,5),
('fa180000-0000-4000-8000-000000000202','fa180000-0000-4000-8000-000000000101','QA Beard',20,3),
('fa180000-0000-4000-8000-000000000203','fa180000-0000-4000-8000-000000000101','QA Facial',40,7),
('fa180000-0000-4000-8000-000000000204','fa180000-0000-4000-8000-000000000101','QA Wash',15,2);
insert into public.barbers(id,branch_id,user_id,name,service_ids,availability,invite_status)
select ('fa180000-0000-4000-8000-00000000030'||n)::uuid,'fa180000-0000-4000-8000-000000000101',case when n=1 then 'fa180000-0000-4000-8000-000000000002'::uuid end,'Package QA Barber '||n,
case when n=1 then array['fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000202','fa180000-0000-4000-8000-000000000203','fa180000-0000-4000-8000-000000000204']::uuid[] else array['fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000202']::uuid[] end,
(select jsonb_object_agg(day,'{"start":"09:00","end":"20:00","enabled":true}'::jsonb) from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])day),'accepted' from generate_series(1,2)n;
select set_config('packages.manager','{"sub":"fa180000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa180000-0000-4000-8000-000000000011"}',true);
select set_config('request.jwt.claims',current_setting('packages.manager'),true);
select public.manage_shop_publication('fa180000-0000-4000-8000-000000000101','publish','draft');
select set_config('packages.data',jsonb_build_object('name','QA Grooming','name_ar','باقة تجريبية','service_ids',jsonb_build_array('fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000202','fa180000-0000-4000-8000-000000000203'),'price',10,'starts_on',current_setting('packages.today'),'ends_on',current_setting('packages.today')::date+6)::text,true);
select set_config('packages.saved',public.manage_service_packages('save','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb)::text,true);
select set_config('packages.package',(current_setting('packages.saved')::jsonb->>'id'),true);
select set_config('packages.offer',(current_setting('packages.saved')::jsonb->>'offer_id'),true);
select is(public.manage_service_packages('list','fa180000-0000-4000-8000-000000000101')->>'total','1','manager sees the package');
select is(jsonb_array_length(public.customer_package_catalog('fa180000-0000-4000-8000-000000000101','fa180000-0000-4000-8000-000000000301')),1,'qualified barber offers the package');
select is(jsonb_array_length(public.customer_package_catalog('fa180000-0000-4000-8000-000000000101','fa180000-0000-4000-8000-000000000302')),0,'barber missing facial cannot offer package');
select ok(not has_function_privilege('anon','public.manage_service_packages(text,uuid,jsonb)','EXECUTE'),'anonymous cannot manage');
select ok(not has_function_privilege('authenticated','public.customer_package_catalog(uuid,uuid,date)','EXECUTE'),'public catalogue is gateway-only');
select ok(not has_table_privilege('authenticated','private.package_offers','UPDATE'),'direct offer writes denied');
select throws_ok($$select public.manage_service_packages('save','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb||'{"price":0}')$$,'P0001','INVALID_PACKAGE','zero price rejected');
select throws_ok($$select public.manage_service_packages('save','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb||'{"price":16}')$$,'P0001','INVALID_PACKAGE','price above separate services rejected');
select throws_ok($$select public.manage_service_packages('save','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb||'{"service_ids":["fa180000-0000-4000-8000-000000000201","fa180000-0000-4000-8000-000000000201"]}')$$,'P0001','INVALID_PACKAGE','duplicate package service rejected');
select throws_ok($$select public.manage_service_packages('republish','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb||current_setting('packages.saved')::jsonb)$$,'P0001','PACKAGE_PERIOD_OVERLAP','republishing overlapping period rejected');
select set_config('request.jwt.claims','{"sub":"fa180000-0000-4000-8000-000000000003","role":"authenticated","session_id":"fa180000-0000-4000-8000-000000000013"}',true);
select throws_ok($$select public.manage_service_packages('list','fa180000-0000-4000-8000-000000000101')$$,'42501','NOT_AUTHORIZED','other manager cannot list shop packages');
select throws_ok($$select public.manage_service_packages('pause','fa180000-0000-4000-8000-000000000101',current_setting('packages.saved')::jsonb)$$,'42501','NOT_AUTHORIZED','other manager cannot pause offer');
select set_config('request.jwt.claims','{}',true);
select set_config('packages.book',jsonb_build_object('id','fa180000-0000-4000-8000-000000000501','branch_id','fa180000-0000-4000-8000-000000000101','barber_id','fa180000-0000-4000-8000-000000000301','package_offer_id',current_setting('packages.offer'),'service_ids',jsonb_build_array('fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000202','fa180000-0000-4000-8000-000000000203','fa180000-0000-4000-8000-000000000204'),'date',current_setting('packages.day'),'time','09:00','name','Package QA Guest','country_code','+965','phone','56988701','package_quote',jsonb_build_object('price',12,'duration',105))::text,true);
select is(public.customer_booking('slots',current_setting('packages.book')::jsonb)->>'price','12.000','package plus wash costs 12 KWD');
select is(public.customer_booking('slots',current_setting('packages.book')::jsonb)->>'duration','105','full package and extra duration');
select throws_ok($$select public.customer_booking('book',current_setting('packages.book')::jsonb||'{"package_quote":{"price":1,"duration":105}}')$$,'P0001','PACKAGE_CHANGED','forged quote rejected');
select throws_ok($$select public.customer_booking('slots',current_setting('packages.book')::jsonb||'{"service_ids":["fa180000-0000-4000-8000-000000000201","fa180000-0000-4000-8000-000000000202"]}')$$,'P0001','INVALID_PACKAGE_SELECTION','cannot omit included service');
select is(public.customer_booking('book',current_setting('packages.book')::jsonb)->>'price','12.000','booking commits agreed price');
insert into private.customer_booking_owners(booking_id,account_user_id) values('fa180000-0000-4000-8000-000000000501','fa180000-0000-4000-8000-000000000004');
select is((select package_snapshot->>'name' from public.bookings where id='fa180000-0000-4000-8000-000000000501'),'QA Grooming','booking stores package name');
select is((select jsonb_array_length(service_snapshot) from public.bookings where id='fa180000-0000-4000-8000-000000000501'),4,'component history includes extras');
select throws_ok($$select public.customer_booking('book',current_setting('packages.book')::jsonb||'{"id":"fa180000-0000-4000-8000-000000000502","time":"10:30"}')$$,'P0001','SLOT_UNAVAILABLE','entire duration reserves slot');
select set_config('packages.move',jsonb_build_object('booking_id','fa180000-0000-4000-8000-000000000501','expected_date',current_setting('packages.day'),'expected_time','09:00','date',current_setting('packages.today')::date+7,'time','09:00')::text,true);
select throws_ok($$select public.customer_account_api('reschedule-booking',current_setting('packages.owner')::jsonb||current_setting('packages.move')::jsonb)$$,'P0001','PACKAGE_DATE_UNAVAILABLE','customer cannot reschedule outside original offer');
select is((select date from public.bookings where id='fa180000-0000-4000-8000-000000000501'),current_setting('packages.day')::date,'invalid move preserves original date');
select set_config('request.jwt.claims',current_setting('packages.manager'),true);
select public.manage_service_packages('extend','fa180000-0000-4000-8000-000000000101',current_setting('packages.saved')::jsonb||jsonb_build_object('ends_on',current_setting('packages.today')::date+13));
select public.manage_service_packages('save','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb||current_setting('packages.saved')::jsonb||jsonb_build_object('price',9,'name','Updated QA Grooming','ends_on',current_setting('packages.today')::date+13));
select is((select price from public.bookings where id='fa180000-0000-4000-8000-000000000501'),12.000::numeric,'offer price edit leaves booked total intact');
select is((select package_snapshot->>'name' from public.bookings where id='fa180000-0000-4000-8000-000000000501'),'QA Grooming','offer rename preserves booked name');
select set_config('request.jwt.claims','{}',true);
select is(public.customer_account_api('reschedule-booking',current_setting('packages.owner')::jsonb||current_setting('packages.move')::jsonb)->>'date',(current_setting('packages.today')::date+7)::text,'extension permits old booking to reschedule');
select is((select price from public.bookings where id='fa180000-0000-4000-8000-000000000501'),12.000::numeric,'extended booking retains original price');
select is(public.customer_booking('book',current_setting('packages.book')::jsonb)->>'price','12.000','idempotent retry retains original terms');
select throws_ok($$select public.customer_booking('book',current_setting('packages.book')::jsonb||'{"id":"fa180000-0000-4000-8000-000000000503","time":"14:00"}')$$,'P0001','PACKAGE_CHANGED','stale price requires new consent');
select is(public.customer_booking('book',current_setting('packages.book')::jsonb||'{"id":"fa180000-0000-4000-8000-000000000503","time":"14:00","package_quote":{"price":11,"duration":105}}')->>'price','11.000','new booking uses new offer price');
select set_config('request.jwt.claims',current_setting('packages.manager'),true);
select public.manage_service_packages('pause','fa180000-0000-4000-8000-000000000101',current_setting('packages.saved')::jsonb);
select is(jsonb_array_length(public.customer_package_catalog('fa180000-0000-4000-8000-000000000101','fa180000-0000-4000-8000-000000000301')),0,'paused offer hidden');
select public.manage_service_packages('resume','fa180000-0000-4000-8000-000000000101',current_setting('packages.saved')::jsonb);
select is(jsonb_array_length(public.customer_package_catalog('fa180000-0000-4000-8000-000000000101','fa180000-0000-4000-8000-000000000301')),1,'resumed offer available');
select set_config('packages.new',public.manage_service_packages('republish','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb||jsonb_build_object('id',current_setting('packages.package'),'price',8,'starts_on',current_setting('packages.today')::date+14,'ends_on',current_setting('packages.today')::date+20))::text,true);
select isnt(current_setting('packages.new')::jsonb->>'offer_id',current_setting('packages.offer'),'republish makes distinct period');
select is((select package_offer_id::text from public.bookings where id='fa180000-0000-4000-8000-000000000501'),current_setting('packages.offer'),'older booking remains linked to older period');
select is(jsonb_array_length(public.customer_package_catalog('fa180000-0000-4000-8000-000000000101','fa180000-0000-4000-8000-000000000301',current_setting('packages.today')::date+15)),0,'future promotion hidden until its start');
select throws_ok($$select public.manage_service_packages('extend','fa180000-0000-4000-8000-000000000101',current_setting('packages.saved')::jsonb||jsonb_build_object('ends_on',current_setting('packages.today')::date+15))$$,'P0001','PACKAGE_PERIOD_OVERLAP','extension cannot overlap scheduled promotion');
select throws_ok($$select public.manage_service_packages('extend','fa180000-0000-4000-8000-000000000101',current_setting('packages.saved')::jsonb||jsonb_build_object('ends_on',current_setting('packages.today')::date+12))$$,'P0001','PACKAGE_EXTENSION_INVALID','extend cannot shorten current period');
select lives_ok($$select private.package_window(current_setting('packages.offer')::uuid,current_setting('packages.today')::date+13)$$,'end date inclusive');
select lives_ok($$select private.package_window((current_setting('packages.new')::jsonb->>'offer_id')::uuid,current_setting('packages.today')::date+14)$$,'new start date inclusive');
select set_config('request.jwt.claims','{}',true);
update public.services set price=6,duration=45 where id='fa180000-0000-4000-8000-000000000201';
select is((select duration from public.bookings where id='fa180000-0000-4000-8000-000000000501'),105,'service duration edit preserves historical booking');
select set_config('request.jwt.claims',current_setting('packages.manager'),true);
select is(public.staff_package_terms('fa180000-0000-4000-8000-000000000501')->>'ends_on',(current_setting('packages.today')::date+13)::text,'staff sees extended window with agreed terms');
select set_config('packages.staff',jsonb_build_object('branch_id','fa180000-0000-4000-8000-000000000101','barber_id','fa180000-0000-4000-8000-000000000301','customer_country_code','+965','customer_phone','56988702','customer_name','Staff Package Customer','service_ids',jsonb_build_array('fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000202','fa180000-0000-4000-8000-000000000203'),'package_offer_id',current_setting('packages.offer'),'date',current_setting('packages.day'),'time','16:00')::text,true);
select set_config('packages.staffbooking',public.staff_save_booking(null,current_setting('packages.staff')::jsonb)::text,true);
select is((current_setting('packages.staffbooking')::jsonb->>'price')::numeric,9::numeric,'manual package creation uses current offer price');
select is((current_setting('packages.staffbooking')::jsonb->>'duration')::integer,105,'manual package uses full current duration');
select is(public.staff_save_booking((current_setting('packages.staffbooking')::jsonb->>'id')::uuid,current_setting('packages.staff')::jsonb||jsonb_build_object('service_ids',jsonb_build_array('fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000202','fa180000-0000-4000-8000-000000000203','fa180000-0000-4000-8000-000000000204')))->>'price','11.000','staff can add extra without double charging package');
select throws_ok($$select public.staff_save_booking((current_setting('packages.staffbooking')::jsonb->>'id')::uuid,current_setting('packages.staff')::jsonb||jsonb_build_object('service_ids',jsonb_build_array('fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000202')))$$,'P0001','INVALID_PACKAGE_SELECTION','staff cannot remove included facial while retaining package');
select throws_ok($$select public.staff_save_booking((current_setting('packages.staffbooking')::jsonb->>'id')::uuid,current_setting('packages.staff')::jsonb||jsonb_build_object('date',current_setting('packages.today')::date+21))$$,'P0001','PACKAGE_DATE_UNAVAILABLE','staff cannot move package booking outside offer period');
select is(public.staff_save_booking((current_setting('packages.staffbooking')::jsonb->>'id')::uuid,current_setting('packages.staff')::jsonb||'{"package_offer_id":null}')->>'price','16.000','explicitly removing package charges individual service prices');
select is((select package_snapshot from public.bookings where id=(current_setting('packages.staffbooking')::jsonb->>'id')::uuid),null::jsonb,'explicit removal clears package snapshot');
select set_config('request.jwt.claims','{"sub":"fa180000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fa180000-0000-4000-8000-000000000012"}',true);
select is(jsonb_array_length(public.staff_package_catalog('fa180000-0000-4000-8000-000000000101','fa180000-0000-4000-8000-000000000301',current_setting('packages.day')::date)),1,'barber can read own eligible offers');
select throws_ok($$select public.staff_package_catalog('fa180000-0000-4000-8000-000000000101','fa180000-0000-4000-8000-000000000302')$$,'42501','NOT_AUTHORIZED','barber cannot read another chair catalogue');
select throws_ok($$select public.manage_service_packages('list','fa180000-0000-4000-8000-000000000101')$$,'42501','NOT_AUTHORIZED','barber cannot manage package prices');
select set_config('request.jwt.claims',current_setting('packages.manager'),true);
select public.manage_service_packages('archive','fa180000-0000-4000-8000-000000000101',current_setting('packages.saved')::jsonb);
select is(jsonb_array_length(public.customer_package_catalog('fa180000-0000-4000-8000-000000000101','fa180000-0000-4000-8000-000000000301')),0,'archived package hidden');
select is((select count(*) from public.bookings where package_offer_id=current_setting('packages.offer')::uuid),2::bigint,'archive retains both bookings');
select set_config('packages.republished',public.manage_service_packages('republish','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb||jsonb_build_object('id',current_setting('packages.package'),'price',8,'starts_on',current_setting('packages.today')::date+21,'ends_on',current_setting('packages.today')::date+27))::text,true);
select is(jsonb_array_length(public.customer_package_catalog('fa180000-0000-4000-8000-000000000101','fa180000-0000-4000-8000-000000000301')),0,'republishing archived package does not revive older offers');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.staff_package_terms('fa180000-0000-4000-8000-000000000501')$$,'42501','NOT_AUTHORIZED','unauthenticated staff terms denied');
select * from finish();
rollback;
