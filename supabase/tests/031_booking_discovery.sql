begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('fa160000-0000-4000-8000-000000000001','discovery-manager@example.test',now(),'{"role":"manager"}'),
('fa160000-0000-4000-8000-000000000002','discovery-barber@example.test',now(),'{"role":"barber"}');
insert into auth.sessions(id,user_id) values
('fa160000-0000-4000-8000-000000000011','fa160000-0000-4000-8000-000000000001'),
('fa160000-0000-4000-8000-000000000012','fa160000-0000-4000-8000-000000000002');
insert into public.branches(id,name,manager_id,city,governorate_id,area_id,image_url) values
('fa160000-0000-4000-8000-000000000101','Discovery QA Shop','fa160000-0000-4000-8000-000000000001','Discovery QA City',9001,9001,'/booking-demo/market-street.png');
insert into public.services(id,branch_id,name,duration,price) values
('fa160000-0000-4000-8000-000000000201','fa160000-0000-4000-8000-000000000101','Discovery QA Cut',30,3),
('fa160000-0000-4000-8000-000000000202','fa160000-0000-4000-8000-000000000101','Discovery QA Long',60,5);
insert into public.barbers(id,branch_id,user_id,name,invite_status,service_ids,availability,time_offs) values
('fa160000-0000-4000-8000-000000000301','fa160000-0000-4000-8000-000000000101','fa160000-0000-4000-8000-000000000002','Discovery QA Barber','accepted',
 array['fa160000-0000-4000-8000-000000000201','fa160000-0000-4000-8000-000000000202']::uuid[],
 '{"monday":{"enabled":true,"start":"09:10","end":"13:00"}}',
 '[{"type":"recurring","day":"monday","start":"10:00","end":"10:30"}]');
select set_config('request.jwt.claims','{"sub":"fa160000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa160000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
select public.manage_shop_publication('fa160000-0000-4000-8000-000000000101','publish','draft');
select set_config('request.jwt.claims','{}',true);
select set_config('discovery.day',(((current_timestamp at time zone 'Asia/Kuwait')::date)+(8-extract(isodow from current_timestamp at time zone 'Asia/Kuwait')::int))::text,true);
select set_config('discovery.input',jsonb_build_object('mode','time','city','Discovery QA City','barber_id','fa160000-0000-4000-8000-000000000301','date',current_setting('discovery.day'),'range_start','12:25','range_end','12:25')::text,true);
select ok(not has_function_privilege('anon','public.customer_booking_discovery(text,jsonb)','EXECUTE'),'anon cannot bypass the Edge gateway');
select ok(not has_function_privilege('authenticated','private.booking_start_windows(uuid,date,time,time,uuid)','EXECUTE'),'raw schedules stay private');
select is(jsonb_array_length(public.customer_booking_discovery('search',current_setting('discovery.input')::jsonb)->'items'),1,'a start inside the range may finish after the range');
select is((public.customer_booking_discovery('selection',current_setting('discovery.input')::jsonb)->>'maxDuration')::int,35,'service fit uses the remaining working window');
select is(jsonb_array_length(public.customer_booking_discovery('search',current_setting('discovery.input')::jsonb||'{"range_start":"12:40","range_end":"12:40"}')->'items'),0,'a start with no assigned service fitting is excluded');
select is(jsonb_array_length(public.customer_booking_discovery('search',current_setting('discovery.input')::jsonb||'{"range_start":"09:40","range_end":"10:25"}')->'items'),0,'recurring breaks exclude overlapping service starts');
select is(jsonb_array_length(public.customer_booking_discovery('search',current_setting('discovery.input')::jsonb||'{"range_start":"09:25","range_end":"09:25"}')->'items'),1,'grid remains anchored to the later opening, not clock quarters');
select throws_ok($$select public.customer_booking_discovery('search',current_setting('discovery.input')::jsonb||'{"range_start":"18:00","range_end":"09:00"}')$$,'P0001','INVALID_DATE','reversed ranges rejected');
select throws_ok($$select public.customer_booking_discovery('selection',current_setting('discovery.input')::jsonb||'{"account_user_id":"fa160000-0000-4000-8000-000000000002","session_id":"fa160000-0000-4000-8000-000000000012"}')$$,'P0001','INVALID_SELECTION','a barber cannot select their own chair');
select throws_ok($$select public.customer_booking_discovery('search',current_setting('discovery.input')::jsonb||'{"cursor":{"rank":0,"name":"wrong","id":"fa160000-0000-4000-8000-000000000301","context":"forged"}}')$$,'P0001','INVALID_REQUEST','pagination cursor is bound to the filter context');
select set_config('discovery.book',jsonb_build_object('id',gen_random_uuid(),'branch_id','fa160000-0000-4000-8000-000000000101','barber_id','fa160000-0000-4000-8000-000000000301','service_ids',jsonb_build_array('fa160000-0000-4000-8000-000000000201'),'date',current_setting('discovery.day'),'time','10:40','name','Discovery QA Customer','country_code','+965','phone','59978631')::text,true);
select lives_ok($$select public.customer_booking('book',current_setting('discovery.book')::jsonb)$$,'existing atomic checkout accepts a free grid start');
select is(jsonb_array_length(public.customer_booking_discovery('search',current_setting('discovery.input')::jsonb||'{"range_start":"10:40","range_end":"10:40"}')->'items'),0,'existing bookings disappear from discovery immediately');
select throws_ok($$select public.customer_booking('book',current_setting('discovery.book')::jsonb||jsonb_build_object('id',gen_random_uuid()))$$,'P0001','SLOT_UNAVAILABLE','competing checkout cannot take the same start');
select is((public.customer_booking('appointment-slots',current_setting('discovery.book')::jsonb||jsonb_build_object('booked_duration',30,'booked_price',3,'exclude_booking_id',current_setting('discovery.book')::jsonb->>'id'))->'slots') ? '10:40',true,'reschedule excludes its own booking');
select is((public.customer_booking('slots',current_setting('discovery.book')::jsonb)->'slots') ? '11:10',true,'a start exactly at the previous booking end is free');
update public.barbers set vacations=jsonb_build_array(jsonb_build_object('startDate',current_setting('discovery.day'),'endDate',current_setting('discovery.day'))) where id='fa160000-0000-4000-8000-000000000301';
select is(jsonb_array_length(public.customer_booking_discovery('search',current_setting('discovery.input')::jsonb)->'items'),0,'inclusive vacation dates are excluded');
update public.barbers set vacations='[]' where id='fa160000-0000-4000-8000-000000000301';
select set_config('request.jwt.claims','{"sub":"fa160000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa160000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
select public.manage_shop_publication('fa160000-0000-4000-8000-000000000101','pause','published');
select set_config('request.jwt.claims','{}',true);
select is(jsonb_array_length(public.customer_booking_discovery('search','{"mode":"shop","city":"Discovery QA City"}')->'items'),0,'paused shops disappear from all entry paths');
select throws_ok($$select public.customer_booking_discovery('selection',current_setting('discovery.input')::jsonb)$$,'P0001','INVALID_SELECTION','stale selection cannot bypass publication');
select * from finish();
rollback;
