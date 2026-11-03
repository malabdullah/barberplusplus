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

  if tg_op='UPDATE' and (
      (old.manager_chair and (not new.manager_chair
        or (new.user_id, new.branch_id) is distinct from (old.user_id, old.branch_id)))
      or (not old.manager_chair and new.manager_chair and not (
        public.is_admin()
        and (new.user_id, new.branch_id) is not distinct from (old.user_id, old.branch_id)
        and exists (
          select 1 from public.branches br join auth.users u on u.id=br.manager_id
          where br.id=new.branch_id and u.id=new.user_id
            and u.raw_app_meta_data->>'role'='manager' and u.deleted_at is null
        )
      ))
    ) then
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
      or (new.manager_chair, new.status, new.service_ids, new.availability)
        is distinct from (old.manager_chair, old.status, old.service_ids, old.availability)) then
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

-- This schema is not exposed through PostgREST. The public entry point runs
-- with the caller's privileges and the private implementation checks live Auth.
create schema shop_handover;
revoke all on schema shop_handover from public, anon, authenticated, service_role;
grant usage on schema shop_handover to authenticated;

create function shop_handover.transfer_manager(
  p_branch_id uuid,
  p_barber_id uuid,
  p_expected_manager_id uuid,
  p_keep_bookable boolean
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  branch public.branches%rowtype;
  barber public.barbers%rowtype;
  incoming auth.users%rowtype;
  outgoing_name text;
  pending_appointments bigint;
  profile jsonb;
  barber_phone text;
  profile_phone text;
begin
  if not public.is_admin() or not exists (
    select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=actor and s.id::text=auth.jwt()->>'session_id'
      and u.raw_app_meta_data->>'role'='admin' and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
      and (s.not_after is null or s.not_after>now())
  ) then
    raise exception 'TRANSFER_FORBIDDEN' using errcode='42501';
  end if;

  if p_keep_bookable is null then
    select * into branch from public.branches where id=p_branch_id;
    select * into barber from public.barbers where id=p_barber_id and branch_id=p_branch_id;
  else
    select * into branch from public.branches where id=p_branch_id for update;
    select * into barber from public.barbers where id=p_barber_id and branch_id=p_branch_id for no key update;
  end if;
  if branch.id is null or branch.status is distinct from 'active'
    or branch.manager_id is distinct from p_expected_manager_id
    or barber.id is null or barber.user_id is null or barber.manager_chair
    or barber.user_id=branch.manager_id then
    raise exception 'TRANSFER_STALE';
  end if;

  if p_keep_bookable is not null then
    -- Serializes promotion of the same account and respects the existing
    -- password-reset guard. Refresh all permissions with a new sign-in.
    perform 1 from auth.users where id in (actor,barber.user_id) order by id for update;
    if not exists (
      select 1 from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=actor and s.id::text=auth.jwt()->>'session_id'
        and u.raw_app_meta_data->>'role'='admin' and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=now())
        and (s.not_after is null or s.not_after>now())
    ) then
      raise exception 'TRANSFER_FORBIDDEN' using errcode='42501';
    end if;
    -- Customer booking already locks the chair row. Close the check/write gap
    -- without blocking foreign-key checks on existing booking references.
    perform 1 from public.barbers b
    where b.branch_id=branch.id and b.user_id=branch.manager_id and b.manager_chair
    for no key update;
  end if;

  select * into incoming from auth.users where id=barber.user_id;
  if incoming.id is null or incoming.deleted_at is not null or incoming.banned_until>now()
    or incoming.raw_app_meta_data->>'role' is distinct from 'barber'
    or (incoming.email_confirmed_at is null and incoming.phone_confirmed_at is null)
    or exists (select 1 from public.barbers b where b.user_id=barber.user_id and b.id<>barber.id)
    or exists (select 1 from public.branches br where br.manager_id=barber.user_id) then
    raise exception 'TRANSFER_BARBER_INELIGIBLE';
  end if;

  select count(*) into pending_appointments
  from public.bookings k join public.barbers b on b.id=k.barber_id
  where k.branch_id=branch.id and b.branch_id=branch.id and b.user_id=branch.manager_id
    and k.status in ('pending','confirmed')
    and ((k.date + k.time + k.duration * interval '1 minute') at time zone 'Asia/Kuwait') > now();

  if p_keep_bookable is null then
    select coalesce(nullif(u.raw_user_meta_data->>'name',''),u.email) into outgoing_name
    from auth.users u where u.id=branch.manager_id;
    return jsonb_build_object(
      'branchName',branch.name,
      'incomingName',barber.name,
      'outgoingName',outgoing_name,
      'outgoingUpcoming',pending_appointments,
      'currentlyBookable',coalesce(barber.status='active',false),
      'remainingBranches',(select count(*) from public.branches br where br.manager_id=branch.manager_id and br.id<>branch.id)
    );
  end if;

  if pending_appointments>0 then raise exception 'TRANSFER_UPCOMING_APPOINTMENTS'; end if;
  if p_keep_bookable and barber.status is distinct from 'active' then
    raise exception 'TRANSFER_CHAIR_INACTIVE';
  end if;

  profile := coalesce(incoming.raw_user_meta_data,'{}'::jsonb);
  barber_phone := private.canonical_phone(barber.phone,barber.country_code);
  profile_phone := private.canonical_phone(profile->>'phone',coalesce(profile->>'countryCode',profile->>'country_code','+965'));
  if barber_phone is not null and profile_phone is not null and barber_phone<>profile_phone
    and barber_phone is distinct from private.canonical_phone(incoming.phone,'',true) then
    raise exception 'TRANSFER_CONTACT_MISMATCH';
  end if;
  if barber_phone is not null and profile_phone is null then
    profile := profile || jsonb_build_object('phone',barber_phone);
  end if;
  if nullif(profile->>'name','') is null then
    profile := profile || jsonb_build_object('name',barber.name);
  end if;

  update auth.users
    set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"manager"}'::jsonb,
      raw_user_meta_data=profile, updated_at=now()
    where id=incoming.id;
  update public.branches set manager_id=incoming.id where id=branch.id;
  update public.barbers
    set manager_chair=true, phone=null, email=null, status=case when p_keep_bookable then 'active' else 'inactive' end
    where id=barber.id;
  perform private.sync_phone_record('barbers',barber.id,null);
  delete from auth.sessions where user_id=incoming.id;

  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,metadata)
  values (actor,incoming.id,'role_assigned','branch',branch.id,jsonb_build_object(
    'source','branch_manager_transfer','oldManagerId',branch.manager_id,'barberId',barber.id,
    'newRole','manager','chairBookable',p_keep_bookable
  ));

  return jsonb_build_object('branchId',branch.id,'barberId',barber.id);
end;
$$;
revoke all on function shop_handover.transfer_manager(uuid,uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function shop_handover.transfer_manager(uuid,uuid,uuid,boolean) to authenticated;

create function public.admin_transfer_branch_manager(
  p_branch_id uuid,
  p_barber_id uuid,
  p_expected_manager_id uuid,
  p_keep_bookable boolean default null
) returns jsonb
language sql security invoker set search_path='' as $$
  select shop_handover.transfer_manager(p_branch_id,p_barber_id,p_expected_manager_id,p_keep_bookable)
$$;
revoke all on function public.admin_transfer_branch_manager(uuid,uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_transfer_branch_manager(uuid,uuid,uuid,boolean) to authenticated;

-- An outgoing manager's old notifications may include booking details.
-- Keep the records for audit while limiting the dashboard to assigned branches.
alter policy notifications_read_recipient on public.notifications using (
  recipient_user_id=(select auth.uid())
  and recipient_role=(select auth.jwt()->'app_metadata'->>'role')
  and (recipient_role<>'manager' or recipient_branch_id is null or
    recipient_branch_id in (select public.get_user_branch_ids()))
);
alter policy notifications_update_recipient on public.notifications using (
  recipient_user_id=(select auth.uid())
  and recipient_role=(select auth.jwt()->'app_metadata'->>'role')
  and (recipient_role<>'manager' or recipient_branch_id is null or
    recipient_branch_id in (select public.get_user_branch_ids()))
) with check (
  recipient_user_id=(select auth.uid())
  and recipient_role=(select auth.jwt()->'app_metadata'->>'role')
  and (recipient_role<>'manager' or recipient_branch_id is null or
    recipient_branch_id in (select public.get_user_branch_ids()))
);

commit;
