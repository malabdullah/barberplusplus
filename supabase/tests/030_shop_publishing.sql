begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
('fa150000-0000-4000-8000-000000000001','publish-manager@example.test','{"role":"manager"}'),
('fa150000-0000-4000-8000-000000000002','publish-other@example.test','{"role":"manager"}'),
('fa150000-0000-4000-8000-000000000003','publish-barber@example.test','{"role":"barber"}'),
('fa150000-0000-4000-8000-000000000004','publish-admin@example.test','{"role":"admin"}');
insert into auth.sessions(id,user_id) values
('fa150000-0000-4000-8000-000000000011','fa150000-0000-4000-8000-000000000001'),
('fa150000-0000-4000-8000-000000000012','fa150000-0000-4000-8000-000000000002'),
('fa150000-0000-4000-8000-000000000014','fa150000-0000-4000-8000-000000000004');
insert into public.branches(id,name,manager_id,governorate_id,area_id) values
('fa150000-0000-4000-8000-000000000101','Publish QA Shop','fa150000-0000-4000-8000-000000000001',9001,9001);
select is((select publication_state from public.branches where id='fa150000-0000-4000-8000-000000000101'),'draft','new shops start as draft');
select ok(not has_function_privilege('anon','public.manage_shop_publication(uuid,text,text)','EXECUTE'),'anonymous publication access is denied');
select set_config('request.jwt.claims','{"sub":"fa150000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa150000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select throws_ok($$select public.manage_shop_publication('fa150000-0000-4000-8000-000000000101','publish','draft')$$,'P0001','SHOP_NOT_READY','incomplete setup cannot publish');
select throws_ok($$update public.branches set publication_state='published' where id='fa150000-0000-4000-8000-000000000101'$$,'P0001','SHOP_NOT_READY','direct table writes cannot bypass readiness');
select throws_ok($$select public.manage_shop_publication('fa150000-0000-4000-8000-000000000101','allow-manual','draft')$$,'42501','SHOP_PERMISSION_ADMIN_ONLY','manager cannot grant manual exceptions');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.services(id,branch_id,name,duration,price) values('fa150000-0000-4000-8000-000000000201','fa150000-0000-4000-8000-000000000101','Publish QA Haircut',30,3);
insert into public.barbers(id,branch_id,user_id,name,status,invite_status,service_ids,availability) values
('fa150000-0000-4000-8000-000000000301','fa150000-0000-4000-8000-000000000101','fa150000-0000-4000-8000-000000000003','Publish QA Barber','active','accepted',array['fa150000-0000-4000-8000-000000000201']::uuid[],
'{"monday":{"enabled":true,"start":"09:00","end":"18:00"},"tuesday":{"enabled":true,"start":"09:00","end":"18:00"},"wednesday":{"enabled":true,"start":"09:00","end":"18:00"},"thursday":{"enabled":true,"start":"09:00","end":"18:00"},"friday":{"enabled":true,"start":"14:00","end":"18:00"},"saturday":{"enabled":true,"start":"09:00","end":"18:00"},"sunday":{"enabled":true,"start":"09:00","end":"18:00"}}');
select set_config('publish.input',jsonb_build_object('branch_id','fa150000-0000-4000-8000-000000000101','barber_id','fa150000-0000-4000-8000-000000000301','service_ids',jsonb_build_array('fa150000-0000-4000-8000-000000000201'),'customer_name','Publish QA Customer','customer_country_code','+965','customer_phone','59979311','date',((clock_timestamp() at time zone 'Asia/Kuwait')::date+2)::text,'time','15:00')::text,true);
select set_config('request.jwt.claims','{"sub":"fa150000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fa150000-0000-4000-8000-000000000012","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select throws_ok($$select public.manage_shop_publication('fa150000-0000-4000-8000-000000000101')$$,'42501','SHOP_PUBLICATION_FORBIDDEN','other manager cannot read publication control');
reset role;
select set_config('request.jwt.claims','{"sub":"fa150000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"manager"}}',true);
select throws_ok($$select public.manage_shop_publication('fa150000-0000-4000-8000-000000000101')$$,'42501','SHOP_PUBLICATION_FORBIDDEN','a missing live session is rejected');
select set_config('request.jwt.claims','{"sub":"fa150000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa150000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select throws_ok($$select public.staff_save_booking(null,current_setting('publish.input')::jsonb)$$,'P0001','SHOP_BOOKINGS_PAUSED','draft blocks manual reservations');
select is(public.manage_shop_publication('fa150000-0000-4000-8000-000000000101','publish','draft')->>'publication_state','published','ready shop publishes');
select set_config('publish.booking',public.staff_save_booking(null,current_setting('publish.input')::jsonb)::text,true);
select throws_ok($$update public.branches set status='inactive' where id='fa150000-0000-4000-8000-000000000101'$$,'42501','SHOP_PERMISSION_ADMIN_ONLY','manager cannot change the administrative suspension flag');
select is(public.manage_shop_publication('fa150000-0000-4000-8000-000000000101','pause','published')->>'publication_state','paused','owner can pause');
select is((select status from public.bookings where id=(current_setting('publish.booking')::jsonb->>'id')::uuid),'confirmed','pause preserves the appointment');
select throws_ok($$select public.staff_save_booking(null,current_setting('publish.input')::jsonb||'{"time":"16:00"}')$$,'P0001','SHOP_BOOKINGS_PAUSED','pause blocks manual reservations');
select throws_ok($$select public.manage_shop_publication('fa150000-0000-4000-8000-000000000101','publish','draft')$$,'P0001','SHOP_STATE_CHANGED','stale state does not overwrite a pause');
select throws_ok($$update public.branches set paused_manual_booking_allowed=true where id='fa150000-0000-4000-8000-000000000101'$$,'42501','SHOP_PERMISSION_ADMIN_ONLY','direct manager write cannot grant exceptions');
select lives_ok($$select public.staff_save_booking((current_setting('publish.booking')::jsonb->>'id')::uuid,current_setting('publish.input')::jsonb||'{"time":"15:30"}')$$,'existing appointments remain manageable during pause');
reset role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.customer_booking('slots',current_setting('publish.input')::jsonb)$$,'P0001','INVALID_SELECTION','public slots reject paused shops despite a stale catalog');
select set_config('request.jwt.claims','{"sub":"fa150000-0000-4000-8000-000000000004","role":"authenticated","session_id":"fa150000-0000-4000-8000-000000000014","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.manage_shop_publication('fa150000-0000-4000-8000-000000000101','allow-manual','paused')->>'paused_manual_booking_allowed','true','admin may grant a paused-shop manual exception');
reset role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.customer_booking('slots',current_setting('publish.input')::jsonb)$$,'P0001','INVALID_SELECTION','manual exception never enables public booking');
select set_config('request.jwt.claims','{"sub":"fa150000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa150000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select lives_ok($$select public.staff_save_booking(null,current_setting('publish.input')::jsonb||'{"time":"16:30"}')$$,'admin exception allows a manager manual reservation');
select is(public.manage_shop_publication('fa150000-0000-4000-8000-000000000101','publish','paused')->>'paused_manual_booking_allowed','false','republishing clears the pause exception');
select ok((select count(*) from public.logs where entity_id='fa150000-0000-4000-8000-000000000101' and message='Shop booking access changed')>=4,'state and permission changes are audited');
reset role;
select * from finish();
rollback;
