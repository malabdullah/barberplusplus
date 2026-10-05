create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Trust existing roles exactly once during the authorization migration. Future
-- authorization reads only raw_app_meta_data, which users cannot edit.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', raw_user_meta_data ->> 'role')
where raw_user_meta_data ->> 'role' in ('admin', 'manager', 'agent', 'barber')
  and coalesce(raw_app_meta_data ->> 'role', '') = '';

create or replace function private.assign_default_manager_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Public sign-up is the manager-registration flow. Invited accounts receive
  -- their role from the inviting privileged Edge Function instead.
  if new.invited_at is null and coalesce(new.raw_app_meta_data ->> 'role', '') = '' then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', 'manager');
  end if;
  return new;
end;
$$;

revoke all on function private.assign_default_manager_role() from public, anon, authenticated;

drop trigger if exists assign_default_manager_role on auth.users;
create trigger assign_default_manager_role
before insert on auth.users
for each row execute function private.assign_default_manager_role();

drop policy if exists "Barbers view own notifications" on public.notifications;
create policy "Barbers view own notifications" on public.notifications
for select to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'role') = 'barber'
  and recipient_user_id = (select auth.uid())
);

drop policy if exists "Managers view branch notifications" on public.notifications;
create policy "Managers view branch notifications" on public.notifications
for select to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'role') = 'manager'
  and (
    recipient_user_id = (select auth.uid())
    or recipient_branch_id in (
      select id from public.branches where manager_id = (select auth.uid())
    )
  )
);

drop policy if exists "Barbers view own logs" on public.logs;
create policy "Barbers view own logs" on public.logs
for select to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'role') = 'barber'
  and user_id = (select auth.uid())
);

drop policy if exists "Managers view branch logs" on public.logs;
create policy "Managers view branch logs" on public.logs
for select to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'role') = 'manager'
  and branch_id in (
    select id from public.branches where manager_id = (select auth.uid())
  )
);

drop policy if exists "Admins view all logs" on public.logs;
create policy "Admins view all logs" on public.logs
for select to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins view all audit logs" on public.audit_logs;
create policy "Admins view all audit logs" on public.audit_logs
for select to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins insert audit logs" on public.audit_logs;
create policy "Admins insert audit logs" on public.audit_logs
for insert to authenticated
with check (
  (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  and admin_user_id = (select auth.uid())
);

drop function if exists public.count_users_by_role(text);

create function public.count_users_by_role(role_filter text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result bigint;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise insufficient_privilege using message = 'Administrator role required';
  end if;

  select count(*) into result
  from auth.users
  where raw_app_meta_data ->> 'role' = role_filter;
  return result;
end;
$$;

revoke all on function public.count_users_by_role(text) from public, anon;
grant execute on function public.count_users_by_role(text) to authenticated;

alter function public.cleanup_old_notifications(integer, integer)
  security definer
  set search_path = '';
revoke all on function public.cleanup_old_notifications(integer, integer) from public, anon, authenticated;
grant execute on function public.cleanup_old_notifications(integer, integer) to postgres;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function private.invoke_booking_reminders()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  shared_secret text;
  request_id bigint;
begin
  select decrypted_secret into function_url
  from vault.decrypted_secrets
  where name = 'booking_reminders_function_url';

  select decrypted_secret into shared_secret
  from vault.decrypted_secrets
  where name = 'cron_shared_secret';

  if function_url is null or shared_secret is null then
    raise warning 'Booking reminder cron secrets are not configured';
    return null;
  end if;

  select net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', shared_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.invoke_booking_reminders() from public, anon, authenticated;
grant execute on function private.invoke_booking_reminders() to postgres;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'send-booking-reminders'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'send-booking-reminders',
  '0 * * * *',
  'select private.invoke_booking_reminders();'
);
