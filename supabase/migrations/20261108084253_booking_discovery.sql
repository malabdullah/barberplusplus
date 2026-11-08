-- Discovery and checkout share approved schedules. None of these APIs expose
-- customer contacts, staff emails, raw calendars or other customers' bookings.
create extension if not exists pg_trgm with schema extensions;
create index branches_discovery_city on public.branches(city, name, id) where status='active' and publication_state='published';
create index branches_discovery_name on public.branches using gin ((lower(name || ' ' || coalesce(name_ar,'') || ' ' || coalesce(city,''))) extensions.gin_trgm_ops) where status='active' and publication_state='published';
create index barbers_discovery_name on public.barbers using gin ((lower(name || ' ' || coalesce(name_ar,''))) extensions.gin_trgm_ops) where status='active';
create index barbers_discovery_order on public.barbers(lower(name), id) where status='active';
create index services_discovery_active on public.services(branch_id, id) include(duration) where status='active';

create or replace function private.booking_start_windows(p_barber uuid, p_date date,
  p_from time default '00:00', p_to time default '23:59', p_exclude uuid default null)
returns table(start_time time, free_minutes integer)
language plpgsql stable security definer set search_path='' as $$
declare
  barber public.barbers%rowtype; shop public.branches%rowtype;
  day text:=lower(trim(to_char(p_date,'Day'))); schedule jsonb; hours jsonb;
  first_time timestamp; last_time timestamp; candidate timestamp; until_time timestamp;
  occupied tsrange[]; block tsrange; today date:=(current_timestamp at time zone 'Asia/Kuwait')::date;
begin
  select * into barber from public.barbers where id=p_barber and status='active';
  if not found or p_date<today or p_date>today+barber.max_booking_days or p_from>p_to then return; end if;
  select * into shop from public.branches where id=barber.branch_id and status='active' and publication_state='published';
  if not found then return; end if;
  schedule:=barber.availability->day; hours:=shop.working_hours->day;
  if not coalesce((schedule->>'enabled')::boolean,(schedule->>'available')::boolean,false)
    or coalesce((hours->>'closed')::boolean,false) or hours->>'open' is null or hours->>'close' is null
    or schedule->>'start' is null or schedule->>'end' is null
    or exists(select 1 from jsonb_array_elements(coalesce(barber.vacations,'[]')) v
      where p_date between (v->>'startDate')::date and (v->>'endDate')::date) then return; end if;
  first_time:=p_date+greatest((schedule->>'start')::time,(hours->>'open')::time);
  last_time:=p_date+least((schedule->>'end')::time,(hours->>'close')::time);
  if first_time>=last_time then return; end if;
  select array_agg(span) into occupied from (
    select tsrange(b.date+b.time,b.date+b.time+b.duration*interval '1 minute','[)') span
    from public.bookings b where b.barber_id=p_barber and b.date=p_date
      and b.status not in ('cancelled','no_show') and b.id is distinct from p_exclude
    union all
    select tsrange(p_date+(v->>'start')::time,p_date+(v->>'end')::time,'[)')
    from jsonb_array_elements(coalesce(barber.time_offs,'[]')) v
    where (v->>'type'='one-time' and v->>'date'=p_date::text)
       or (v->>'type'='recurring' and v->>'day'=day)
  ) busy;
  -- Preserve the existing grid: 15 minutes from the later shop/barber opening.
  for candidate in select generate_series(first_time,last_time,interval '15 minutes') loop
    if candidate::time<p_from or candidate::time>p_to or candidate at time zone 'Asia/Kuwait'<=current_timestamp then continue; end if;
    until_time:=last_time;
    foreach block in array coalesce(occupied,'{}'::tsrange[]) loop
      if block @> candidate then until_time:=candidate; exit; end if;
      if lower(block)>candidate then until_time:=least(until_time,lower(block)); end if;
    end loop;
    free_minutes:=least(480,floor(extract(epoch from until_time-candidate)/60)::integer);
    if free_minutes>=5 then start_time:=candidate::time; return next; end if;
  end loop;
end;
$$;
revoke all on function private.booking_start_windows(uuid,date,time,time,uuid) from public,anon,authenticated;
grant execute on function private.booking_start_windows(uuid,date,time,time,uuid) to service_role;

-- Small scoped rating query: one customer's visits have equal aggregate weight.
create or replace function private.booking_discovery_rating(p_kind text,p_target uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when count(*)=0 then null else jsonb_build_object('average',round(avg(score),1),'count',count(*)) end
  from (
    select coalesce(a.customer_id,b.customer_id), avg(case when p_kind='shop' then r.shop_rating else r.barber_rating end) score
    from public.bookings b join private.customer_booking_ratings r on r.booking_id=b.id
      left join private.customer_booking_owners o on o.booking_id=b.id
      left join private.customer_accounts a on a.user_id=o.account_user_id
    where b.status='completed' and case when p_kind='shop' then b.branch_id=p_target else b.barber_id=p_target end
      and coalesce(a.customer_id,b.customer_id) is not null
    group by coalesce(a.customer_id,b.customer_id)
  ) votes;
$$;
revoke all on function private.booking_discovery_rating(text,uuid) from public,anon,authenticated;

create or replace function private.booking_provider_ready(p_barber public.barbers,p_shop public.branches)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.services s where s.id=any(p_barber.service_ids)
    and s.branch_id=p_shop.id and s.status='active' and s.duration between 5 and 480
    and exists(select 1 from jsonb_each(p_barber.availability) d
      where coalesce((d.value->>'enabled')::boolean,(d.value->>'available')::boolean,false)
        and not coalesce((p_shop.working_hours->d.key->>'closed')::boolean,false)
        and p_shop.working_hours->d.key->>'open' is not null and p_shop.working_hours->d.key->>'close' is not null
        and extract(epoch from (least((d.value->>'end')::time,(p_shop.working_hours->d.key->>'close')::time)
          -greatest((d.value->>'start')::time,(p_shop.working_hours->d.key->>'open')::time)))/60>=s.duration));
$$;
revoke all on function private.booking_provider_ready(public.barbers,public.branches) from public,anon,authenticated;

create or replace function private.customer_booking_discovery(p_action text,p_data jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  mode text:=coalesce(p_data->>'mode','shop'); city text:=trim(coalesce(p_data->>'city',''));
  needle text:=lower(trim(coalesce(p_data->>'query',''))); pattern text;
  account uuid:=nullif(p_data->>'account_user_id','')::uuid; owner uuid;
  target uuid:=nullif(p_data->>'barber_id','')::uuid; shop_id uuid:=nullif(p_data->>'branch_id','')::uuid;
  day date:=nullif(p_data->>'date','')::date; range_from time:=nullif(p_data->>'range_start','')::time; range_to time:=nullif(p_data->>'range_end','')::time;
  cursor jsonb:=p_data->'cursor'; fingerprint text; lim integer:=20; rows jsonb; next_cursor jsonb; selected public.barbers%rowtype; shop public.branches%rowtype;
begin
  if account is not null then
    if not public.customer_session_is_live(account,(p_data->>'session_id')::uuid) then raise exception 'AUTH_REQUIRED'; end if;
    select customer_id into owner from private.customer_accounts where user_id=account;
  end if;
  if p_action='filters' then
    select coalesce(jsonb_agg(x order by x->>'city'),'[]') into rows from (
      select distinct jsonb_build_object('city',coalesce(nullif(trim(br.city),''),a.name_en),
        'city_ar',case when nullif(trim(br.city),'') is null or br.city=a.name_en then a.name_ar else null end,
        'governorates',jsonb_build_object('id',g.id,'name_en',g.name_en,'name_ar',g.name_ar)) x
      from public.branches br left join public.areas a on a.id=br.area_id
        left join public.governorates g on g.id=coalesce(br.governorate_id,a.governorate_id)
      where br.status='active' and br.publication_state='published'
        and exists(select 1 from public.barbers b where b.branch_id=br.id and b.status='active'
          and private.booking_provider_ready(b,br))
    ) cities where nullif(x->>'city','') is not null;
    return jsonb_build_object('cities',rows);
  end if;
  if mode not in ('shop','barber','time') or length(city)>120 or length(needle)>120 then raise exception 'INVALID_REQUEST'; end if;
  if mode='time' and (day is null or day<(current_timestamp at time zone 'Asia/Kuwait')::date
    or day>(current_timestamp at time zone 'Asia/Kuwait')::date+365 or range_from is null or range_to is null or range_from>range_to) then raise exception 'INVALID_DATE'; end if;
  if p_action='selection' then
    select * into selected from public.barbers where id=target and status='active' and (account is null or user_id is distinct from account);
    select * into shop from public.branches where id=selected.branch_id and status='active' and publication_state='published';
    if selected.id is null or shop.id is null or not private.booking_provider_ready(selected,shop) then raise exception 'INVALID_SELECTION'; end if;
    if mode='time' and not exists(select 1 from private.booking_start_windows(target,day,range_from,range_to) w
      join public.services s on s.branch_id=shop.id and s.id=any(selected.service_ids) and s.status='active' and s.duration<=w.free_minutes) then raise exception 'SLOT_UNAVAILABLE'; end if;
    return jsonb_build_object(
      'branches',jsonb_build_array(jsonb_build_object('id',shop.id,'name',shop.name,'name_ar',shop.name_ar,
        'city',coalesce(nullif(trim(shop.city),''),(select name_en from public.areas where id=shop.area_id)),
        'address',shop.address,'image_url',shop.image_url,'location_url',shop.location_url,'rating',private.booking_discovery_rating('shop',shop.id))),
      'barbers',jsonb_build_array(jsonb_build_object('id',selected.id,'branch_id',shop.id,'name',selected.name,'name_ar',selected.name_ar,
        'avatar_url',selected.avatar_url,'max_booking_days',selected.max_booking_days,'service_ids',selected.service_ids,'rating',private.booking_discovery_rating('barber',selected.id))),
      'services',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'branch_id',s.branch_id,'name',s.name,'name_ar',s.name_ar,'duration',s.duration,'price',s.price) order by s.name,s.id),'[]')
        from public.services s where s.branch_id=shop.id and s.status='active' and s.id=any(selected.service_ids)),
      'maxDuration',case when mode='time' then (select max(free_minutes) from private.booking_start_windows(target,day,range_from,range_to)) else 480 end);
  end if;
  if p_action<>'search' then raise exception 'INVALID_REQUEST'; end if;
  fingerprint:=md5(jsonb_build_array(mode,city,needle,shop_id,day,range_from,range_to,account)::text);
  if cursor is not null and (jsonb_typeof(cursor)<>'object' or cursor->>'context' is distinct from fingerprint
    or cursor->>'rank' not in ('0','1') or length(cursor->>'name')>250 or nullif(cursor->>'id','') is null) then raise exception 'INVALID_REQUEST'; end if;
  -- Escape wildcard characters; user input is a literal substring search.
  pattern:='%'||replace(replace(replace(needle,'\','\\'),'%','\%'),'_','\_')||'%';
  if mode='shop' and shop_id is null then
    with candidates as (
      select br.id,br.name,lower(br.name) sort_name,
        case when exists(select 1 from private.customer_favourites f where f.customer_id=owner and f.branch_id=br.id) then 0 else 1 end rank,
        jsonb_build_object('id',br.id,'name',br.name,'name_ar',br.name_ar,'image_url',br.image_url,'city',coalesce(nullif(trim(br.city),''),a.name_en)) item
      from public.branches br left join public.areas a on a.id=br.area_id
      where br.status='active' and br.publication_state='published'
        and (city='' or br.city=city or (nullif(trim(br.city),'') is null and a.name_en=city))
        and (needle='' or lower(br.name||' '||coalesce(br.name_ar,'')||' '||coalesce(br.city,'')) like pattern)
        and exists(select 1 from public.barbers b where b.branch_id=br.id and b.status='active'
          and (account is null or b.user_id is distinct from account) and private.booking_provider_ready(b,br))
    ), page as (
      select * from candidates where cursor is null or (rank,sort_name,id)>((cursor->>'rank')::int,cursor->>'name',(cursor->>'id')::uuid)
      order by rank,sort_name,id limit lim+1
    ) select coalesce(jsonb_agg(jsonb_build_object('rank',rank,'name',sort_name,'id',id,'item',item) order by rank,sort_name,id),'[]') into rows from page;
  else
    with candidates as (
      select b.id,lower(b.name) sort_name,
        case when exists(select 1 from private.customer_favourites f where f.customer_id=owner and f.barber_id=b.id) then 0 else 1 end rank,
        jsonb_build_object('id',b.id,'branch_id',br.id,'name',b.name,'name_ar',b.name_ar,'avatar_url',b.avatar_url,
          'shop_name',br.name,'shop_name_ar',br.name_ar,'city',coalesce(nullif(trim(br.city),''),a.name_en)) item
      from public.barbers b join public.branches br on br.id=b.branch_id left join public.areas a on a.id=br.area_id
      where b.status='active' and br.status='active' and br.publication_state='published' and (account is null or b.user_id is distinct from account)
        and (shop_id is null or br.id=shop_id)
        and (city='' or br.city=city or (nullif(trim(br.city),'') is null and a.name_en=city))
        and (needle='' or lower(b.name||' '||coalesce(b.name_ar,'')) like pattern)
        and private.booking_provider_ready(b,br)
        and (mode<>'time' or exists(select 1 from private.booking_start_windows(b.id,day,range_from,range_to) w
          join public.services s on s.branch_id=br.id and s.id=any(b.service_ids) and s.status='active' and s.duration<=w.free_minutes))
    ), page as (
      select * from candidates where cursor is null or (rank,sort_name,id)>((cursor->>'rank')::int,cursor->>'name',(cursor->>'id')::uuid)
      order by rank,sort_name,id limit lim+1
    ) select coalesce(jsonb_agg(jsonb_build_object('rank',rank,'name',sort_name,'id',id,'item',item) order by rank,sort_name,id),'[]') into rows from page;
  end if;
  if jsonb_array_length(rows)>lim then next_cursor:=(rows->(lim-1))-'item'||jsonb_build_object('context',fingerprint); end if;
  select coalesce(jsonb_agg((r->'item')||jsonb_build_object('rating',private.booking_discovery_rating(case when mode='shop' and shop_id is null then 'shop' else 'barber' end,(r->>'id')::uuid)) order by ord),'[]') into rows
    from jsonb_array_elements(rows) with ordinality x(r,ord) where ord<=lim;
  return jsonb_build_object('items',rows,'nextCursor',next_cursor,'kind',case when mode='shop' and shop_id is null then 'shop' else 'barber' end);
end;
$$;
revoke all on function private.customer_booking_discovery(text,jsonb) from public,anon,authenticated;
create or replace function public.customer_booking_discovery(p_action text,p_data jsonb default '{}') returns jsonb
language sql stable security invoker set search_path='' as $$select private.customer_booking_discovery(p_action,p_data);$$;
revoke all on function public.customer_booking_discovery(text,jsonb) from public,anon,authenticated;
grant execute on function public.customer_booking_discovery(text,jsonb),private.customer_booking_discovery(text,jsonb) to service_role;

-- Replace only the availability expression; preserve all booking ownership,
-- locks, idempotency, policy and phone checks in the installed routine.
do $patch$
declare definition text; before text:=$before$        select coalesce(jsonb_agg(to_char(s, 'HH24:MI') order by s), '[]'::jsonb) into v_slots
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
          );$before$; after text:=$after$        select coalesce(jsonb_agg(to_char(v_date + w.start_time, 'HH24:MI') order by w.start_time), '[]'::jsonb) into v_slots
        from private.booking_start_windows(v_barber.id, v_date, '00:00'::time, '23:59'::time,
          case when p_action='appointment-slots' then (p_data->>'exclude_booking_id')::uuid else null end) w
        where w.free_minutes >= v_duration;$after$;
begin
  definition:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure);
  if position(before in definition)=0 then raise exception 'Booking availability contract changed'; end if;
  execute replace(definition,before,after);
end;
$patch$;
