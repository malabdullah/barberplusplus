begin;

create table private.customer_booking_ratings (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  shop_rating smallint not null check (shop_rating between 1 and 5),
  barber_rating smallint not null check (barber_rating between 1 and 5)
);
alter table private.customer_booking_ratings enable row level security;
revoke all on private.customer_booking_ratings from public, anon, authenticated, service_role;

create function private.customer_booking_ratings_api(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  history jsonb;
  target uuid;
  shop_score smallint;
  barber_score smallint;
begin
  if p_action not in ('bookings', 'rate-booking') then raise exception 'INVALID_RATING'; end if;
  if p_action='rate-booking' then
    if jsonb_typeof(p_data->'shop_rating') is distinct from 'number'
      or jsonb_typeof(p_data->'barber_rating') is distinct from 'number'
      or coalesce(p_data->>'shop_rating', '') !~ '^[1-5]$'
      or coalesce(p_data->>'barber_rating', '') !~ '^[1-5]$'
      or coalesce(p_data->>'booking_id', '') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then raise exception 'INVALID_RATING'; end if;
    target := (p_data->>'booking_id')::uuid;
    shop_score := (p_data->>'shop_rating')::smallint;
    barber_score := (p_data->>'barber_rating')::smallint;
  end if;

  -- Use the same live-session and ownership checks as customer booking history,
  -- including linked social accounts, claimed guest bookings and legacy accounts.
  history := private.customer_account_api('bookings', p_data);
  if jsonb_typeof(history) is distinct from 'array' then raise exception 'AUTH_REQUIRED'; end if;

  if p_action='bookings' then
    return (
      select coalesce(jsonb_agg(item || jsonb_build_object('shop_rating', r.shop_rating, 'barber_rating', r.barber_rating) order by position), '[]'::jsonb)
      from jsonb_array_elements(history) with ordinality as entries(item, position)
      left join private.customer_booking_ratings r on r.booking_id=(item->>'id')::uuid
    );
  end if;

  if not exists (select 1 from jsonb_array_elements(history) item where item->>'id'=target::text) then
    raise exception 'BOOKING_NOT_RATEABLE';
  end if;
  perform 1 from public.bookings b
    where b.id=target and b.status='completed'
      and ((b.date + b.time + coalesce(b.duration, 0) * interval '1 minute') at time zone 'Asia/Kuwait') <= now()
    for no key update;
  if not found then raise exception 'BOOKING_NOT_RATEABLE'; end if;

  insert into private.customer_booking_ratings(booking_id, shop_rating, barber_rating)
    values(target, shop_score, barber_score)
    on conflict (booking_id) do update set
      shop_rating=excluded.shop_rating, barber_rating=excluded.barber_rating;
  return jsonb_build_object('shop_rating',shop_score,'barber_rating',barber_score);
end;
$$;
revoke all on function private.customer_booking_ratings_api(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.customer_booking_ratings_api(text,jsonb) to service_role;

create or replace function public.customer_account_api(p_action text,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select case when p_action in ('bookings', 'rate-booking')
    then private.customer_booking_ratings_api(p_action,p_data)
    else private.customer_account_api(p_action,p_data)
  end;
$$;

commit;
