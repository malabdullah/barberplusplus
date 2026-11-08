create or replace function private.customer_booking_discovery(p_action text,p_data jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  mode text:=coalesce(p_data->>'mode','shop'); v_city text:=trim(coalesce(p_data->>'city',''));
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
  if mode not in ('shop','barber','time') or length(v_city)>120 or length(needle)>120 then raise exception 'INVALID_REQUEST'; end if;
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
  fingerprint:=md5(jsonb_build_array(mode,v_city,needle,shop_id,day,range_from,range_to,account)::text);
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
        and (v_city='' or br.city=v_city or (nullif(trim(br.city),'') is null and a.name_en=v_city))
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
        and (v_city='' or br.city=v_city or (nullif(trim(br.city),'') is null and a.name_en=v_city))
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
