begin;

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
        'today', v_today, 'last_date', v_today + v_barber.max_booking_days);
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

create function private.customer_appointment_api(p_action text, p_data jsonb) returns jsonb
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

  cutoff := (target.date + target.time) at time zone 'Asia/Kuwait';
  if p_action='cancel-booking' and target.status='cancelled' then
    return jsonb_build_object('id',target.id,'date',target.date,'time',to_char(target.time,'HH24:MI'),'status',target.status,
    'cancellation_cutoff',case when target.status in ('pending','confirmed') then (target.date+target.time) at time zone 'Asia/Kuwait' end);
  end if;
  if target.status is null or target.status not in ('confirmed','pending') or cutoff<=clock_timestamp() then
    raise exception 'BOOKING_NOT_MANAGEABLE';
  end if;

  if p_action in ('appointment-slots','reschedule-booking') then
    requested_date := coalesce((p_data->>'date')::date,(clock_timestamp() at time zone 'Asia/Kuwait')::date);
    requested_time := (p_data->>'time')::time;
  end if;

  if p_action='reschedule-booking' and target.date=requested_date and target.time=requested_time then
    return jsonb_build_object('id',target.id,'date',target.date,'time',to_char(target.time,'HH24:MI'),'status',target.status,
    'cancellation_cutoff',case when target.status in ('pending','confirmed') then (target.date+target.time) at time zone 'Asia/Kuwait' end);
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
    'cancellation_cutoff',case when target.status in ('pending','confirmed') then (target.date+target.time) at time zone 'Asia/Kuwait' end);
exception
  when exclusion_violation or serialization_failure or deadlock_detected then raise exception 'SLOT_UNAVAILABLE';
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then raise exception 'INVALID_REQUEST';
end;
$$;
revoke all on function private.customer_appointment_api(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.customer_appointment_api(text,jsonb) to service_role;

create or replace function public.customer_account_api(p_action text,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select case
    when p_action='bookings' then coalesce((
      select jsonb_agg(item || jsonb_build_object(
        'location_url',br.location_url, 'shop_address',br.address,
        'cancellation_cutoff', case when item->>'status' in ('confirmed','pending')
          then ((item->>'date')::date + (item->>'time')::time) at time zone 'Asia/Kuwait' end
      ) order by ordinal)
      from jsonb_array_elements(private.customer_booking_ratings_api(p_action,p_data)) with ordinality as history(item,ordinal)
      left join public.branches br on br.id=(item->>'branch_id')::uuid
    ),'[]'::jsonb)
    when p_action='rate-booking' then private.customer_booking_ratings_api(p_action,p_data)
    when p_action in ('appointment-slots','reschedule-booking','cancel-booking') then private.customer_appointment_api(p_action,p_data)
    else private.customer_account_api(p_action,p_data)
  end;
$$;

commit;
