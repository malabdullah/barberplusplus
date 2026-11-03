begin;

create or replace function private.guard_manager_chair() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.manager_chair then
      raise exception 'CHAIR_HISTORY_PROTECTED';
    end if;
    return old;
  end if;

  if tg_op='UPDATE' and (new.manager_chair is distinct from old.manager_chair
      or (old.manager_chair and (new.user_id, new.branch_id) is distinct from (old.user_id, old.branch_id))) then
    raise exception 'CHAIR_ASSIGNMENT_FIXED';
  end if;
  if not new.manager_chair then return new; end if;

  if tg_op='INSERT' and (not public.is_manager() or new.user_id is distinct from auth.uid()
      or new.user_id is null or new.status is distinct from 'inactive'
      or not exists (select 1 from auth.users where id=new.user_id and raw_app_meta_data->>'role'='manager' and deleted_at is null)
      or not exists (select 1 from public.branches where id=new.branch_id and manager_id=new.user_id and status='active' for share)) then
    raise exception 'CHAIR_SHOP_NOT_ALLOWED' using errcode='42501';
  end if;

  new.invite_status := 'accepted';

  -- Account contact details belong to the existing login.
  if new.email is not null or new.phone is not null then
    raise exception 'CHAIR_USE_ACCOUNT_CONTACT';
  end if;

  if tg_op='UPDATE' and auth.uid() is not null and not public.is_admin()
      and (not public.is_manager() or not exists (
        select 1 from public.branches where id=new.branch_id and manager_id=auth.uid() and manager_id=new.user_id)) then
    raise exception 'CHAIR_SHOP_NOT_ALLOWED' using errcode='42501';
  end if;

  if new.status='active' and (tg_op='INSERT'
      or (new.status, new.service_ids, new.availability) is distinct from (old.status, old.service_ids, old.availability)) then
    if not exists (select 1 from public.branches where id=new.branch_id and manager_id=new.user_id and status='active') then
      raise exception 'CHAIR_SHOP_NOT_ALLOWED' using errcode='42501';
    end if;
    if not exists (select 1 from public.services where id=any(new.service_ids) and branch_id=new.branch_id and status='active') then
      raise exception 'CHAIR_SERVICES_REQUIRED';
    end if;
    if not exists (
      select 1 from jsonb_each(new.availability) as day(key, hours)
      where day.key in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
        and coalesce(day.hours->>'enabled', day.hours->>'available')='true'
        and day.hours->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and day.hours->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and day.hours->>'start' < day.hours->>'end'
    ) then
      raise exception 'CHAIR_HOURS_REQUIRED';
    end if;
  end if;
  return new;
end $$;

create or replace function private.guard_global_phone()
returns trigger language plpgsql security definer set search_path='' as $$
declare record_id uuid; value jsonb; previous jsonb; source_name text; previous_user uuid;
begin
  if tg_op<>'DELETE' then value:=to_jsonb(new); end if;
  if tg_op<>'INSERT' then previous:=to_jsonb(old); end if;
  record_id:=(coalesce(value,previous)->>case when tg_table_name='customer_accounts' then 'user_id' else 'id' end)::uuid;
  -- Chair rows cannot hold contact data. The manager's login is the sole
  -- source for their number, so leave its existing registry entry alone.
  if tg_table_name='barbers' and coalesce(value,previous)->>'manager_chair'='true' then
    return null;
  end if;
  source_name:=case when tg_table_schema='auth' then 'auth.users' else tg_table_name end;
  -- ON DELETE SET NULL can run before the Auth AFTER DELETE trigger. Remove
  -- the deleted user's mirror first; the barber record still owns its number.
  previous_user:=nullif(previous->>'user_id','')::uuid;
  if tg_table_name='barbers' and tg_op='UPDATE' and previous_user is not null and value->>'user_id' is null
    and not exists(select 1 from auth.users where id=previous_user) then
    perform private.sync_phone_record('auth.users',previous_user,null);
  end if;
  perform private.sync_phone_record(source_name,record_id,value);
  return null;
end;
$$;

commit;
