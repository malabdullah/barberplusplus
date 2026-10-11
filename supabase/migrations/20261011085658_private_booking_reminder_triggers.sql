-- TEST-BOOK-01: browser-authorized booking writes also maintain a private
-- reminder. Do not restore browser reminder privileges or use a postgres-owned
-- SECURITY DEFINER RPC to bypass booking authorization.
create role barber_reminder_writer nologin noinherit nosuperuser
  nocreatedb nocreaterole noreplication nobypassrls;

grant usage on schema private, public to barber_reminder_writer;
grant insert (booking_id, scheduled_at), select (booking_id, status), update (status)
  on public.booking_reminders to barber_reminder_writer;

-- The role cannot log in, is not granted to an API role, owns no table, and
-- remains subject to RLS. Its column privileges work only inside a trigger.
create policy "Internal trigger reads reminder identifiers"
on public.booking_reminders for select to barber_reminder_writer
using ((select pg_catalog.pg_trigger_depth()) = 1);
create policy "Internal trigger creates reminders"
on public.booking_reminders for insert to barber_reminder_writer
with check ((select pg_catalog.pg_trigger_depth()) = 1);
create policy "Internal trigger cancels reminders"
on public.booking_reminders for update to barber_reminder_writer
using ((select pg_catalog.pg_trigger_depth()) = 1)
with check ((select pg_catalog.pg_trigger_depth()) = 1);

create function private.maintain_booking_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reminder_time timestamptz;
  -- Same trusted claim extraction as the installed Auth helpers, without
  -- granting this restricted writer access to the Auth schema or user data.
  caller_id uuid := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
  caller_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
begin
  -- Only the two AFTER ROW booking triggers below may reach the restricted
  -- writer. The originating booking statement has already passed its RLS and
  -- constraints; this function never reads/bypasses booking authorization.
  if tg_relid <> 'public.bookings'::pg_catalog.regclass
    or tg_level <> 'ROW' or tg_when <> 'AFTER'
    or pg_catalog.pg_trigger_depth() <> 1
    or not (
      (tg_op = 'INSERT' and tg_name = 'create_reminder_on_booking')
      or (tg_op = 'UPDATE' and tg_name = 'cancel_reminder_on_booking_cancel')
    ) then
    raise insufficient_privilege using message = 'Invalid reminder trigger context';
  end if;
  if caller_id is null and not (
    coalesce(caller_role = 'service_role', false)
    or (caller_role is null and session_user in ('postgres', 'supabase_admin'))
  ) then
    raise insufficient_privilege using message = 'Authenticated booking writer required';
  end if;

  if tg_op = 'INSERT' and new.status in ('pending', 'confirmed') then
    reminder_time := ((new.date + new.time) at time zone 'Asia/Kuwait') - interval '1 hour';
    if reminder_time > pg_catalog.now() then
      insert into public.booking_reminders (booking_id, scheduled_at)
      values (new.id, reminder_time) on conflict do nothing;
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'cancelled'
    and old.status is distinct from 'cancelled' then
    update public.booking_reminders set status = 'cancelled'
    where booking_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

-- Ownership transfer requires CREATE temporarily; the final role cannot create
-- or replace schema objects. Only trusted postgres may SET this no-login role.
-- Revoke default function grants while postgres still owns it. After transfer,
-- postgres intentionally does not inherit writer ownership/column privileges.
revoke all on function private.maintain_booking_reminder()
  from public, anon, authenticated, service_role;
grant barber_reminder_writer to postgres with admin false, inherit false, set true;
grant create on schema private to barber_reminder_writer;
alter function private.maintain_booking_reminder() owner to barber_reminder_writer;
set local role barber_reminder_writer;
grant execute on function private.maintain_booking_reminder() to postgres;
reset role;
revoke create on schema private from barber_reminder_writer;

create or replace trigger create_reminder_on_booking
after insert on public.bookings for each row
execute function private.maintain_booking_reminder();
create or replace trigger cancel_reminder_on_booking_cancel
after update on public.bookings for each row
execute function private.maintain_booking_reminder();

-- Preserve the deliberately private operational table and service-role policy.
revoke all on public.booking_reminders from anon, authenticated;
