begin;
-- These legacy authorization fixtures represent already-published shops.
alter table public.branches alter column publication_state set default 'published';
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(36);
insert into auth.users(id,email,raw_app_meta_data) values
('ee020000-0000-4000-8000-000000000001','reminder-admin@example.test','{"role":"admin"}'),
('ee020000-0000-4000-8000-000000000002','reminder-manager@example.test','{"role":"manager"}'),
('ee020000-0000-4000-8000-000000000003','reminder-agent@example.test','{"role":"agent"}'),
('ee020000-0000-4000-8000-000000000004','reminder-barber@example.test','{"role":"barber"}'),
('ee020000-0000-4000-8000-000000000005','reminder-other@example.test','{"role":"manager"}');
insert into public.branches(id,manager_id,name,working_hours)
select v.id::uuid,v.manager::uuid,'Reminder fixture',jsonb_object_agg(day,'{"open":"09:00","close":"18:00"}'::jsonb)
from (values('ee020100-0000-4000-8000-000000000001','ee020000-0000-4000-8000-000000000002'),('ee020100-0000-4000-8000-000000000002','ee020000-0000-4000-8000-000000000005')) v(id,manager)
cross join unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day group by v.id,v.manager;
insert into public.services(id,branch_id,name,duration,price) values('ee020200-0000-4000-8000-000000000001','ee020100-0000-4000-8000-000000000001','Reminder haircut',30,3),('ee020200-0000-4000-8000-000000000002','ee020100-0000-4000-8000-000000000002','Other haircut',30,3);
insert into public.barbers(id,branch_id,user_id,name,service_ids,availability)
select v.id::uuid,v.shop::uuid,v.person::uuid,'Reminder barber',array[v.service::uuid],jsonb_object_agg(day,'{"enabled":true,"start":"09:00","end":"18:00"}'::jsonb)
from (values('ee020300-0000-4000-8000-000000000001','ee020100-0000-4000-8000-000000000001','ee020000-0000-4000-8000-000000000004','ee020200-0000-4000-8000-000000000001'),('ee020300-0000-4000-8000-000000000002','ee020100-0000-4000-8000-000000000002',null,'ee020200-0000-4000-8000-000000000002')) v(id,shop,person,service)
cross join unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day group by v.id,v.shop,v.person,v.service;
insert into public.customers(id,name,country_code,phone) values('ee020400-0000-4000-8000-000000000001','Reminder Customer','+965','59979620');

select ok((select not rolcanlogin and not rolsuper and not rolbypassrls
  and not rolcreaterole and not rolcreatedb and not rolreplication
  from pg_roles where rolname = 'barber_reminder_writer'), 'writer cannot log in, bypass RLS or administer roles');
select ok(not exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
  where m.roleid = 'barber_reminder_writer'::regrole and r.rolname in ('anon', 'authenticated', 'authenticator', 'service_role')), 'no API role may assume the writer');
select ok(not has_schema_privilege('barber_reminder_writer', 'private', 'CREATE'), 'writer cannot create schema objects');
select ok(not has_table_privilege('barber_reminder_writer', 'public.bookings', 'SELECT'), 'writer cannot read/bypass bookings');
select ok(not has_table_privilege('barber_reminder_writer', 'public.booking_reminders', 'DELETE'), 'writer cannot delete reminders');
select ok(not has_column_privilege('barber_reminder_writer', 'public.booking_reminders', 'error_message', 'UPDATE'), 'writer cannot change delivery/error fields');
select ok(not has_function_privilege('authenticated', 'private.maintain_booking_reminder()', 'EXECUTE'), 'browser cannot execute internal function');
select ok(not has_function_privilege('anon', 'private.maintain_booking_reminder()', 'EXECUTE'), 'anonymous role cannot execute internal function');
select ok((select prosecdef and proowner = 'barber_reminder_writer'::regrole and 'search_path=""' = any(proconfig)
  from pg_proc where oid = 'private.maintain_booking_reminder()'::regprocedure), 'private trigger uses restricted owner and empty search path');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ee020000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}', true);
select throws_ok('select * from public.booking_reminders', '42501');
select throws_ok($$insert into public.booking_reminders (booking_id, scheduled_at) values ('50000000-0000-4000-8000-000000000001', now())$$, '42501');
select throws_ok($$update public.booking_reminders set status = 'cancelled'$$, '42501');
select throws_ok($$select private.maintain_booking_reminder()$$, '42501');
select ok(not pg_has_role('authenticated', 'barber_reminder_writer', 'MEMBER'), 'browser has no writer role membership');
select lives_ok($$insert into public.bookings (id, branch_id, barber_id, date, time, status, customer_id, service_ids, duration, price)
  values ('61000000-0000-4000-8000-000000000001', 'ee020100-0000-4000-8000-000000000001', 'ee020300-0000-4000-8000-000000000001', current_date + 3, '12:30', 'confirmed','ee020400-0000-4000-8000-000000000001',array['ee020200-0000-4000-8000-000000000001']::uuid[],30,3)$$, 'manager creates a future booking without direct reminder access');
reset role;
select is((select count(*) from public.booking_reminders where booking_id = '61000000-0000-4000-8000-000000000001'), 0::bigint, 'booking creates no WhatsApp reminder');
select ok(not exists (select 1 from pg_trigger where tgrelid = 'public.bookings'::regclass and tgname = 'create_reminder_on_booking'), 'reminder creation trigger is absent');
insert into public.booking_reminders (booking_id, scheduled_at)
values ('61000000-0000-4000-8000-000000000001', now() + interval '1 day');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ee020000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}', true);
select lives_ok($$update public.bookings set notes = 'synthetic modification' where id = '61000000-0000-4000-8000-000000000001'$$, 'manager modifies own booking');
select lives_ok($$update public.bookings set status = 'cancelled', staff_cancellation='{"reason":"Synthetic fixture cancellation"}' where id = '61000000-0000-4000-8000-000000000001'$$, 'manager cancels own booking');
select lives_ok($$update public.bookings set status = 'cancelled', staff_cancellation='{"reason":"Synthetic fixture cancellation"}' where id = '61000000-0000-4000-8000-000000000001'$$, 'repeat cancellation is harmless');
select throws_ok($$insert into public.bookings (branch_id, barber_id, date, time, status, customer_id, service_ids, duration, price)
  values ('ee020100-0000-4000-8000-000000000002', 'ee020300-0000-4000-8000-000000000002', current_date + 4, '12:30', 'confirmed','ee020400-0000-4000-8000-000000000001',array['ee020200-0000-4000-8000-000000000002']::uuid[],30,3)$$, '42501');
reset role;
select ok(not exists (select 1 from pg_trigger where tgrelid = 'public.bookings'::regclass and tgname = 'cancel_reminder_on_booking_cancel'), 'reminder cancellation trigger is absent');
select is((select status from public.booking_reminders where booking_id = '61000000-0000-4000-8000-000000000001'), 'pending', 'an existing historical reminder is not modified by cancellation');

insert into private.shop_booking_policies(branch_id,barber_can_cancel) values('ee020100-0000-4000-8000-000000000001',true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ee020000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"role":"barber"}}', true);
select lives_ok($$insert into public.bookings (id, branch_id, barber_id, date, time, status, customer_id, service_ids, duration, price)
  values ('61000000-0000-4000-8000-000000000002', 'ee020100-0000-4000-8000-000000000001', 'ee020300-0000-4000-8000-000000000001', current_date + 4, '12:30', 'confirmed','ee020400-0000-4000-8000-000000000001',array['ee020200-0000-4000-8000-000000000001']::uuid[],30,3)$$, 'barber creates an authorized branch booking');
select lives_ok($$update public.bookings set status = 'cancelled', staff_cancellation='{"reason":"Synthetic fixture cancellation"}' where id = '61000000-0000-4000-8000-000000000002'$$, 'barber cancels own booking');
select throws_ok('select * from public.booking_reminders', '42501');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ee020000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"role":"agent"}}', true);
select lives_ok($$insert into public.bookings (id, branch_id, barber_id, date, time, status, customer_id, service_ids, duration, price)
  values ('61000000-0000-4000-8000-000000000003', 'ee020100-0000-4000-8000-000000000001', 'ee020300-0000-4000-8000-000000000001', current_date + 5, '12:30', 'confirmed','ee020400-0000-4000-8000-000000000001',array['ee020200-0000-4000-8000-000000000001']::uuid[],30,3)$$, 'trusted agent retains existing booking authorization');
select lives_ok($$update public.bookings set status = 'cancelled', staff_cancellation='{"reason":"Synthetic fixture cancellation"}' where id = '61000000-0000-4000-8000-000000000003'$$, 'trusted agent cancels booking');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ee020000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}', true);
select lives_ok($$insert into public.bookings (id, branch_id, barber_id, date, time, status, customer_id, service_ids, duration, price)
  values ('61000000-0000-4000-8000-000000000004', 'ee020100-0000-4000-8000-000000000001', 'ee020300-0000-4000-8000-000000000001', current_date + 6, '12:30', 'confirmed','ee020400-0000-4000-8000-000000000001',array['ee020200-0000-4000-8000-000000000001']::uuid[],30,3)$$, 'admin retains existing booking authorization');
select lives_ok($$update public.bookings set status = 'cancelled', staff_cancellation='{"reason":"Synthetic fixture cancellation"}' where id = '61000000-0000-4000-8000-000000000004'$$, 'admin cancels booking');
reset role;
select is((select count(*) from public.booking_reminders where booking_id::text like '61000000-%'), 1::bigint, 'only the explicitly inserted historical reminder exists');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$insert into public.bookings (branch_id, barber_id, date, time, status, customer_id, service_ids, duration, price)
  values ('ee020100-0000-4000-8000-000000000001', 'ee020300-0000-4000-8000-000000000001', current_date + 7, '12:30', 'confirmed','ee020400-0000-4000-8000-000000000001',array['ee020200-0000-4000-8000-000000000001']::uuid[],30,3)$$, '42501');
select throws_ok('select * from public.booking_reminders', '42501');
reset role;

grant usage on schema extensions to barber_reminder_writer;
set local role barber_reminder_writer;
select is((select count(booking_id) from public.booking_reminders), 0::bigint, 'even writer sees no reminder rows outside trigger context');
select throws_ok($$insert into public.booking_reminders (booking_id, scheduled_at) values ('50000000-0000-4000-8000-000000000001', now())$$, '42501');
reset role;
select ok(not exists (select 1 from public.booking_reminders r join public.bookings b on b.id = r.booking_id
  where b.id::text like '61000000-%' and b.id <> '61000000-0000-4000-8000-000000000001'), 'no new reminders were created for other role journeys');

select * from finish();
rollback;
