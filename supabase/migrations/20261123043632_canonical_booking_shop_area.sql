-- The selected reference area is authoritative for customer discovery.
create or replace function private.sync_shop_area_city() returns trigger
language plpgsql security definer set search_path='' as $$
declare canonical_city text;
begin
  select a.name_en into canonical_city from public.areas a where a.id=new.area_id;
  if found then new.city:=canonical_city; end if;
  return new;
end $$;
revoke all on function private.sync_shop_area_city() from public,anon,authenticated,service_role;

create trigger sync_shop_area_city before insert or update of area_id,city on public.branches
for each row execute function private.sync_shop_area_city();

-- Updating only the legacy city preserves the shop's ID, name and booking history.
update public.branches b set city=a.name_en
from public.areas a where a.id=b.area_id and a.governorate_id=b.governorate_id
  and b.city is distinct from a.name_en and b.name=btrim(b.name)
  and char_length(b.name) between 1 and 120 and private.valid_schedule(b.working_hours,false);

create or replace function private.booking_shop_location(p_shop public.branches) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'city',coalesce(a.name_en,nullif(btrim(p_shop.city),'')),
    'city_ar',a.name_ar,
    'area_id',a.id,
    'governorates',case when g.id is not null then jsonb_build_object('id',g.id,'name_en',g.name_en,'name_ar',g.name_ar) end)
  from (values (p_shop.area_id,p_shop.governorate_id)) s(area_id,governorate_id)
  left join public.areas a on a.id=s.area_id
  left join public.governorates g on g.id=coalesce(a.governorate_id,s.governorate_id)
$$;
revoke all on function private.booking_shop_location(public.branches) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.customer_booking_discovery(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  mode text:=coalesce(p_data->>'mode','shop'); v_city text:=trim(coalesce(p_data->>'city',''));
  city_names text[]; governorate_filter integer;
  needle text:=lower(trim(coalesce(p_data->>'query',''))); pattern text;
  account uuid:=nullif(p_data->>'account_user_id','')::uuid; owner uuid;
  target uuid:=nullif(p_data->>'barber_id','')::uuid; shop_id uuid:=nullif(p_data->>'branch_id','')::uuid;
  day date:=nullif(p_data->>'date','')::date; range_from time:=nullif(p_data->>'range_start','')::time; range_to time:=nullif(p_data->>'range_end','')::time;
  cursor jsonb:=nullif(p_data->'cursor','null'::jsonb); fingerprint text; lim integer:=20; rows jsonb; next_cursor jsonb; candidate record; item jsonb; matched boolean; selected public.barbers%rowtype; shop public.branches%rowtype; location jsonb;
begin
  if account is not null then
    if not public.customer_session_is_live(account,(p_data->>'session_id')::uuid) then raise exception 'AUTH_REQUIRED'; end if;
    select customer_id into owner from private.customer_accounts where user_id=account;
  end if;
  if p_action='entry' then
    if p_data->>'kind' not in ('shop','barber') or p_data->>'kind' is null then raise exception 'INVALID_REQUEST';end if;
    if p_data->>'kind'='barber' then
      select * into selected from public.barbers where id=target and status='active' and (account is null or user_id is distinct from account);
      select * into shop from public.branches where id=selected.branch_id and status='active' and publication_state='published' and private.billing_shop_access(id,false);
      if selected.id is null or shop.id is null or not private.booking_provider_ready(selected,shop) then raise exception 'INVALID_SELECTION';end if;
    else
      select * into shop from public.branches where id=shop_id and status='active' and publication_state='published' and private.billing_shop_access(id,false);
      if shop.id is null or not exists(select 1 from public.barbers b where b.branch_id=shop.id and b.status='active'
        and(account is null or b.user_id is distinct from account)and private.booking_provider_ready(b,shop))then raise exception 'INVALID_SELECTION';end if;
    end if;
    location := private.booking_shop_location(shop);
    if location->>'city' is null then raise exception 'INVALID_SELECTION'; end if;
    return jsonb_build_object('kind',p_data->>'kind','branchId',shop.id,'barberId',case when p_data->>'kind'='barber' then selected.id end) || location;
  end if;
  if p_action='filters' then
    select coalesce(jsonb_agg(x order by x->>'city'),'[]') into rows from (
      select distinct jsonb_build_object('city',coalesce(a.name_en,nullif(btrim(br.city),'')),
        'city_ar',a.name_ar,
        'governorates',jsonb_build_object('id',g.id,'name_en',g.name_en,'name_ar',g.name_ar)) x
      from public.branches br left join public.areas a on a.id=br.area_id
        left join public.governorates g on g.id=coalesce(a.governorate_id,br.governorate_id)
      where br.status='active' and br.publication_state='published' and private.billing_shop_access(br.id,false)
        and exists(select 1 from public.barbers b where b.branch_id=br.id and b.status='active'
          and private.booking_provider_ready(b,br))
    ) cities where nullif(x->>'city','') is not null;
    return jsonb_build_object('cities',rows);
  end if;
  if mode not in ('shop','barber','time') or length(v_city)>120 or length(needle)>120 then raise exception 'INVALID_REQUEST'; end if;
  if mode='time' and (day is null or day<(current_timestamp at time zone 'Asia/Kuwait')::date
    or day>(current_timestamp at time zone 'Asia/Kuwait')::date+365 or range_from is null or range_to is null or range_from>range_to) then raise exception 'INVALID_DATE'; end if;
  if p_action='selection' then
    select * into selected from public.barbers where id=target and status='active' and (account is null or user_id is distinct from account);
    select * into shop from public.branches where id=selected.branch_id and status='active' and publication_state='published' and private.billing_shop_access(id,false);
    if selected.id is null or shop.id is null or not private.booking_provider_ready(selected,shop) then raise exception 'INVALID_SELECTION'; end if;
    if mode='time' and not exists(select 1 from private.booking_start_windows(target,day,range_from,range_to) w
      join public.services s on s.branch_id=shop.id and s.id=any(selected.service_ids) and s.status='active' and private.service_duration(selected.id,s.id,s.duration)<=w.free_minutes) then raise exception 'SLOT_UNAVAILABLE'; end if;
    return jsonb_build_object(
      'branches',jsonb_build_array(jsonb_build_object('id',shop.id,'name',shop.name,'name_ar',shop.name_ar,
        'address',shop.address,'image_url',shop.image_url,'location_url',shop.location_url,'rating',private.booking_discovery_rating('shop',shop.id))
        || private.booking_shop_location(shop)),
      'barbers',jsonb_build_array(jsonb_build_object('id',selected.id,'branch_id',shop.id,'name',selected.name,'name_ar',selected.name_ar,
        'avatar_url',selected.avatar_url,'max_booking_days',selected.max_booking_days,'service_ids',selected.service_ids,'service_durations',selected.service_durations,'rating',private.booking_discovery_rating('barber',selected.id))),
      'services',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'branch_id',s.branch_id,'name',s.name,'name_ar',s.name_ar,'duration',private.service_duration(selected.id,s.id,s.duration),'price',s.price) order by s.name,s.id),'[]')
        from public.services s where s.branch_id=shop.id and s.status='active' and s.id=any(selected.service_ids)),
      'maxDuration',case when mode='time' then (select max(free_minutes) from private.booking_start_windows(target,day,range_from,range_to)) else 480 end);
  end if;
  if p_action<>'search' then raise exception 'INVALID_REQUEST'; end if;

  if p_data ?| array['cities','governorate_id'] then
    if jsonb_typeof(p_data->'cities') is distinct from 'array'
      or jsonb_typeof(p_data->'governorate_id') is distinct from 'number'
      or coalesce(p_data->>'governorate_id','') !~ '^[1-9][0-9]{0,9}$'
      or v_city <> '' then
      raise exception 'INVALID_REQUEST';
    end if;
    if (p_data->>'governorate_id')::bigint > 2147483647
      or jsonb_array_length(p_data->'cities') not between 1 and 64
      or exists (
        select 1 from jsonb_array_elements(p_data->'cities') as input(value)
        where jsonb_typeof(value) <> 'string' or length(trim(value #>> '{}')) not between 1 and 120
      ) then
      raise exception 'INVALID_REQUEST';
    end if;
    governorate_filter := (p_data->>'governorate_id')::integer;
    select array_agg(name order by name collate "C") into city_names
    from (select distinct trim(value) as name from jsonb_array_elements_text(p_data->'cities') as input(value)) normalized;
    if exists (
      select 1 from unnest(city_names) as requested(name)
      where not exists (
        select 1 from public.areas area
        where area.governorate_id = governorate_filter and requested.name in (area.name_en,area.name_ar)
      ) and not exists (
        -- The existing filters also expose city names from bookable shops.
        select 1 from public.branches b left join public.areas area on area.id = b.area_id
        where area.id is null and b.governorate_id = governorate_filter
          and btrim(b.city) = requested.name and b.status = 'active' and b.publication_state = 'published'
          and private.billing_shop_access(b.id,false)
          and exists (
            select 1 from public.barbers barber where barber.branch_id = b.id and barber.status = 'active'
              and private.booking_provider_ready(barber,b)
          )
      )
    ) then
      raise exception 'INVALID_REQUEST';
    end if;
    fingerprint := md5(jsonb_build_array(mode,governorate_filter,city_names,needle,shop_id,day,range_from,range_to,account)::text);
  else
    -- Keep in-flight cursors from single-city and All Kuwait searches valid.
    fingerprint:=md5(jsonb_build_array(mode,v_city,needle,shop_id,day,range_from,range_to,account)::text);
  end if;
  if cursor is not null and (jsonb_typeof(cursor)<>'object' or cursor->>'context' is distinct from fingerprint
    or cursor->>'rank' not in ('0','1') or length(cursor->>'name')>250 or nullif(cursor->>'id','') is null) then raise exception 'INVALID_REQUEST'; end if;
  -- Escape wildcard characters; user input is a literal substring search.
  pattern:='%'||replace(replace(replace(needle,'\','\\'),'%','\%'),'_','\_')||'%';
  rows:='[]';
  if mode='shop' and shop_id is null then
    for candidate in
      select br.id,lower(br.name) sort_name,
        case when exists(select 1 from private.customer_favourites f where f.customer_id=owner and f.branch_id=br.id) then 0 else 1 end rank
      from public.branches br left join public.areas a on a.id=br.area_id
      where br.status='active' and br.publication_state='published' and private.billing_shop_access(br.id,false)
        and (case when city_names is null
          then (v_city='' or v_city in (a.name_en,a.name_ar) or (a.id is null and btrim(br.city)=v_city))
          else coalesce(a.governorate_id,br.governorate_id) = governorate_filter
            and (a.name_en=any(city_names) or a.name_ar=any(city_names) or (a.id is null and btrim(br.city)=any(city_names)))
        end)
        and (needle='' or lower(br.name||' '||coalesce(br.name_ar,'')||' '||coalesce(a.name_en,btrim(br.city),'')||' '||coalesce(a.name_ar,'')) like pattern)
        and (cursor is null or (case when exists(select 1 from private.customer_favourites f where f.customer_id=owner and f.branch_id=br.id) then 0 else 1 end,lower(br.name),br.id)
          >((cursor->>'rank')::int,cursor->>'name',(cursor->>'id')::uuid))
      order by rank,sort_name,id
    loop
      select * into shop from public.branches where id=candidate.id;
      if not exists(select 1 from public.barbers b where b.branch_id=shop.id and b.status='active'
        and (account is null or b.user_id is distinct from account) and private.booking_provider_ready(b,shop)) then continue; end if;
      item:=jsonb_build_object('id',shop.id,'name',shop.name,'name_ar',shop.name_ar,'image_url',shop.image_url) || private.booking_shop_location(shop);
      rows:=rows||jsonb_build_array(jsonb_build_object('rank',candidate.rank,'name',candidate.sort_name,'id',candidate.id,'item',item));
      exit when jsonb_array_length(rows)>lim;
    end loop;
  else
    for candidate in
      select b.id,br.id branch_id,lower(b.name) sort_name,
        case when exists(select 1 from private.customer_favourites f where f.customer_id=owner and f.barber_id=b.id) then 0 else 1 end rank
      from public.barbers b join public.branches br on br.id=b.branch_id left join public.areas a on a.id=br.area_id
      where b.status='active' and br.status='active' and br.publication_state='published' and private.billing_shop_access(br.id,false) and (account is null or b.user_id is distinct from account)
        and (shop_id is null or br.id=shop_id)
        and (case when city_names is null
          then (v_city='' or v_city in (a.name_en,a.name_ar) or (a.id is null and btrim(br.city)=v_city))
          else coalesce(a.governorate_id,br.governorate_id) = governorate_filter
            and (a.name_en=any(city_names) or a.name_ar=any(city_names) or (a.id is null and btrim(br.city)=any(city_names)))
        end)
        and (needle='' or lower(b.name||' '||coalesce(b.name_ar,'')) like pattern)
        and (mode<>'time' or (day between (current_timestamp at time zone 'Asia/Kuwait')::date and (current_timestamp at time zone 'Asia/Kuwait')::date+b.max_booking_days
          and coalesce(b.availability->lower(trim(to_char(day,'Day')))->>'enabled',b.availability->lower(trim(to_char(day,'Day')))->>'available')='true'
          and not coalesce((br.working_hours->lower(trim(to_char(day,'Day')))->>'closed')::boolean,false)
          and not exists(select 1 from jsonb_array_elements(coalesce(b.vacations,'[]')) v where day between (v->>'startDate')::date and (v->>'endDate')::date)))
        and (cursor is null or (case when exists(select 1 from private.customer_favourites f where f.customer_id=owner and f.barber_id=b.id) then 0 else 1 end,lower(b.name),b.id)
          >((cursor->>'rank')::int,cursor->>'name',(cursor->>'id')::uuid))
      order by rank,sort_name,b.id
    loop
      select * into selected from public.barbers where id=candidate.id;
      select * into shop from public.branches where id=candidate.branch_id;
      if not private.booking_provider_ready(selected,shop) then continue; end if;
      if mode='time' then
        select exists(select 1 from private.booking_start_windows(selected.id,day,range_from,range_to) w
          join public.services s on s.branch_id=shop.id and s.id=any(selected.service_ids) and s.status='active' and private.service_duration(selected.id,s.id,s.duration)<=w.free_minutes) into matched;
        if not matched then continue; end if;
      end if;
      item:=jsonb_build_object('id',selected.id,'branch_id',shop.id,'name',selected.name,'name_ar',selected.name_ar,'avatar_url',selected.avatar_url,
        'shop_name',shop.name,'shop_name_ar',shop.name_ar) || private.booking_shop_location(shop);
      rows:=rows||jsonb_build_array(jsonb_build_object('rank',candidate.rank,'name',candidate.sort_name,'id',candidate.id,'item',item));
      exit when jsonb_array_length(rows)>lim;
    end loop;
  end if;
  if jsonb_array_length(rows)>lim then next_cursor:=(rows->(lim-1))-'item'||jsonb_build_object('context',fingerprint); end if;
  select coalesce(jsonb_agg((r->'item')||jsonb_build_object('rating',private.booking_discovery_rating(case when mode='shop' and shop_id is null then 'shop' else 'barber' end,(r->>'id')::uuid)) order by ord),'[]') into rows
    from jsonb_array_elements(rows) with ordinality x(r,ord) where ord<=lim;
  return jsonb_build_object('items',rows,'nextCursor',next_cursor,'kind',case when mode='shop' and shop_id is null then 'shop' else 'barber' end);
end;
$function$;
