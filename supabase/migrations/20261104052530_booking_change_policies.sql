begin;

insert into public.admin_settings(setting_key,setting_value,description,category) values
  ('customer_cancel_notice_minutes','120','Default customer cancellation notice in minutes','booking_rules'),
  ('customer_reschedule_notice_minutes','120','Default customer rescheduling notice in minutes','booking_rules')
on conflict (setting_key) do nothing;

create table private.shop_booking_policies (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  cancel_minutes integer check (cancel_minutes between 0 and 525600),
  reschedule_minutes integer check (reschedule_minutes between 0 and 525600),
  barber_can_cancel boolean not null default false
);
alter table private.shop_booking_policies enable row level security;
revoke all on private.shop_booking_policies from public, anon, authenticated, service_role;

alter table public.bookings
  add column cancel_notice_minutes integer not null default 0 check (cancel_notice_minutes between 0 and 525600),
  add column reschedule_notice_minutes integer not null default 0 check (reschedule_notice_minutes between 0 and 525600),
  add column staff_cancellation jsonb;

create function private.booking_policy(p_branch uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'cancel_minutes', coalesce(p.cancel_minutes, defaults.cancel_minutes),
    'reschedule_minutes', coalesce(p.reschedule_minutes, defaults.reschedule_minutes),
    'default_cancel_minutes',defaults.cancel_minutes,
    'default_reschedule_minutes',defaults.reschedule_minutes,
    'cancel_override',p.cancel_minutes,
    'reschedule_override',p.reschedule_minutes,
    'barber_can_cancel',coalesce(p.barber_can_cancel,false)
  )
  from (
    select
      coalesce(max(case when setting_key='customer_cancel_notice_minutes' and setting_value #>> '{}' ~ '^[0-9]{1,6}$'
        then least((setting_value #>> '{}')::integer,525600) end),120) as cancel_minutes,
      coalesce(max(case when setting_key='customer_reschedule_notice_minutes' and setting_value #>> '{}' ~ '^[0-9]{1,6}$'
        then least((setting_value #>> '{}')::integer,525600) end),120) as reschedule_minutes
    from public.admin_settings where setting_key in ('customer_cancel_notice_minutes','customer_reschedule_notice_minutes')
  ) defaults left join private.shop_booking_policies p on p.branch_id=p_branch
$$;
revoke all on function private.booking_policy(uuid) from public,anon,authenticated,service_role;

create function public.shop_booking_policy(p_branch uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('cancel_minutes',p->'cancel_minutes','reschedule_minutes',p->'reschedule_minutes')
  from (select private.booking_policy(p_branch) p) policy
  where exists(select 1 from public.branches where id=p_branch and status='active')
$$;
revoke all on function public.shop_booking_policy(uuid) from public,anon,authenticated,service_role;
grant execute on function public.shop_booking_policy(uuid) to anon,authenticated,service_role;

create function public.manage_booking_policy(p_branch uuid,p_changes jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  cancel_value integer;
  reschedule_value integer;
  staff_role text;
begin
  select u.raw_app_meta_data->>'role' into staff_role from auth.users u
    where u.id=auth.uid() and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
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
$$;
revoke all on function public.manage_booking_policy(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.manage_booking_policy(uuid,jsonb) to authenticated;

create function private.guard_booking_policy() returns trigger
language plpgsql security definer set search_path='' as $$
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
      when staff_role='admin' then 'admin'
      when staff_role='manager' and exists(select 1 from public.get_user_branch_ids() shop(id) where shop.id=old.branch_id) then 'manager'
      when staff_role='agent' then 'whatsapp_agent'
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
$$;
revoke all on function private.guard_booking_policy() from public,anon,authenticated,service_role;
create trigger guard_booking_policy before insert or update on public.bookings
for each row execute function private.guard_booking_policy();

create or replace function public.customer_booking(p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $function$
declare
  v_barber public.barbers%rowtype;
  v_branch public.branches%rowtype;
  v_booking public.bookings%rowtype;
  v_services uuid[];
  v_date date;
  v_time time;
  v_today date := (current_timestamp at time zone 'Asia/Kuwait')::date;
  v_day text;
  v_schedule jsonb;
  v_hours jsonb;
  v_start time;
  v_end time;
  v_duration integer;
  v_price numeric;
  v_count integer;
  v_slots jsonb := '[]'::jsonb;
  v_customer uuid;
  v_id uuid;
  v_phone text;
  v_code text;
  v_name text;
begin
  if p_action not in ('slots', 'book', 'appointment-slots') or p_action is null then
    raise exception 'INVALID_REQUEST';
  end if;
  if p_action = 'book' then
    v_id := (p_data ->> 'id')::uuid;
    v_phone := p_data ->> 'phone';
    v_code := p_data ->> 'country_code';
    v_name := trim(p_data ->> 'name');
    if v_id is null or v_name is null or length(v_name) not between 2 and 120
       or v_code is null or v_code not in ('+965','+966','+971','+973','+974','+968')
       or v_phone is null or v_phone !~ '^[0-9]{8,9}$'
       or length(coalesce(p_data ->> 'notes', '')) > 500 then
      raise exception 'INVALID_REQUEST';
    end if;
    -- Serializes retries of the same verified booking, even across barbers.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text, 0));
    select * into v_booking from public.bookings where id = v_id;
    if found then
      if not exists (select 1 from public.customers where id = v_booking.customer_id
        and phone = v_phone and country_code = v_code) then
        raise exception 'INVALID_REQUEST';
      end if;
    end if;
  end if;
  if v_booking.id is null then
    select * into v_barber from public.barbers where id = (p_data ->> 'barber_id')::uuid
      and status = 'active';
    select * into v_branch from public.branches where id = v_barber.branch_id and status = 'active';
    if v_barber.id is null or v_branch.id is null
       or v_branch.id is distinct from (p_data ->> 'branch_id')::uuid then
      raise exception 'INVALID_SELECTION';
    end if;
    select array_agg(value::uuid) into v_services
      from jsonb_array_elements_text(p_data -> 'service_ids');
    if coalesce(cardinality(v_services), 0) not between 1 and 10
       or not v_services <@ coalesce(v_barber.service_ids, '{}'::uuid[])
       or cardinality(v_services) <> (select count(distinct x) from unnest(v_services) x) then
      raise exception 'INVALID_SELECTION';
    end if;
    select count(*), sum(duration), sum(price) into v_count, v_duration, v_price
      from public.services where id = any(v_services) and branch_id = v_branch.id and status = 'active';
    if v_count <> cardinality(v_services) or v_duration not between 5 and 480 or v_price < 0 then
      raise exception 'INVALID_SELECTION';
    end if;
    -- Only the authenticated appointment manager supplies this internal action.
    if p_action='appointment-slots' then
      v_duration := (p_data->>'booked_duration')::integer;
      v_price := (p_data->>'booked_price')::numeric;
      if v_duration is null or v_duration not between 5 and 480 then
        raise exception 'INVALID_SELECTION';
      end if;
    end if;
    v_date := (p_data ->> 'date')::date;
    if v_date is null or v_date < v_today or v_date > v_today + v_barber.max_booking_days then
      raise exception 'INVALID_DATE';
    end if;
    v_day := lower(trim(to_char(v_date, 'Day')));
    v_schedule := v_barber.availability -> v_day;
    v_hours := v_branch.working_hours -> v_day;
    if coalesce((v_schedule ->> 'enabled')::boolean, (v_schedule ->> 'available')::boolean, false)
       and not coalesce((v_hours ->> 'closed')::boolean, false)
       and not exists (
         select 1 from jsonb_array_elements(coalesce(v_barber.vacations, '[]')) x
         where v_date between (x ->> 'startDate')::date and (x ->> 'endDate')::date
       ) then
      v_start := greatest((v_schedule ->> 'start')::time, (v_hours ->> 'open')::time);
      v_end := least((v_schedule ->> 'end')::time, (v_hours ->> 'close')::time);
      if v_start is not null and v_end is not null and v_end > v_start
         and v_hours ->> 'open' is not null and v_hours ->> 'close' is not null then
        select coalesce(jsonb_agg(to_char(s, 'HH24:MI') order by s), '[]'::jsonb) into v_slots
        from generate_series(v_date + v_start, v_date + v_end - v_duration * interval '1 minute', interval '15 minutes') s
        where s at time zone 'Asia/Kuwait' > current_timestamp
          and not exists (
            select 1 from public.bookings b where b.barber_id = v_barber.id and b.date = v_date
              and b.status not in ('cancelled','no_show')
              and (p_action<>'appointment-slots' or b.id is distinct from (p_data->>'exclude_booking_id')::uuid)
              and tsrange(b.date + b.time, b.date + b.time + b.duration * interval '1 minute', '[)')
                && tsrange(s, s + v_duration * interval '1 minute', '[)')
          )
          and not exists (
            select 1 from jsonb_array_elements(coalesce(v_barber.time_offs, '[]')) x
            where ((x ->> 'type' = 'one-time' and x ->> 'date' = v_date::text)
              or (x ->> 'type' = 'recurring' and x ->> 'day' = v_day))
              and tsrange(v_date + (x ->> 'start')::time, v_date + (x ->> 'end')::time, '[)')
                && tsrange(s, s + v_duration * interval '1 minute', '[)')
          );
      end if;
    end if;
    if p_action in ('slots','appointment-slots') then
      return jsonb_build_object('slots', v_slots, 'duration', v_duration, 'price', v_price,
        'today', v_today, 'last_date', v_today + v_barber.max_booking_days,
        'booking_policy',public.shop_booking_policy(v_branch.id));
    end if;
    v_time := (p_data ->> 'time')::time;
    if v_time is null or not v_slots ? to_char(v_date + v_time, 'HH24:MI') then
      raise exception 'SLOT_UNAVAILABLE';
    end if;
    if nullif(p_data->>'account_user_id','') is not null then
      v_customer:=private.resolve_booking_customer((p_data->>'account_user_id')::uuid,(p_data->>'session_id')::uuid);
      if not exists(select 1 from public.customers where id=v_customer and phone=v_phone and country_code=v_code) then raise exception 'INVALID_REQUEST'; end if;
    else
      -- Guests reuse a contact without editing it or acquiring its history.
      insert into public.customers(name,country_code,phone,preferred_branch_id,preferred_barber_id,created_by_type)
        values(v_name,v_code,v_phone,v_branch.id,v_barber.id,'customer') on conflict(country_code,phone) do nothing;
      select id into v_customer from public.customers where country_code=v_code and phone=v_phone and status='active';
      if v_customer is null then raise exception 'BOOKING_UNAVAILABLE'; end if;
    end if;
    insert into public.bookings (id, branch_id, barber_id, service_ids, customer_id, date, time,
      duration, price, status, notes, added_by_type)
    values (v_id, v_branch.id, v_barber.id, v_services, v_customer, v_date, v_time,
      v_duration, v_price, 'confirmed', nullif(trim(p_data ->> 'notes'), ''), 'customer') returning * into v_booking;
    if p_data ? 'booking_policy' and p_data->'booking_policy' is distinct from jsonb_build_object(
      'cancel_minutes',v_booking.cancel_notice_minutes,'reschedule_minutes',v_booking.reschedule_notice_minutes
    ) then raise exception 'BOOKING_POLICY_CHANGED'; end if;
  end if;
  if p_action = 'book' and nullif(p_data->>'account_user_id','') is not null then
    perform private.record_customer_booking_owner(v_booking.id, (p_data->>'account_user_id')::uuid, (p_data->>'session_id')::uuid);
  end if;
  return (
    select jsonb_build_object('id', b.id, 'reference', upper(left(replace(b.id::text, '-', ''), 10)),
      'date', b.date, 'time', to_char(b.date + b.time, 'HH24:MI'), 'duration', b.duration, 'price', b.price,
      'status', b.status, 'branch_name', br.name, 'branch_name_ar', br.name_ar,
      'barber_name', ba.name, 'barber_name_ar', ba.name_ar, 'address', br.address,
      'location_url', br.location_url, 'service_names', (select jsonb_agg(jsonb_build_object('name', s.name, 'name_ar', s.name_ar))
        from public.services s where s.id = any(b.service_ids)))
    from public.bookings b join public.branches br on br.id = b.branch_id
      join public.barbers ba on ba.id = b.barber_id where b.id = v_booking.id
  );
end;
$function$;

create or replace function private.customer_appointment_api(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  history jsonb;
  target public.bookings%rowtype;
  requested_date date;
  requested_time time;
  availability jsonb;
  cutoff timestamptz;
begin
  if p_action not in ('appointment-slots','reschedule-booking','cancel-booking') or p_action is null then
    raise exception 'INVALID_REQUEST';
  end if;
  -- Reuse the same session and ownership check as the appointment list.
  history := private.customer_account_api('bookings', p_data);
  if jsonb_typeof(history) is distinct from 'array' then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from jsonb_array_elements(history) item where item->>'id'=p_data->>'booking_id') then
    raise exception 'BOOKING_NOT_MANAGEABLE';
  end if;

  -- Both changes lock the same booking before checking its current state.
  select b.* into target from public.bookings b where b.id=(p_data->>'booking_id')::uuid for update;
  if not found then raise exception 'BOOKING_NOT_MANAGEABLE'; end if;

  cutoff := ((target.date + target.time) at time zone 'Asia/Kuwait') - make_interval(mins =>
    case when p_action='cancel-booking' then target.cancel_notice_minutes else target.reschedule_notice_minutes end
  );
  if p_action='cancel-booking' and target.status='cancelled' then
    return jsonb_build_object('id',target.id,'date',target.date,'time',to_char(target.time,'HH24:MI'),'status',target.status,
    'cancellation_cutoff',case when target.status in ('pending','confirmed')
      then ((target.date+target.time) at time zone 'Asia/Kuwait')-make_interval(mins=>target.cancel_notice_minutes) end,
    'reschedule_cutoff',case when target.status in ('pending','confirmed')
      then ((target.date+target.time) at time zone 'Asia/Kuwait')-make_interval(mins=>target.reschedule_notice_minutes) end);
  end if;
  if target.status is null or target.status not in ('confirmed','pending') then
    raise exception 'BOOKING_NOT_MANAGEABLE';
  end if;
  if cutoff<=clock_timestamp() then raise exception 'BOOKING_CUTOFF_PASSED'; end if;

  if p_action in ('appointment-slots','reschedule-booking') then
    requested_date := coalesce((p_data->>'date')::date,(clock_timestamp() at time zone 'Asia/Kuwait')::date);
    requested_time := (p_data->>'time')::time;
  end if;

  if p_action='reschedule-booking' and target.date=requested_date and target.time=requested_time then
    return jsonb_build_object('id',target.id,'date',target.date,'time',to_char(target.time,'HH24:MI'),'status',target.status,
    'cancellation_cutoff',case when target.status in ('pending','confirmed')
      then ((target.date+target.time) at time zone 'Asia/Kuwait')-make_interval(mins=>target.cancel_notice_minutes) end,
    'reschedule_cutoff',case when target.status in ('pending','confirmed')
      then ((target.date+target.time) at time zone 'Asia/Kuwait')-make_interval(mins=>target.reschedule_notice_minutes) end);
  end if;
  if p_action<>'appointment-slots' and (
    target.date::text is distinct from p_data->>'expected_date'
    or to_char(target.time,'HH24:MI') is distinct from p_data->>'expected_time'
  ) then raise exception 'BOOKING_CHANGED'; end if;

  if p_action='cancel-booking' then
    update public.bookings set status='cancelled', updated_at=now(), modified_by_type='customer',
      modified_by_user_id=(p_data->>'user_id')::uuid
    where id=target.id returning * into target;
  else
    availability := public.customer_booking('appointment-slots',jsonb_build_object(
      'branch_id',target.branch_id,'barber_id',target.barber_id,'service_ids',target.service_ids,
      'date',requested_date,'exclude_booking_id',target.id,'booked_duration',target.duration,'booked_price',target.price
    ));
    if p_action='appointment-slots' then
      return availability || jsonb_build_object('cutoff',cutoff);
    end if;
    if requested_time is null or not (availability->'slots') ? to_char(requested_time,'HH24:MI')
      or (requested_date+requested_time) at time zone 'Asia/Kuwait' <= clock_timestamp()
    then raise exception 'SLOT_UNAVAILABLE'; end if;

    update public.bookings set date=requested_date,time=requested_time,updated_at=now(),
      modified_by_type='customer',modified_by_user_id=(p_data->>'user_id')::uuid
    where id=target.id returning * into target;
  end if;
  return jsonb_build_object('id',target.id,'date',target.date,'time',to_char(target.time,'HH24:MI'),'status',target.status,
    'cancellation_cutoff',case when target.status in ('pending','confirmed')
      then ((target.date+target.time) at time zone 'Asia/Kuwait')-make_interval(mins=>target.cancel_notice_minutes) end,
    'reschedule_cutoff',case when target.status in ('pending','confirmed')
      then ((target.date+target.time) at time zone 'Asia/Kuwait')-make_interval(mins=>target.reschedule_notice_minutes) end);
exception
  when exclusion_violation or serialization_failure or deadlock_detected then raise exception 'SLOT_UNAVAILABLE';
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then raise exception 'INVALID_REQUEST';
end;
$$;

create or replace function public.customer_account_api(p_action text,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select case
    when p_action='bookings' then coalesce((
      select jsonb_agg(item || jsonb_build_object(
        'location_url',br.location_url, 'shop_address',br.address,
        'cancellation_cutoff', case when item->>'status' in ('confirmed','pending')
          then ((b.date+b.time) at time zone 'Asia/Kuwait')-make_interval(mins=>b.cancel_notice_minutes) end,
        'reschedule_cutoff', case when item->>'status' in ('confirmed','pending')
          then ((b.date+b.time) at time zone 'Asia/Kuwait')-make_interval(mins=>b.reschedule_notice_minutes) end,
        'staff_cancellation', case when item->>'status'='cancelled' and b.staff_cancellation is not null
          then b.staff_cancellation - 'user_id' end
      ) order by ordinal)
      from jsonb_array_elements(private.customer_booking_ratings_api(p_action,p_data)) with ordinality as history(item,ordinal)
      join public.bookings b on b.id=(item->>'id')::uuid
      left join public.branches br on br.id=(item->>'branch_id')::uuid
    ),'[]'::jsonb)
    when p_action='rate-booking' then private.customer_booking_ratings_api(p_action,p_data)
    when p_action in ('appointment-slots','reschedule-booking','cancel-booking') then private.customer_appointment_api(p_action,p_data)
    else private.customer_account_api(p_action,p_data)
  end;
$$;

commit;
