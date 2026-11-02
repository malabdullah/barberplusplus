-- Read-only checks for every barber in the hosted Test catalog fixture.
begin read only;
set local statement_timeout='60s';
do $verify$
declare
  b public.barbers%rowtype; data jsonb; result jsonb; off_day text; d date; day_key text;
  open_date date; training jsonb; block jsonb; slot text; start_time time; duration integer;
  total_duration integer; total_price numeric; unavailable uuid; tested integer:=0;
  today date:=(current_timestamp at time zone 'Asia/Kuwait')::date;
begin
  if to_regclass('private.cloud_test_emails') is null then raise exception 'Test only';end if;
  if (select count(*) from public.branches where id::text like 'b6110203-%')<>60 then raise exception 'Expected 60 fixture shops';end if;
  if exists(select 1 from public.branches br where br.id::text like 'b6110203-%'
    and ((select count(*) from public.barbers where branch_id=br.id)<>3
      or (select count(*) from public.services where branch_id=br.id)<>6
      or not exists(select 1 from auth.users u where u.id=br.manager_id and u.raw_app_meta_data->>'role'='manager'))) then
    raise exception 'Shop staffing, service or manager mismatch';
  end if;
  if exists(select 1 from public.branches where id::text like 'b6110203-%' group by governorate_id,city having count(*)<>5) then raise exception 'Expected 5 shops per city';end if;
  if (select count(distinct city) from public.branches where id::text like 'b6110203-%')<>12 then raise exception 'Expected 12 cities';end if;
  for b in select * from public.barbers where id::text like 'b6110205-%' order by id loop
    if cardinality(b.service_ids)<>3 or jsonb_array_length(b.vacations)<>1 or jsonb_array_length(b.time_offs)<>7
      or not exists(select 1 from auth.users u join auth.identities i on i.user_id=u.id and i.provider='email'
        where u.id=b.user_id and u.raw_app_meta_data->>'role'='barber' and u.email_confirmed_at is not null) then
      raise exception 'Barber fixture incomplete: %',b.id;
    end if;
    select key into strict off_day from jsonb_each(b.availability) where (value->>'enabled')::boolean=false;
    select x::date into open_date from generate_series(today+1,today+5,interval '1 day') x
      where (b.availability->lower(trim(to_char(x,'Day')))->>'enabled')::boolean
      order by x limit 1;
    data:=jsonb_build_object('branch_id',b.branch_id,'barber_id',b.id,'service_ids',jsonb_build_array(b.service_ids[1]),'date',open_date);
    result:=public.customer_booking('slots',data);
    if jsonb_array_length(result->'slots')=0 then raise exception 'No normal working slots for %',b.id;end if;
    duration:=(result->>'duration')::integer;day_key:=lower(trim(to_char(open_date,'Day')));
    for slot in select jsonb_array_elements_text(result->'slots') loop
      start_time:=slot::time;
      if start_time<(b.availability->day_key->>'start')::time
         or open_date+start_time+duration*interval '1 minute'>open_date+(b.availability->day_key->>'end')::time then
        raise exception 'Working-hour boundary bypass for %',b.id;
      end if;
      for block in select x from jsonb_array_elements(b.time_offs) x
        where (x->>'type'='recurring' and x->>'day'=day_key) or (x->>'type'='one-time' and (x->>'date')::date=open_date) loop
        if tsrange(open_date+start_time,open_date+start_time+duration*interval '1 minute','[)')
          && tsrange(open_date+(block->>'start')::time,open_date+(block->>'end')::time,'[)') then
          raise exception 'Time-off overlap for %',b.id;
        end if;
      end loop;
    end loop;
    select x into strict training from jsonb_array_elements(b.time_offs) x where x->>'type'='one-time';
    d:=(training->>'date')::date;result:=public.customer_booking('slots',data||jsonb_build_object('date',d));
    if exists(select 1 from jsonb_array_elements_text(result->'slots') s
      where tsrange(d+s::time,d+s::time+duration*interval '1 minute','[)')
        && tsrange(d+(training->>'start')::time,d+(training->>'end')::time,'[)')) then
      raise exception 'One-time training bypass for %',b.id;
    end if;
    d:=(b.vacations->0->>'startDate')::date;
    if jsonb_array_length(public.customer_booking('slots',data||jsonb_build_object('date',d))->'slots')<>0 then raise exception 'Vacation bypass for %',b.id;end if;
    select x::date into d from generate_series(today+1,today+7,interval '1 day') x where lower(trim(to_char(x,'Day')))=off_day limit 1;
    if jsonb_array_length(public.customer_booking('slots',data||jsonb_build_object('date',d))->'slots')<>0 then raise exception 'Weekly day-off bypass for %',b.id;end if;
    begin
      perform public.customer_booking('slots',data||jsonb_build_object('date',today+b.max_booking_days+1));
      raise exception 'Booking window accepted invalid date';
    exception when raise_exception then if sqlerrm<>'INVALID_DATE' then raise;end if;end;
    select id into unavailable from public.services where branch_id=b.branch_id and not(id=any(b.service_ids)) limit 1;
    begin
      perform public.customer_booking('slots',data||jsonb_build_object('service_ids',jsonb_build_array(unavailable)));
      raise exception 'Unassigned service was accepted';
    exception when raise_exception then if sqlerrm<>'INVALID_SELECTION' then raise;end if;end;
    select sum(s.duration),sum(s.price) into total_duration,total_price from public.services s where s.id=any(b.service_ids);
    result:=public.customer_booking('slots',data||jsonb_build_object('service_ids',to_jsonb(b.service_ids)));
    if (result->>'duration')::integer<>total_duration or (result->>'price')::numeric<>total_price then raise exception 'Service total mismatch for %',b.id;end if;
    tested:=tested+1;
  end loop;
  if tested<>180 then raise exception 'Expected 180 barbers';end if;
end;
$verify$;
select jsonb_build_object('barbersVerified',180,'shopsVerified',60,'citiesVerified',12,
  'workingHours',true,'recurringBreaks',true,'oneTimeTimeOff',true,'vacations',true,'weeklyDaysOff',true,
  'bookingWindows',true,'serviceAssignments',true,'combinedServiceTotals',true,'staffAccountsLinked',true) as availability_report;
rollback;
