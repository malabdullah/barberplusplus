begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='private.booking_write_locks'::regclass),'schedule mutex has RLS');
select ok(not has_table_privilege('anon','private.booking_write_locks','SELECT,INSERT,UPDATE,DELETE'),'anonymous cannot access schedule mutex');
select ok(not has_table_privilege('authenticated','private.booking_write_locks','SELECT,INSERT,UPDATE,DELETE'),'customers and staff cannot access schedule mutex');
select ok(not has_function_privilege('service_role','private.guard_booking_schedule()','EXECUTE'),'trigger function cannot be called as an RPC');
-- Simulate a historical pair in this rolled-back fixture transaction only.
alter table public.bookings disable trigger guard_bookings_against_new_overlaps;
insert into public.bookings(id,branch_id,barber_id,notes,date,time,duration,status)
values ('bbbbbbbb-1111-4000-8000-000000000001','10000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000121','Historical one','2035-01-01','10:00',30,'confirmed'),
('bbbbbbbb-1111-4000-8000-000000000002','10000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000121','Historical two','2035-01-01','10:15',30,'confirmed');
alter table public.bookings enable trigger guard_bookings_against_new_overlaps;
select is((select count(*) from public.bookings where id in ('bbbbbbbb-1111-4000-8000-000000000001','bbbbbbbb-1111-4000-8000-000000000002')),2::bigint,'both historical appointments are preserved');
select lives_ok($$update public.bookings set status='completed' where id='bbbbbbbb-1111-4000-8000-000000000001'$$,'historical status can change without rewriting its schedule');
select throws_like($$insert into public.bookings(branch_id,barber_id,notes,date,time,duration,status) values ('10000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000121','New collision','2035-01-01','10:20',30,'confirmed')$$,'%Booking conflict%','new booking cannot overlap a historical reservation');
select throws_like($$update public.bookings set time='10:05' where id='bbbbbbbb-1111-4000-8000-000000000002'$$,'%Booking conflict%','moving an existing booking cannot create an overlap');
select lives_ok($$update public.bookings set time='10:30' where id='bbbbbbbb-1111-4000-8000-000000000002'$$,'adjacent appointment can move out of a historical overlap');
select lives_ok($$insert into public.bookings(branch_id,barber_id,notes,date,time,duration,status) values ('10000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000121','Cancelled collision','2035-01-01','10:20',30,'cancelled')$$,'cancelled records do not block the schedule');
select throws_like($$update public.bookings set status='confirmed' where notes='Cancelled collision' and date='2035-01-01'$$,'%Booking conflict%','reactivating a cancelled record must check conflicts');
select * from finish();
rollback;
