begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
select ok(has_function_privilege('service_role','private.service_duration(uuid,uuid,integer)','EXECUTE'),'trusted gateway can resolve durations');
select ok(not has_function_privilege('authenticated','private.service_duration(uuid,uuid,integer)','EXECUTE'),'clients cannot call private duration helper');
-- Fixture-only setting; restored by the transaction rollback.
update private.billing_enforcement set enabled=false;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('bd220000-0000-4000-8000-000000000001','duration-manager@example.test',now(),'{"role":"manager"}','{}'),
 ('bd220000-0000-4000-8000-000000000002','duration-barber@example.test',now(),'{"role":"barber"}','{}'),
 ('bd220000-0000-4000-8000-000000000003','duration-outsider@example.test',now(),'{"role":"manager"}','{}');
insert into auth.sessions(id,user_id,created_at,updated_at) values ('bd220000-0000-4000-8000-000000000101','bd220000-0000-4000-8000-000000000001',now(),now());
insert into public.branches(id,manager_id,name) values ('bd220000-0000-4000-8000-000000000010','bd220000-0000-4000-8000-000000000001','Duration fixture');
insert into public.services(id,branch_id,name,duration,price) values
 ('bd220000-0000-4000-8000-000000000020','bd220000-0000-4000-8000-000000000010','Haircut',30,3);
insert into public.barbers(id,user_id,branch_id,name,status,service_ids,availability) values
 ('bd220000-0000-4000-8000-000000000030','bd220000-0000-4000-8000-000000000002','bd220000-0000-4000-8000-000000000010','Duration barber','inactive','{bd220000-0000-4000-8000-000000000020}','{}');
insert into public.barbers(id,branch_id,name,status,service_ids,availability,management_mode) values
 ('bd220000-0000-4000-8000-000000000031','bd220000-0000-4000-8000-000000000010','Managed duration barber','inactive','{bd220000-0000-4000-8000-000000000020}','{}','managed');
select ok(not has_function_privilege('anon','public.set_barber_service_duration(uuid,uuid,integer)','EXECUTE'),'guest cannot edit durations');
select set_config('request.jwt.claims','{"sub":"bd220000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select is(public.set_barber_service_duration('bd220000-0000-4000-8000-000000000030','bd220000-0000-4000-8000-000000000020',45)->>'bd220000-0000-4000-8000-000000000020','45','barber saves own duration');
select is(private.service_duration('bd220000-0000-4000-8000-000000000030','bd220000-0000-4000-8000-000000000020',30),45,'effective duration uses override');
select is((select duration from public.services where id='bd220000-0000-4000-8000-000000000020'),30,'shop duration unchanged');
select is((select price from public.services where id='bd220000-0000-4000-8000-000000000020'),3::numeric,'price unchanged');
select throws_ok($$select public.set_barber_service_duration('bd220000-0000-4000-8000-000000000030','bd220000-0000-4000-8000-000000000020',4)$$,'P0001','INVALID_SERVICE_DURATION','reject too short');
select throws_ok($$select public.set_barber_service_duration('bd220000-0000-4000-8000-000000000030','bd220000-0000-4000-8000-000000000020',481)$$,'P0001','INVALID_SERVICE_DURATION','reject too long');
select throws_ok($$select public.set_barber_service_duration('bd220000-0000-4000-8000-000000000030',null,30)$$,'P0001','INVALID_SERVICE_ASSIGNMENT','reject missing service');
select throws_ok($$select public.set_barber_service_duration('bd220000-0000-4000-8000-000000000031','bd220000-0000-4000-8000-000000000020',45)$$,'42501','NOT_AUTHORIZED','barber cannot edit managed barber');
select throws_ok($$update public.barbers set service_ids='{}' where id='bd220000-0000-4000-8000-000000000030'$$,'42501','NOT_AUTHORIZED','barber cannot change service assignments');
select is(public.set_barber_service_duration('bd220000-0000-4000-8000-000000000030','bd220000-0000-4000-8000-000000000020',null),'{}'::jsonb,'reset removes override');
select is(private.service_duration('bd220000-0000-4000-8000-000000000030','bd220000-0000-4000-8000-000000000020',30),30,'reset restores default');
select set_config('request.jwt.claims','{"sub":"bd220000-0000-4000-8000-000000000001","session_id":"bd220000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal1"}',true);
select lives_ok($$select public.set_barber_service_duration('bd220000-0000-4000-8000-000000000031','bd220000-0000-4000-8000-000000000020',50)$$,'manager edits managed barber');
select lives_ok($$select public.set_barber_service_duration('bd220000-0000-4000-8000-000000000030','bd220000-0000-4000-8000-000000000020',40)$$,'manager edits own shop barber');
select set_config('request.jwt.claims','{"sub":"bd220000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select public.set_barber_service_duration('bd220000-0000-4000-8000-000000000030','bd220000-0000-4000-8000-000000000020',60)$$,'42501','NOT_AUTHORIZED','other manager rejected');
select set_config('request.jwt.claims','{}',true);
insert into public.bookings(id,branch_id,barber_id,service_ids,date,time,duration,price,status) values
('bd220000-0000-4000-8000-000000000040','bd220000-0000-4000-8000-000000000010','bd220000-0000-4000-8000-000000000030','{bd220000-0000-4000-8000-000000000020}','2000-01-01','10:00',40,3,'completed');
select set_config('request.jwt.claims','{"sub":"bd220000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select public.set_barber_service_duration('bd220000-0000-4000-8000-000000000030','bd220000-0000-4000-8000-000000000020',45);
select is((select duration from public.bookings where id='bd220000-0000-4000-8000-000000000040'),40,'existing appointment keeps booked duration');
select is((select service_snapshot->0->>'duration' from public.bookings where id='bd220000-0000-4000-8000-000000000040'),'40','existing service snapshot unchanged');
select set_config('request.jwt.claims','{}',true);
insert into public.bookings(id,branch_id,barber_id,service_ids,date,time,duration,price,status) values
('bd220000-0000-4000-8000-000000000041','bd220000-0000-4000-8000-000000000010','bd220000-0000-4000-8000-000000000030','{bd220000-0000-4000-8000-000000000020}','2000-01-01','11:00',45,3,'completed');
select is((select service_snapshot->0->>'duration' from public.bookings where id='bd220000-0000-4000-8000-000000000041'),'45','new booking captures personal duration');
select is((select price from public.bookings where id='bd220000-0000-4000-8000-000000000041'),3::numeric,'new booking retains shop price');
select * from finish();
rollback;
