-- Only the service gateway can associate a booking with a live customer session.
create function private.record_customer_booking_owner(p_booking uuid,p_account uuid,p_session uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists (
    select 1 from private.customer_accounts a
    join auth.sessions s on s.id=p_session
    join auth.users u on u.id=s.user_id
    where a.user_id=p_account and u.raw_app_meta_data->>'role'='customer'
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
      and (s.user_id=a.user_id or exists(select 1 from private.customer_social_identities i where i.user_id=s.user_id and i.account_user_id=a.user_id))
  ) then raise exception 'AUTH_REQUIRED'; end if;
  insert into private.customer_booking_owners(booking_id,account_user_id) values(p_booking,p_account)
  on conflict(booking_id) do nothing;
  if not exists(select 1 from private.customer_booking_owners where booking_id=p_booking and account_user_id=p_account) then
    raise exception 'INVALID_REQUEST';
  end if;
end;
$$;
revoke all on function private.record_customer_booking_owner(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.record_customer_booking_owner(uuid,uuid,uuid) to service_role;
alter function private.record_customer_booking_owner(uuid,uuid,uuid) owner to postgres;

create or replace function public.customer_booking(p_action text, p_data jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
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
  if p_action not in ('slots', 'book') or p_action is null then
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
    if p_action = 'slots' then
      return jsonb_build_object('slots', v_slots, 'duration', v_duration, 'price', v_price,
        'today', v_today, 'last_date', v_today + v_barber.max_booking_days);
    end if;
    v_time := (p_data ->> 'time')::time;
    if v_time is null or not v_slots ? to_char(v_date + v_time, 'HH24:MI') then
      raise exception 'SLOT_UNAVAILABLE';
    end if;
    -- No existing customer information is exposed or overwritten by this flow.
    insert into public.customers (name, country_code, phone, preferred_branch_id, preferred_barber_id, created_by_type)
      values (v_name, v_code, v_phone, v_branch.id, v_barber.id, 'customer')
      on conflict (country_code, phone) do nothing;
    select id into v_customer from public.customers where country_code = v_code and phone = v_phone and status = 'active';
    if v_customer is null then raise exception 'BOOKING_UNAVAILABLE'; end if;
    insert into public.bookings (id, branch_id, barber_id, service_ids, customer_id, date, time,
      duration, price, status, notes, added_by_type)
    values (v_id, v_branch.id, v_barber.id, v_services, v_customer, v_date, v_time,
      v_duration, v_price, 'confirmed', nullif(trim(p_data ->> 'notes'), ''), 'system') returning * into v_booking;
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
$$;

create or replace function private.customer_account_api(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  challenge private.customer_auth_challenges%rowtype;
  account private.customer_accounts%rowtype;
  account_user auth.users%rowtype;
  customer_id uuid;
  counter integer;
  valid boolean;
begin
  if p_action in ('social-status','social-link') then
    -- Both the live Auth session and provider identity must belong to this user.
    select u.* into account_user from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=(p_data->>'user_id')::uuid and s.id=(p_data->>'session_id')::uuid
      and u.raw_app_meta_data->>'role'='customer' and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
      and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider in ('google','apple'))
      for update of u;
    if account_user.id is null then raise exception 'AUTH_REQUIRED'; end if;
    select a.* into account from private.customer_accounts a where a.user_id=account_user.id
      or a.user_id=(select account_user_id from private.customer_social_identities where user_id=account_user.id);
    if p_action='social-status' then
      return jsonb_build_object('profile',case when account.user_id is null then null else private.customer_account_api('profile',p_data) end);
    end if;
    if account.user_id is not null then return private.customer_account_api('profile',p_data); end if;
    -- Only a consumed, session-bound phone challenge can attach an identity.
    if not exists(select 1 from private.customer_auth_challenges ch where ch.purpose='social'
      and ch.consumed_at is not null and ch.id=(p_data->>'challenge_id')::uuid
      and ch.payload->>'social_user_id'=account_user.id::text
      and ch.payload->>'social_session_id'=p_data->>'session_id'
      and ch.phone_e164=p_data->>'phone_e164' and ch.expires_at>now()) then raise exception 'INVALID_CODE'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_data->>'phone_e164',0));
    select * into account from private.customer_accounts where phone_e164=p_data->>'phone_e164';
    if account.user_id is null then
      if nullif(account_user.phone,'') is not null and '+'||ltrim(account_user.phone,'+')<>p_data->>'phone_e164' then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
      update auth.users set phone=ltrim(p_data->>'phone_e164','+'),phone_confirmed_at=now() where id=account_user.id;
      perform private.customer_account_api('link',p_data||jsonb_build_object('email',''));
    else
      if exists(select 1 from private.customer_password_reset_guards where user_id=account.user_id) then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
      insert into private.customer_social_identities(user_id,account_user_id) values(account_user.id,account.user_id);
    end if;
    return private.customer_account_api('profile',p_data);
  elsif p_action='limit' then
    if p_data->>'key' !~ '^[0-9a-f]{64}$' or (p_data->>'max')::integer not between 1 and 100 then raise exception 'INVALID_REQUEST'; end if;
    insert into private.customer_auth_limits as l(key) values(p_data->>'key')
    on conflict(key) do update set
      attempts=case when l.window_start < now()-interval '15 minutes' then 1 else l.attempts+1 end,
      window_start=case when l.window_start < now()-interval '15 minutes' then now() else l.window_start end
    returning attempts into counter;
    return to_jsonb(counter <= (p_data->>'max')::integer);
  elsif p_action='issue' then
    delete from private.customer_auth_challenges where expires_at < now()-interval '1 day';
    delete from private.customer_auth_limits where window_start < now()-interval '1 day';
    insert into private.customer_auth_challenges(id,purpose,phone_e164,code_hash,payload)
    values((p_data->>'id')::uuid,p_data->>'purpose',p_data->>'phone_e164',p_data->>'code_hash',p_data->'payload');
    return jsonb_build_object('id',p_data->>'id');
  elsif p_action='lookup' then
    select a.* into account from private.customer_accounts a join auth.users u on u.id=a.user_id
      join public.customers c on c.id=a.customer_id
      where a.phone_e164=p_data->>'phone_e164' and u.raw_app_meta_data->>'role'='customer'
        and u.phone_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) and u.deleted_at is null and '+'||ltrim(u.phone,'+')=a.phone_e164 and c.status='active';
    return case when account.user_id is null then 'null'::jsonb else to_jsonb(account) end;
  elsif p_action='consume' then
    select * into challenge from private.customer_auth_challenges where id=(p_data->>'id')::uuid
      and (purpose<>'social' or (payload->>'social_user_id'=p_data->>'user_id' and payload->>'social_session_id'=p_data->>'session_id')) for update;
    if not found or challenge.purpose is distinct from p_data->>'purpose' or challenge.consumed_at is not null
      or challenge.expires_at <= now() or challenge.attempts >= 5 then return 'null'::jsonb; end if;
    valid := challenge.code_hash is not distinct from p_data->>'code_hash';
    update private.customer_auth_challenges set attempts=attempts+1,consumed_at=case when valid then now() else null end where id=challenge.id;
    if not valid then return 'null'::jsonb; end if;
    if challenge.purpose='recovery' then
      select * into account from private.customer_accounts where phone_e164=challenge.phone_e164;
      select * into account_user from auth.users where id=account.user_id for update;
      if account.user_id is null or account_user.raw_app_meta_data->>'role' is distinct from 'customer'
        or account_user.phone_confirmed_at is null or account_user.banned_until>now() or account_user.deleted_at is not null or '+'||ltrim(account_user.phone,'+') is distinct from challenge.phone_e164
        or not exists(select 1 from public.customers where id=account.customer_id and status='active') then
        return jsonb_build_object('unavailable',true);
      end if;
      insert into private.customer_password_reset_guards(id,user_id) values(challenge.id,account.user_id);
      return challenge.payload||jsonb_build_object('user_id',account.user_id,'guard_id',challenge.id);
    end if;
    return challenge.payload||jsonb_build_object('challenge_id',challenge.id);
  elsif p_action='link' then
    select * into account_user from auth.users where id=(p_data->>'user_id')::uuid for update;
    if account_user.raw_app_meta_data->>'role' is distinct from 'customer' or account_user.phone_confirmed_at is null
      or '+'||ltrim(account_user.phone,'+') is distinct from p_data->>'phone_e164' then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
    if exists(select 1 from public.customers where country_code=p_data->>'country_code' and phone=p_data->>'phone' and status<>'active') then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
    insert into public.customers as c(name,country_code,phone,email,created_by_type)
      values(p_data->>'name',p_data->>'country_code',p_data->>'phone',nullif(p_data->>'email',''),'customer')
      on conflict(country_code,phone) do update set name=excluded.name,email=excluded.email,updated_at=now()
      returning c.id into customer_id;
    insert into private.customer_accounts(user_id,customer_id,name,country_code,phone,phone_e164,email)
      values(account_user.id,customer_id,p_data->>'name',p_data->>'country_code',p_data->>'phone',p_data->>'phone_e164',nullif(p_data->>'email',''));
    return jsonb_build_object('success',true);
  elsif p_action='finish-reset' then
    if not exists(select 1 from private.customer_password_reset_guards where id=(p_data->>'guard_id')::uuid and user_id=(p_data->>'user_id')::uuid) then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
    -- Refresh tokens cascade from sessions; old access tokens also fail the
    -- explicit live-session check below on every customer operation.
    delete from auth.sessions where user_id=(p_data->>'user_id')::uuid or user_id in (select user_id from private.customer_social_identities where account_user_id=(p_data->>'user_id')::uuid);
    delete from private.customer_password_reset_guards where id=(p_data->>'guard_id')::uuid;
    return jsonb_build_object('success',true);
  end if;
  if p_action not in ('profile','update-profile','bookings','logout') then raise exception 'INVALID_REQUEST'; end if;
  select a.* into account from private.customer_accounts a join auth.users u on u.id=a.user_id
    join auth.sessions s on (s.user_id=u.id or exists(select 1 from private.customer_social_identities si where si.user_id=s.user_id and si.account_user_id=u.id))
    join auth.users login_user on login_user.id=s.user_id join public.customers c on c.id=a.customer_id
    where s.user_id=(p_data->>'user_id')::uuid and login_user.raw_app_meta_data->>'role'='customer'
      and login_user.deleted_at is null and (login_user.banned_until is null or login_user.banned_until<=now()) and s.id=(p_data->>'session_id')::uuid
      and u.raw_app_meta_data->>'role'='customer' and u.phone_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) and u.deleted_at is null
      and '+'||ltrim(u.phone,'+')=a.phone_e164 and c.status='active';
  if account.user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action='logout' then
    delete from auth.sessions where id=(p_data->>'session_id')::uuid and user_id=(p_data->>'user_id')::uuid;
    return jsonb_build_object('success',true);
  elsif p_action='update-profile' then
    if length(trim(p_data->>'name')) not between 2 and 120 or length(coalesce(p_data->>'email',''))>254 then raise exception 'INVALID_DETAILS'; end if;
    update private.customer_accounts set name=trim(p_data->>'name'),email=nullif(p_data->>'email','') where user_id=account.user_id returning * into account;
    update public.customers set name=account.name,email=account.email,updated_at=now() where id=account.customer_id;
  elsif p_action='bookings' then
    return (select coalesce(jsonb_agg(row_to_json(b)),'[]'::jsonb) from (
      select b.id,b.date,to_char(b.date+b.time,'HH24:MI') as time,b.duration,b.price,b.status,
        br.name as shop_name,br.name_ar as shop_name_ar,ba.name as barber_name,ba.name_ar as barber_name_ar,
        (select jsonb_agg(jsonb_build_object('name',s.name,'name_ar',s.name_ar)) from public.services s where s.id=any(b.service_ids)) as services
      from public.bookings b join public.branches br on br.id=b.branch_id join public.barbers ba on ba.id=b.barber_id
      where (b.customer_id=account.customer_id and exists(select 1 from auth.users legacy where legacy.id=account.user_id and legacy.phone_confirmed_at is not null))
         or exists(select 1 from private.customer_booking_owners owner where owner.booking_id=b.id and owner.account_user_id=account.user_id)
      order by b.date desc,b.time desc limit 50
    ) b);
  end if;
  return jsonb_build_object('id',account.user_id,'name',account.name,'phone',account.phone,'countryCode',account.country_code,'email',account.email);
end;
$$;
