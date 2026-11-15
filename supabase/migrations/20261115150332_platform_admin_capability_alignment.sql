-- Apply the shared administrative capability to legacy direct-role readers.
begin;
CREATE OR REPLACE FUNCTION shop_handover.transfer_manager(p_branch_id uuid, p_barber_id uuid, p_expected_manager_id uuid, p_keep_bookable boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      and u.raw_app_meta_data->>'role' in('admin','agent') and u.deleted_at is null
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
        and u.raw_app_meta_data->>'role' in('admin','agent') and u.deleted_at is null
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
$function$;

CREATE OR REPLACE FUNCTION public.account_activity(p_before bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  viewer uuid := auth.uid();
  viewer_role text;
  customer_account uuid;
begin
  perform public.enforce_account_session();
  if private.current_account_session() is null then raise sqlstate 'PT401' using message='SESSION_ENDED'; end if;
  select private.live_staff_role() into viewer_role;
  if viewer_role is null then select raw_app_meta_data->>'role' into viewer_role from auth.users where id=viewer; end if;
  if viewer_role='customer' then
    select coalesce((select account_user_id from private.customer_social_identities where user_id=viewer), viewer)
      into customer_account;
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',e.id,'happened_at',e.happened_at,'kind',e.kind,
      'shop',b.name,'shop_ar',b.name_ar,
      'reference',upper(left(replace(e.booking_id::text,'-',''),10)),
      'actor_role',coalesce(e.actor_role,case when e.kind='booking_created' and own.booking_id is not null then 'customer' end),
      'actor_name',case when e.actor_user_id=viewer then null
        when viewer_role in ('admin','manager') and e.actor_role in ('admin','manager','barber','agent','whatsapp_agent')
        then left(u.raw_user_meta_data->>'name',120) end,
      'by_you',coalesce(e.actor_user_id=viewer,false) or (viewer_role='customer' and e.kind='booking_created' and
        e.actor_role is null and own.account_user_id=customer_account)
    ) order by e.id desc), '[]'::jsonb)
    from (
      select a.* from private.account_activity a
      where (p_before is null or a.id<p_before) and (
        viewer_role='admin' or
        (viewer_role='manager' and a.branch_id in (select public.get_user_branch_ids())) or
        (viewer_role='barber' and a.barber_id in (
          select x.id from public.barbers x where x.user_id=viewer and x.status='active'
        )) or
        (viewer_role='agent' and a.actor_user_id=viewer) or
        (viewer_role='customer' and a.booking_id in (
          select o.booking_id from private.customer_booking_owners o where o.account_user_id=customer_account
        ))
      )
      order by a.id desc limit 25
    ) e
    left join public.branches b on b.id=e.branch_id
    left join private.customer_booking_owners own on own.booking_id=e.booking_id
    left join auth.users u on u.id=e.actor_user_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.shop_reviews(p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  viewer uuid := auth.uid();
  viewer_role text;
begin
  perform public.enforce_account_session();
  if private.current_account_session() is null then raise sqlstate 'PT401' using message='SESSION_ENDED'; end if;
  select private.live_staff_role() into viewer_role;
  if viewer_role is null then select raw_app_meta_data->>'role' into viewer_role from auth.users where id=viewer; end if;
  if viewer_role not in ('admin','manager','barber') or viewer_role is null then
    raise exception 'REVIEWS_FORBIDDEN' using errcode='42501';
  end if;
  if p_page is null or p_page<1 or p_page>1000000 then raise exception 'INVALID_PAGE'; end if;

  return (
    with accessible as (
      select v.booking_id,v.body,v.updated_at,r.shop_rating,r.barber_rating,
        b.branch_id,b.barber_id,b.customer_id
      from private.customer_booking_reviews v
      join private.customer_booking_ratings r on r.booking_id=v.booking_id
      join public.bookings b on b.id=v.booking_id
      where b.status='completed' and (
        viewer_role='admin' or
        (viewer_role='manager' and b.branch_id in (select public.get_user_branch_ids())) or
        (viewer_role='barber' and b.barber_id in (select id from public.barbers where user_id=viewer and status='active'))
      )
    ), page as (
      select * from accessible order by updated_at desc,booking_id limit 25 offset (p_page-1)*25
    )
    select jsonb_build_object('total',(select count(*) from accessible),'rows',
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',p.booking_id,'review',p.body,'updated_at',p.updated_at,
        'shop_rating',p.shop_rating,'barber_rating',p.barber_rating,
        'shop',br.name,'shop_ar',br.name_ar,'barber',ba.name,'barber_ar',ba.name_ar,
        'reference',upper(left(replace(p.booking_id::text,'-',''),10))
      ) order by p.updated_at desc,p.booking_id)
      from page p join public.branches br on br.id=p.branch_id join public.barbers ba on ba.id=p.barber_id),'[]'::jsonb)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.manage_booking_policy(p_branch uuid, p_changes jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cancel_value integer;
  reschedule_value integer;
  staff_role text;
begin
  perform public.enforce_account_session();
  staff_role := private.live_staff_role();
  if staff_role is distinct from 'admin' and (staff_role is distinct from 'manager' or p_branch is null or not exists(
    select 1 from public.get_user_branch_ids() shop(id) where shop.id=p_branch
  )) then raise exception 'BOOKING_POLICY_FORBIDDEN' using errcode='42501'; end if;
  if p_changes is null then return private.booking_policy(p_branch); end if;
  if jsonb_typeof(p_changes) is distinct from 'object'
    or (p_changes->>'cancel_minutes' is not null and p_changes->>'cancel_minutes' !~ '^[0-9]{1,6}$')
    or (p_changes->>'reschedule_minutes' is not null and p_changes->>'reschedule_minutes' !~ '^[0-9]{1,6}$')
  then raise exception 'INVALID_BOOKING_POLICY'; end if;
  cancel_value := (p_changes->>'cancel_minutes')::integer;
  reschedule_value := (p_changes->>'reschedule_minutes')::integer;
  if cancel_value>525600 or reschedule_value>525600 then raise exception 'INVALID_BOOKING_POLICY'; end if;
  if p_branch is null then
    if cancel_value is null or reschedule_value is null then raise exception 'INVALID_BOOKING_POLICY'; end if;
    insert into public.admin_settings(setting_key,setting_value,description,category,updated_by) values
      ('customer_cancel_notice_minutes',to_jsonb(cancel_value),'Default customer cancellation notice in minutes','booking_rules',auth.uid()),
      ('customer_reschedule_notice_minutes',to_jsonb(reschedule_value),'Default customer rescheduling notice in minutes','booking_rules',auth.uid())
    on conflict (setting_key) do update set setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=now();
  else
    if jsonb_typeof(p_changes->'barber_can_cancel') is distinct from 'boolean' then raise exception 'INVALID_BOOKING_POLICY'; end if;
    insert into private.shop_booking_policies(branch_id,cancel_minutes,reschedule_minutes,barber_can_cancel)
    values(p_branch,cancel_value,reschedule_value,(p_changes->>'barber_can_cancel')::boolean)
    on conflict(branch_id) do update set cancel_minutes=excluded.cancel_minutes,reschedule_minutes=excluded.reschedule_minutes,barber_can_cancel=excluded.barber_can_cancel;
  end if;
  return private.booking_policy(p_branch);
end
$function$;

CREATE OR REPLACE FUNCTION private.guard_booking_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  policy jsonb;
  actor text;
  staff_role text;
  reason text;
begin
  if tg_op='INSERT' then
    policy := private.booking_policy(new.branch_id);
    new.cancel_notice_minutes := (policy->>'cancel_minutes')::integer;
    new.reschedule_notice_minutes := (policy->>'reschedule_minutes')::integer;
    new.staff_cancellation := null;
    return new;
  end if;
  new.cancel_notice_minutes := old.cancel_notice_minutes;
  new.reschedule_notice_minutes := old.reschedule_notice_minutes;
  if auth.uid() is not null and new.status='cancelled' and old.status is distinct from 'cancelled' then
    if old.status is null or old.status not in ('pending','confirmed') or new.branch_id is distinct from old.branch_id
      or new.barber_id is distinct from old.barber_id or new.customer_id is distinct from old.customer_id
      or row(new.date,new.time) is distinct from row(old.date,old.time) then
      raise exception 'STAFF_CANCELLATION_NOT_ALLOWED' using errcode='42501';
    end if;
    select u.raw_app_meta_data->>'role' into staff_role from auth.users u
      where u.id=auth.uid() and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
    actor := case
      when staff_role in('admin','agent') then 'admin'
      when staff_role='manager' and exists(select 1 from public.get_user_branch_ids() shop(id) where shop.id=old.branch_id) then 'manager'
      when staff_role='barber' and exists(
        select 1 from public.barbers b where b.id=old.barber_id and b.branch_id=old.branch_id and b.user_id=auth.uid() and b.status='active'
      ) and coalesce((private.booking_policy(old.branch_id)->>'barber_can_cancel')::boolean,false) then 'barber'
      else null end;
    if actor is null then raise exception 'STAFF_CANCELLATION_NOT_ALLOWED' using errcode='42501'; end if;
    reason := trim(new.staff_cancellation->>'reason');
    if reason is null or length(reason) not between 3 and 300 then raise exception 'CANCELLATION_REASON_REQUIRED'; end if;
    new.staff_cancellation := jsonb_build_object('reason',reason,'at',clock_timestamp(),'actor',actor,'user_id',auth.uid());
    new.modified_by_type := actor;
    new.modified_by_user_id := auth.uid();
    new.updated_at := now();
  elsif old.status='cancelled' and new.status is distinct from old.status then
    new.staff_cancellation := null;
  else
    new.staff_cancellation := old.staff_cancellation;
  end if;
  return new;
end
$function$;
commit;
