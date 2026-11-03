begin;

alter table public.barbers add column manager_chair boolean default false not null;
create unique index barbers_one_manager_chair on public.barbers (user_id) where manager_chair;

-- A chair uses the manager's shop permissions. It does not grant the separate
-- barber account's branch access or a second login.
create or replace function public.get_barber_branch_id() returns uuid
language sql stable security definer set search_path='public' as $$
  select branch_id from public.barbers where user_id = auth.uid() and not manager_chair limit 1
$$;

create or replace function public.is_barber() returns boolean
language sql stable security definer set search_path='public' as $$
  select exists (
    select 1 from public.barbers where user_id = auth.uid() and not manager_chair
  )
$$;

alter policy "Barbers can update own bookings" on public.bookings
using (barber_id in (select id from public.barbers where user_id=auth.uid() and not manager_chair));

create function private.guard_manager_chair() returns trigger
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
      or not exists (select 1 from public.branches where id=new.branch_id and manager_id=new.user_id and status='active')) then
    raise exception 'CHAIR_SHOP_NOT_ALLOWED' using errcode='42501';
  end if;

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

revoke all on function private.guard_manager_chair() from public, anon, authenticated, service_role;

create trigger guard_manager_chair before insert or update or delete on public.barbers
for each row execute function private.guard_manager_chair();

-- Serialize a new appointment against closing the chair. Existing bookings
-- can still be completed or cancelled without reopening it.
create function private.guard_manager_chair_booking() returns trigger
language plpgsql security definer set search_path='' as $$
declare chair public.barbers%rowtype;
begin
  if new.status in ('cancelled','no_show') then return null; end if;
  if tg_op='UPDATE' and (new.barber_id,new.branch_id,new.date,new.time)
      is not distinct from (old.barber_id,old.branch_id,old.date,old.time)
      and old.status not in ('cancelled','no_show') then
    return null;
  end if;
  select * into chair from public.barbers where id=new.barber_id and manager_chair for share;
  if found and (chair.status is distinct from 'active' or new.branch_id is distinct from chair.branch_id) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;
  return null;
end $$;

revoke all on function private.guard_manager_chair_booking() from public, anon, authenticated, service_role;

create trigger guard_manager_chair_booking
after insert or update of barber_id, branch_id, date, time, status on public.bookings
for each row execute function private.guard_manager_chair_booking();

-- Reassigning a shop closes a chair tied to its previous manager.
create function private.close_transferred_manager_chair() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.manager_id is distinct from old.manager_id then
    update public.barbers set status='inactive'
    where branch_id=new.id and manager_chair and status is distinct from 'inactive';
  end if;
  return null;
end $$;

revoke all on function private.close_transferred_manager_chair() from public, anon, authenticated, service_role;

create trigger close_transferred_manager_chair after update of manager_id on public.branches
for each row execute function private.close_transferred_manager_chair();

commit;
