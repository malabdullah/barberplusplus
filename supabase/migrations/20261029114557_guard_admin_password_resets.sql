-- Serialize trusted-role changes with administrative password resets. The guard
-- is intentionally persistent on uncertain failures; operators must reconcile.
create table private.admin_password_reset_guards (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  target_id uuid not null unique references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  constraint admin_password_reset_distinct_accounts check (actor_id <> target_id)
);
create index admin_password_reset_guards_actor_idx on private.admin_password_reset_guards(actor_id);
alter table private.admin_password_reset_guards enable row level security;
revoke all on private.admin_password_reset_guards from public, anon, authenticated, service_role;

create function private.block_guarded_role_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (old.raw_app_meta_data ->> 'role') is distinct from (new.raw_app_meta_data ->> 'role')
     and exists (select 1 from private.admin_password_reset_guards g where g.actor_id = old.id or g.target_id = old.id) then
    raise exception 'Role change blocked by password reset guard';
  end if;
  return new;
end;
$$;
revoke all on function private.block_guarded_role_changes() from public, anon, authenticated, service_role;
create trigger block_guarded_role_changes
before update of raw_app_meta_data on auth.users
for each row execute function private.block_guarded_role_changes();

create function public.begin_admin_password_reset(p_actor uuid, p_target uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_role text; guard_id uuid;
begin
  if p_actor is null or p_target is null or p_actor = p_target then
    raise exception 'Invalid account selection';
  end if;
  -- Lock both users in a stable order. A concurrent role update must either
  -- finish before our recheck or encounter the persistent guard afterward.
  perform 1 from auth.users where id in (p_actor, p_target) order by id for update;
  select pg_catalog.lower(raw_app_meta_data ->> 'role') into actor_role from auth.users where id = p_actor;
  select pg_catalog.lower(raw_app_meta_data ->> 'role') into target_role from auth.users where id = p_target;
  if actor_role is distinct from 'admin' or target_role is null
     or target_role not in ('manager','barber','agent','customer') then
    raise exception 'Account role is not eligible for reset';
  end if;
  if (select pg_catalog.count(*) from public.audit_logs where admin_user_id = p_actor
      and action_type = 'password_reset_requested' and created_at >= pg_catalog.now() - interval '1 hour') >= 10 then
    raise exception 'Password reset limit reached';
  end if;
  insert into private.admin_password_reset_guards(actor_id,target_id) values (p_actor,p_target) returning id into guard_id;
  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,metadata)
    values (p_actor,p_target,'password_reset_requested','user',p_target,'{"source":"admin_password_reset"}'::jsonb);
  return guard_id;
end;
$$;
revoke all on function public.begin_admin_password_reset(uuid,uuid) from public, anon, authenticated;
grant execute on function public.begin_admin_password_reset(uuid,uuid) to service_role;

create function public.finish_admin_password_reset(p_guard uuid, p_actor uuid, p_target uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from private.admin_password_reset_guards
    where id = p_guard and actor_id = p_actor and target_id = p_target for update;
  if not found then raise exception 'Password reset guard not found'; end if;
  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,metadata)
    values (p_actor,p_target,'password_reset_completed','user',p_target,'{"source":"admin_password_reset"}'::jsonb);
  delete from private.admin_password_reset_guards where id = p_guard;
  return true;
end;
$$;
revoke all on function public.finish_admin_password_reset(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.finish_admin_password_reset(uuid,uuid,uuid) to service_role;
