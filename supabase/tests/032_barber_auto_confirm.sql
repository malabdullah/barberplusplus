begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('fa170000-0000-4000-8000-000000000001','confirmation-manager@example.test',now(),'{"role":"manager"}'),
('fa170000-0000-4000-8000-000000000002','confirmation-barber@example.test',now(),'{"role":"barber"}');
insert into auth.sessions(id,user_id) values
('fa170000-0000-4000-8000-000000000011','fa170000-0000-4000-8000-000000000001'),
('fa170000-0000-4000-8000-000000000012','fa170000-0000-4000-8000-000000000002');
insert into public.branches(id,name,manager_id,city,governorate_id,area_id,image_url) values
('fa170000-0000-4000-8000-000000000101','Confirmation QA Shop','fa170000-0000-4000-8000-000000000001','Confirmation QA City',9001,9001,'/booking-demo/market-street.png');
insert into public.services(id,branch_id,name,duration,price) values
('fa170000-0000-4000-8000-000000000201','fa170000-0000-4000-8000-000000000101','Confirmation QA Cut',30,3),
('fa170000-0000-4000-8000-000000000202','fa170000-0000-4000-8000-000000000101','Confirmation QA Long',60,5);
insert into public.barbers(id,branch_id,user_id,name,invite_status,service_ids,availability,time_offs) values
('fa170000-0000-4000-8000-000000000301','fa170000-0000-4000-8000-000000000101','fa170000-0000-4000-8000-000000000002','Confirmation QA Barber','accepted',
 array['fa170000-0000-4000-8000-000000000201','fa170000-0000-4000-8000-000000000202']::uuid[],
 '{"monday":{"enabled":true,"start":"09:10","end":"13:00"}}',
 '[{"type":"recurring","day":"monday","start":"10:00","end":"10:30"}]');
select set_config('request.jwt.claims','{"sub":"fa170000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa170000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
select public.manage_shop_publication('fa170000-0000-4000-8000-000000000101','publish','draft');
select set_config('request.jwt.claims','{}',true);
select set_config('discovery.day',(((current_timestamp at time zone 'Asia/Kuwait')::date)+(8-extract(isodow from current_timestamp at time zone 'Asia/Kuwait')::int))::text,true);

select ok((select auto_confirm_bookings from public.barbers where id='fa170000-0000-4000-8000-000000000301'),'existing behavior defaults on');
select ok(not has_function_privilege('anon','public.set_barber_auto_confirm(uuid,boolean)','EXECUTE'),'anonymous cannot toggle');
select ok(not has_function_privilege('service_role','public.confirm_pending_booking(uuid)','EXECUTE'),'confirmation is a staff-session action');
select set_config('request.jwt.claims','{"sub":"fa170000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa170000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
select throws_ok($$select public.set_barber_auto_confirm('fa170000-0000-4000-8000-000000000301',false)$$,'42501','NOT_AUTHORIZED','manager cannot change another barber preference');
select throws_ok($$update public.barbers set auto_confirm_bookings=false where id='fa170000-0000-4000-8000-000000000301'$$,'42501','NOT_AUTHORIZED','direct writes cannot bypass preference ownership');
select set_config('request.jwt.claims','{"sub":"fa170000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fa170000-0000-4000-8000-000000000012","app_metadata":{"role":"barber"}}',true);
select is(public.set_barber_auto_confirm('fa170000-0000-4000-8000-000000000301',false)->>'auto_confirm_bookings','false','barber turns off');
select throws_ok($$select public.set_barber_auto_confirm('fa170000-0000-4000-8000-000000000301',null)$$,'P0001','INVALID_REQUEST','null preference rejected');
select throws_ok($$select public.set_barber_auto_confirm('fa170000-0000-4000-8000-000000000399',false)$$,'42501','NOT_AUTHORIZED','unknown barber denied');
select set_config('request.jwt.claims','{}',true);
select set_config('confirmation.book',jsonb_build_object('id','fa170000-0000-4000-8000-000000000501','branch_id','fa170000-0000-4000-8000-000000000101','barber_id','fa170000-0000-4000-8000-000000000301','service_ids',jsonb_build_array('fa170000-0000-4000-8000-000000000201'),'date',current_setting('discovery.day'),'time','10:40','name','Confirmation QA Customer','country_code','+965','phone','59978632','status','confirmed')::text,true);
select is(public.customer_booking('slots',current_setting('confirmation.book')::jsonb)->>'confirmation_required','true','customer sees confirmation requirement before submission');
select is(public.customer_booking('book',current_setting('confirmation.book')::jsonb)->>'status','pending','client cannot force confirmed status');
select is((public.customer_booking('slots',current_setting('confirmation.book')::jsonb)->'slots') ? '10:40',false,'pending booking reserves the slot');
select throws_ok($$select public.customer_booking('book',current_setting('confirmation.book')::jsonb||jsonb_build_object('id',gen_random_uuid()))$$,'P0001','SLOT_UNAVAILABLE','competing booking cannot take pending slot');
select set_config('request.jwt.claims','{"sub":"fa170000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fa170000-0000-4000-8000-000000000012","app_metadata":{"role":"barber"}}',true);
select is(public.set_barber_auto_confirm('fa170000-0000-4000-8000-000000000301',true)->>'auto_confirm_bookings','true','barber turns on');
select is((select status from public.bookings where id='fa170000-0000-4000-8000-000000000501'),'pending','toggle does not retroactively confirm');
select set_config('request.jwt.claims','{}',true);
select is(public.customer_booking('book',current_setting('confirmation.book')::jsonb)->>'status','pending','idempotent retry preserves original status after toggle');
select is(public.customer_booking('book',current_setting('confirmation.book')::jsonb||'{"id":"fa170000-0000-4000-8000-000000000502","time":"11:10"}')->>'status','confirmed','later booking is automatic');
select set_config('request.jwt.claims','{"sub":"fa170000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fa170000-0000-4000-8000-000000000012","app_metadata":{"role":"barber"}}',true);
select is(public.confirm_pending_booking('fa170000-0000-4000-8000-000000000501')->>'status','confirmed','barber confirms own pending booking');
select throws_ok($$select public.confirm_pending_booking('fa170000-0000-4000-8000-000000000501')$$,'P0001','BOOKING_NOT_PENDING','repeat confirmation cannot mutate confirmed booking');

select public.set_barber_auto_confirm('fa170000-0000-4000-8000-000000000301',false);
select set_config('request.jwt.claims','{}',true);
select public.customer_booking('book',current_setting('confirmation.book')::jsonb||'{"id":"fa170000-0000-4000-8000-000000000503","time":"11:40"}');
select set_config('request.jwt.claims','{"sub":"fa170000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa170000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
select is(public.confirm_pending_booking('fa170000-0000-4000-8000-000000000503')->>'status','confirmed','shop manager confirms a pending request');
select throws_ok($$select public.confirm_pending_booking('fa170000-0000-4000-8000-000000000599')$$,'42501','NOT_AUTHORIZED','unknown booking denied');

select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claims','{"sub":"fa170000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa170000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
insert into public.barbers(id,user_id,branch_id,name,manager_chair,status,invite_status) values('fa170000-0000-4000-8000-000000000302','fa170000-0000-4000-8000-000000000001','fa170000-0000-4000-8000-000000000101','Confirmation QA Manager Chair',true,'inactive','accepted');
select set_config('request.jwt.claims','{"sub":"fa170000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa170000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
select is(public.set_barber_auto_confirm('fa170000-0000-4000-8000-000000000302',false)->>'auto_confirm_bookings','false','manager chair has its own setting');
select throws_ok($$select public.confirm_pending_booking('fa170000-0000-4000-8000-000000000503')$$,'P0001','BOOKING_NOT_PENDING','manager cannot reconfirm a resolved request');
select set_config('request.jwt.claims','{"sub":"fa170000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fa170000-0000-4000-8000-000000000099"}',true);
select throws_ok($$select public.set_barber_auto_confirm('fa170000-0000-4000-8000-000000000301',true)$$,'42501','NOT_AUTHORIZED','a revoked or missing session cannot change settings');
select * from finish();
rollback;
