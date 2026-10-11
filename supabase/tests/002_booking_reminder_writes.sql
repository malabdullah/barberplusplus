begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(35);

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
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}', true);
select throws_ok('select * from public.booking_reminders', '42501');
select throws_ok($$insert into public.booking_reminders (booking_id, scheduled_at) values ('50000000-0000-4000-8000-000000000001', now())$$, '42501');
select throws_ok($$update public.booking_reminders set status = 'cancelled'$$, '42501');
select throws_ok($$select private.maintain_booking_reminder()$$, '42501');
select ok(not pg_has_role('authenticated', 'barber_reminder_writer', 'MEMBER'), 'browser has no writer role membership');
select lives_ok($$insert into public.bookings (id, branch_id, barber_id, date, time, status)
  values ('61000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', current_date + 3, '12:30', 'confirmed')$$, 'manager creates a future booking without direct reminder access');
reset role;
select is((select count(*) from public.booking_reminders where booking_id = '61000000-0000-4000-8000-000000000001'), 1::bigint, 'one internal reminder created');
select is((select scheduled_at from public.booking_reminders where booking_id = '61000000-0000-4000-8000-000000000001'),
  ((current_date + 3 + time '12:30') at time zone 'Asia/Kuwait') - interval '1 hour', 'reminder retains Kuwait-time scheduling');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}', true);
select lives_ok($$update public.bookings set notes = 'synthetic modification' where id = '61000000-0000-4000-8000-000000000001'$$, 'manager modifies own booking');
select lives_ok($$update public.bookings set status = 'cancelled' where id = '61000000-0000-4000-8000-000000000001'$$, 'manager cancels own booking');
select lives_ok($$update public.bookings set status = 'cancelled' where id = '61000000-0000-4000-8000-000000000001'$$, 'repeat cancellation is harmless');
select throws_ok($$insert into public.bookings (branch_id, barber_id, date, time, status)
  values ('10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', current_date + 4, '12:30', 'confirmed')$$, '42501');
reset role;
select is((select status from public.booking_reminders where booking_id = '61000000-0000-4000-8000-000000000001'), 'cancelled', 'internal cancellation persisted');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"role":"barber"}}', true);
select lives_ok($$insert into public.bookings (id, branch_id, barber_id, date, time, status)
  values ('61000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', current_date + 4, '12:30', 'confirmed')$$, 'barber creates an authorized branch booking');
select lives_ok($$update public.bookings set status = 'cancelled' where id = '61000000-0000-4000-8000-000000000002'$$, 'barber cancels own booking');
select throws_ok('select * from public.booking_reminders', '42501');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"role":"agent"}}', true);
select lives_ok($$insert into public.bookings (id, branch_id, barber_id, date, time, status)
  values ('61000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', current_date + 5, '12:30', 'confirmed')$$, 'trusted agent retains existing booking authorization');
select lives_ok($$update public.bookings set status = 'cancelled' where id = '61000000-0000-4000-8000-000000000003'$$, 'trusted agent cancels booking');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}', true);
select lives_ok($$insert into public.bookings (id, branch_id, barber_id, date, time, status)
  values ('61000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', current_date + 6, '12:30', 'confirmed')$$, 'admin retains existing booking authorization');
select lives_ok($$update public.bookings set status = 'cancelled' where id = '61000000-0000-4000-8000-000000000004'$$, 'admin cancels booking');
reset role;
select is((select count(*) from public.booking_reminders where booking_id::text like '61000000-%' and status = 'cancelled'), 4::bigint, 'all four role journeys cancelled only their own new reminders');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$insert into public.bookings (branch_id, barber_id, date, time, status)
  values ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', current_date + 7, '12:30', 'confirmed')$$, '42501');
select throws_ok('select * from public.booking_reminders', '42501');
reset role;

grant usage on schema extensions to barber_reminder_writer;
set local role barber_reminder_writer;
select is((select count(booking_id) from public.booking_reminders), 0::bigint, 'even writer sees no reminder rows outside trigger context');
select throws_ok($$insert into public.booking_reminders (booking_id, scheduled_at) values ('50000000-0000-4000-8000-000000000001', now())$$, '42501');
reset role;
select ok(not exists (select 1 from public.booking_reminders r join public.bookings b on b.id = r.booking_id
  where b.id::text like '61000000-%' and r.status <> 'cancelled'), 'no active test reminder left after cancellation');

select * from finish();
rollback;
