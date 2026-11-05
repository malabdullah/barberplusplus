begin;

create table private.customer_booking_reviews (
  booking_id uuid primary key references private.customer_booking_ratings(booking_id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.customer_booking_reviews enable row level security;
revoke all on private.customer_booking_reviews from public, anon, authenticated, service_role;

create or replace function private.customer_booking_ratings_api(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  history jsonb;
  target uuid;
  shop_score smallint;
  barber_score smallint;
  review_text text;
begin
  if p_action not in ('bookings', 'rate-booking') then raise exception 'INVALID_RATING'; end if;
  if p_action='rate-booking' then
    if jsonb_typeof(p_data->'shop_rating') is distinct from 'number'
      or jsonb_typeof(p_data->'barber_rating') is distinct from 'number'
      or coalesce(p_data->>'shop_rating', '') !~ '^[1-5]$'
      or coalesce(p_data->>'barber_rating', '') !~ '^[1-5]$'
      or coalesce(p_data->>'booking_id', '') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then raise exception 'INVALID_RATING'; end if;
    if p_data ? 'review' and jsonb_typeof(p_data->'review') not in ('string','null') then
      raise exception 'INVALID_RATING';
    end if;
    review_text := nullif(btrim(p_data->>'review'), '');
    if char_length(review_text) > 1000 then raise exception 'INVALID_RATING'; end if;
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
      select coalesce(jsonb_agg(item || jsonb_build_object('shop_rating', r.shop_rating, 'barber_rating', r.barber_rating, 'review', v.body) order by position), '[]'::jsonb)
      from jsonb_array_elements(history) with ordinality as entries(item, position)
      left join private.customer_booking_ratings r on r.booking_id=(item->>'id')::uuid
      left join private.customer_booking_reviews v on v.booking_id=r.booking_id
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
  if p_data ? 'review' then
    if review_text is null then
      delete from private.customer_booking_reviews where booking_id=target;
    else
      insert into private.customer_booking_reviews(booking_id, body)
      values(target, review_text)
      on conflict (booking_id) do update set body=excluded.body, updated_at=now();
    end if;
  end if;
  return jsonb_build_object('shop_rating',shop_score,'barber_rating',barber_score,
    'review',(select body from private.customer_booking_reviews where booking_id=target));
end;
$$;

commit;
