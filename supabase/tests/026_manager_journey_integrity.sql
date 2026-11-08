begin;
-- These legacy authorization fixtures represent already-published shops.
alter table public.branches alter column publication_state set default 'published';
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
 ('ee070000-0000-4000-8000-000000000001','journey-manager@example.test','{"role":"manager"}'),
 ('ee070000-0000-4000-8000-000000000002','journey-other@example.test','{"role":"manager"}'),
 ('ee070000-0000-4000-8000-000000000003','journey-customer@example.test','{"role":"customer"}');
insert into public.branches(id,manager_id,name,working_hours) values
 ('ee070000-0000-4000-8000-000000000101','ee070000-0000-4000-8000-000000000001','Journey Shop',
 '{"monday":{"open":"09:00","close":"18:00"},"tuesday":{"open":"09:00","close":"18:00"},"wednesday":{"open":"09:00","close":"18:00"},"thursday":{"open":"09:00","close":"18:00"},"friday":{"open":"09:00","close":"18:00"},"saturday":{"open":"09:00","close":"18:00"},"sunday":{"open":"09:00","close":"18:00"}}');
insert into public.services(id,branch_id,name,duration,price) values
 ('ee070000-0000-4000-8000-000000000201','ee070000-0000-4000-8000-000000000101','Original haircut',30,3.125);
insert into public.barbers(id,branch_id,name,status,service_ids,availability) values
 ('ee070000-0000-4000-8000-000000000301','ee070000-0000-4000-8000-000000000101','Journey Barber','active',array['ee070000-0000-4000-8000-000000000201']::uuid[],
 '{"monday":{"enabled":true,"start":"09:00","end":"18:00"},"tuesday":{"enabled":true,"start":"09:00","end":"18:00"},"wednesday":{"enabled":true,"start":"09:00","end":"18:00"},"thursday":{"enabled":true,"start":"09:00","end":"18:00"},"friday":{"enabled":true,"start":"09:00","end":"18:00"},"saturday":{"enabled":true,"start":"09:00","end":"18:00"},"sunday":{"enabled":true,"start":"09:00","end":"18:00"}}');
select set_config('request.jwt.claims','{"sub":"ee070000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"manager"}}',true);
select set_config('journey.input',jsonb_build_object('branch_id','ee070000-0000-4000-8000-000000000101','barber_id','ee070000-0000-4000-8000-000000000301','service_ids',jsonb_build_array('ee070000-0000-4000-8000-000000000201'),
 'customer_name','Journey Customer','customer_country_code','+965','customer_phone','59979701','date',((clock_timestamp() at time zone 'Asia/Kuwait')::date+2)::text,'time','10:00')::text,true);
set local role authenticated;
select set_config('journey.saved',public.staff_save_booking(null,current_setting('journey.input')::jsonb)::text,true);
select is(current_setting('journey.saved')::jsonb->'customer'->>'name','Journey Customer','manager save retains customer details');
select is((current_setting('journey.saved')::jsonb->>'price')::numeric,3.125::numeric,'all three KWD decimals persist');
select is(current_setting('journey.saved')::jsonb->'service_snapshot'->0->>'name','Original haircut','historical service line is captured');
select is((public.staff_customer_lookup('+965','59979701')->>'id')::uuid,(current_setting('journey.saved')::jsonb->>'customer_id')::uuid,'exact lookup resolves canonical ID');
select throws_ok($$select public.staff_save_booking(null,current_setting('journey.input')::jsonb||'{"time":"04:00","customer_phone":"59979702"}')$$,'P0001','SLOT_UNAVAILABLE','invalid slot rolls back contact and appointment together');
select throws_ok($$insert into public.services(branch_id,name,duration,price) values('ee070000-0000-4000-8000-000000000101','Bad',0,-1)$$,'P0001','INVALID_SERVICE','invalid service is rejected at write boundary');
select throws_ok($$update public.bookings set status='completed' where id=(current_setting('journey.saved')::jsonb->>'id')::uuid$$,'P0001','BOOKING_NOT_FINISHED','future appointment cannot be completed');
select throws_ok($$delete from public.services where id='ee070000-0000-4000-8000-000000000201'$$,'P0001','SERVICE_HAS_HISTORY','hard deletion cannot destroy service history');
select lives_ok($$select public.archive_service('ee070000-0000-4000-8000-000000000201')$$,'used service can be archived');
update public.services set name='Renamed haircut' where id='ee070000-0000-4000-8000-000000000201';
select is((select service_snapshot->0->>'name' from public.bookings where id=(current_setting('journey.saved')::jsonb->>'id')::uuid),'Original haircut','renaming catalogue does not rename booked service');
select lives_ok($$select public.staff_save_booking((current_setting('journey.saved')::jsonb->>'id')::uuid,current_setting('journey.input')::jsonb||'{"time":"11:00"}')$$,'existing appointment can move without losing an archived service');
select throws_ok($$select public.staff_save_booking(null,current_setting('journey.input')::jsonb||'{"time":"12:00"}')$$,'P0001','INVALID_SERVICE_ASSIGNMENT','archived service is not offered for a new appointment');
reset role;
select is((select count(*) from public.customers where phone='59979702'),0::bigint,'failed transaction left no orphan customer');
select set_config('request.jwt.claims','{"sub":"ee070000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select is((select count(*) from public.customers where id=(current_setting('journey.saved')::jsonb->>'customer_id')::uuid),0::bigint,'unrelated manager cannot read customer contact');
select throws_ok($$select public.staff_save_booking(null,current_setting('journey.input')::jsonb)$$,'42501','NOT_AUTHORIZED','other manager cannot create appointment in this shop');
reset role;
select set_config('request.jwt.claims','{"sub":"ee070000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"role":"customer"}}',true);
set local role authenticated;
select throws_like($$insert into public.branches(manager_id,name) values('ee070000-0000-4000-8000-000000000003','Forbidden')$$,'%row-level security%','customer cannot create a manager shop');
select throws_ok($$select public.staff_customer_lookup('+965','59979701')$$,'42501','NOT_AUTHORIZED','customer cannot call staff lookup');
select throws_ok($$select public.archive_service('ee070000-0000-4000-8000-000000000201')$$,'42501','NOT_AUTHORIZED','customer cannot archive any staff service');
reset role;
select * from finish();
rollback;
