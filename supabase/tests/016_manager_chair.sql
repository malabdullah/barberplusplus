begin;
-- These legacy authorization fixtures represent already-published shops.
alter table public.branches alter column publication_state set default 'published';
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();

insert into auth.users(id,email,raw_app_meta_data) values
('cc030000-0000-4000-8000-000000000001','chair-manager@example.test','{"role":"manager"}'),
('cc030000-0000-4000-8000-000000000002','chair-other-manager@example.test','{"role":"manager"}');
insert into public.branches(id,manager_id,name,status) values
('cc030000-0000-4000-8000-000000000101','cc030000-0000-4000-8000-000000000001','Chair Fixture Shop','active'),
('cc030000-0000-4000-8000-000000000102','cc030000-0000-4000-8000-000000000002','Unrelated Chair Shop','active');
insert into public.services(id,branch_id,name,duration,price,status) values
('cc030000-0000-4000-8000-000000000201','cc030000-0000-4000-8000-000000000101','Haircut',30,5,'active');

select set_config('request.jwt.claims','{"sub":"cc030000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select throws_ok($$
insert into public.barbers(user_id,branch_id,name,manager_chair,status) values
('cc030000-0000-4000-8000-000000000001','cc030000-0000-4000-8000-000000000102','Out of scope',true,'inactive')
$$,'42501','CHAIR_SHOP_NOT_ALLOWED','manager cannot open a chair in another manager’s shop');
select throws_ok($$
insert into public.barbers(user_id,branch_id,name,manager_chair,status) values
('cc030000-0000-4000-8000-000000000002','cc030000-0000-4000-8000-000000000101','Other person',true,'inactive')
$$,'42501','CHAIR_SHOP_NOT_ALLOWED','manager cannot link another account');
insert into public.barbers(id,user_id,branch_id,name,manager_chair,status,availability) values
('cc030000-0000-4000-8000-000000000301','cc030000-0000-4000-8000-000000000001','cc030000-0000-4000-8000-000000000101','Manager Chair',true,'inactive','{}');
select throws_like($$
insert into public.barbers(user_id,branch_id,name,manager_chair,status) values
('cc030000-0000-4000-8000-000000000001','cc030000-0000-4000-8000-000000000101','Second chair',true,'inactive')
$$,'%barbers_one_manager_chair%','one chair per account');
select ok(not public.is_barber() and public.get_barber_branch_id() is null,'chair does not give separate barber permissions');
select throws_ok($$
update public.barbers set status='active' where id='cc030000-0000-4000-8000-000000000301'
$$,'P0001','CHAIR_SERVICES_REQUIRED','opening requires an active service');
update public.barbers set service_ids=array['cc030000-0000-4000-8000-000000000201']::uuid[]
where id='cc030000-0000-4000-8000-000000000301';
select throws_ok($$
update public.barbers set status='active' where id='cc030000-0000-4000-8000-000000000301'
$$,'P0001','CHAIR_HOURS_REQUIRED','opening requires working hours');
update public.barbers set status='active',availability='{"monday":{"enabled":true,"start":"09:00","end":"17:00"}}'
where id='cc030000-0000-4000-8000-000000000301';
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.customers(id,name,country_code,phone) values('cc030000-0000-4000-8000-000000000501','Chair Customer','+965','59979621');
insert into public.bookings(id,branch_id,barber_id,date,time,status,added_by_type) values
('cc030000-0000-4000-8000-000000000401','cc030000-0000-4000-8000-000000000101','cc030000-0000-4000-8000-000000000301','2035-06-04','10:00','confirmed','customer'),
('cc030000-0000-4000-8000-000000000402','cc030000-0000-4000-8000-000000000101','cc030000-0000-4000-8000-000000000301','2020-06-01','10:00','confirmed','customer');
select is((select count(*) from public.notifications where entity_id='cc030000-0000-4000-8000-000000000401'),1::bigint,'the manager receives one alert for their own chair');
select set_config('request.jwt.claims','{"sub":"cc030000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
update public.barbers set status='inactive' where id='cc030000-0000-4000-8000-000000000301';
select is((select count(*) from public.bookings where barber_id='cc030000-0000-4000-8000-000000000301'),2::bigint,'upcoming and past bookings stay visible after closing');
select throws_ok($$
insert into public.bookings(branch_id,barber_id,date,time,status,added_by_type,customer_id,service_ids,duration,price) values
('cc030000-0000-4000-8000-000000000101','cc030000-0000-4000-8000-000000000301','2035-06-04','12:00','confirmed','manager','cc030000-0000-4000-8000-000000000501',array['cc030000-0000-4000-8000-000000000201']::uuid[],30,5)
$$,'P0001','SLOT_UNAVAILABLE','even a direct booking write cannot book an inactive chair');
select lives_ok($$update public.bookings set status='completed' where id='cc030000-0000-4000-8000-000000000402'$$,'existing appointments can still be completed');
select throws_ok($$delete from public.barbers where id='cc030000-0000-4000-8000-000000000301'$$,
'P0001','CHAIR_HISTORY_PROTECTED','deleting the chair cannot cascade into booking history');
update public.barbers set status='active' where id='cc030000-0000-4000-8000-000000000301';
select is((select status from public.barbers where id='cc030000-0000-4000-8000-000000000301'),'active','same chair reopens');
reset role;
select set_config('request.jwt.claims','{"sub":"cc030000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select is((select count(*) from public.bookings where barber_id='cc030000-0000-4000-8000-000000000301'),0::bigint,'another manager cannot see the chair history');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.branches set manager_id='cc030000-0000-4000-8000-000000000002' where id='cc030000-0000-4000-8000-000000000101';
select is((select status from public.barbers where id='cc030000-0000-4000-8000-000000000301'),'inactive','shop ownership transfer closes the former manager’s chair');
select * from finish();
rollback;
