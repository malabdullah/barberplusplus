-- Authorization helpers are intentionally security invoker: they only inspect
-- immutable app_metadata claims and do not need elevated database privileges.
create or replace function public.is_agent()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'agent';
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager';
$$;

revoke all on function public.is_agent() from public, anon;
revoke all on function public.is_manager() from public, anon;
grant execute on function public.is_agent() to authenticated, service_role;
grant execute on function public.is_manager() to authenticated, service_role;

-- These RPCs must bypass auth.users RLS for the administrator dashboard, so
-- they remain security definer but enforce the caller's trusted role first.
create or replace function public.get_managers()
returns table(
  id uuid,
  email text,
  name text,
  phone text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise insufficient_privilege using message = 'Administrator role required';
  end if;

  return query
  select
    users.id,
    users.email::text,
    coalesce(users.raw_user_meta_data ->> 'name', pg_catalog.split_part(users.email::text, '@', 1))::text,
    (users.raw_user_meta_data ->> 'phone')::text,
    users.created_at
  from auth.users
  where users.raw_app_meta_data ->> 'role' = 'manager';
end;
$$;

create or replace function public.get_manager_by_id(manager_id uuid)
returns table(
  id uuid,
  email text,
  name text,
  phone text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise insufficient_privilege using message = 'Administrator role required';
  end if;

  return query
  select
    users.id,
    users.email::text,
    coalesce(users.raw_user_meta_data ->> 'name', pg_catalog.split_part(users.email::text, '@', 1))::text,
    (users.raw_user_meta_data ->> 'phone')::text,
    users.created_at
  from auth.users
  where users.id = manager_id
    and users.raw_app_meta_data ->> 'role' = 'manager';
end;
$$;

revoke all on function public.get_managers() from public, anon;
revoke all on function public.get_manager_by_id(uuid) from public, anon;
grant execute on function public.get_managers() to authenticated, service_role;
grant execute on function public.get_manager_by_id(uuid) to authenticated, service_role;

drop policy if exists "Service role can manage whatsapp_logs" on public.whatsapp_logs;
create policy "Service role can manage whatsapp_logs"
on public.whatsapp_logs
for all
to service_role
using (true)
with check (true);

drop policy if exists "Admins view whatsapp_logs" on public.whatsapp_logs;
create policy "Admins view whatsapp_logs"
on public.whatsapp_logs
for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "Service role full access to reminders" on public.booking_reminders;
create policy "Service role full access to reminders"
on public.booking_reminders
for all
to service_role
using (true)
with check (true);

revoke all on table public.whatsapp_logs from anon, authenticated;
grant select on table public.whatsapp_logs to authenticated;
grant all on table public.whatsapp_logs to service_role;

revoke all on table public.booking_reminders from anon, authenticated;
grant all on table public.booking_reminders to service_role;
