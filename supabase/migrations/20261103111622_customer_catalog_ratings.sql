begin;

create function public.customer_catalog_ratings() returns jsonb
language sql stable security definer set search_path='' as $$
  with votes as (
    select b.branch_id, b.barber_id,
      coalesce(a.customer_id, b.customer_id) as customer_id,
      r.shop_rating, r.barber_rating
    from private.customer_booking_ratings r
    join public.bookings b on b.id=r.booking_id
    left join private.customer_booking_owners o on o.booking_id=b.id
    left join private.customer_accounts a on a.user_id=o.account_user_id
    where b.status='completed'
      and coalesce(a.customer_id, b.customer_id) is not null
  ), per_customer as (
    -- Give each customer equal weight, even if they rated several visits.
    select target.kind, target.id, v.customer_id, avg(target.score) as average
    from votes v
    cross join lateral (values
      ('shop', v.branch_id, v.shop_rating),
      ('barber', v.barber_id, v.barber_rating)
    ) as target(kind, id, score)
    where target.id is not null
    group by target.kind, target.id, v.customer_id
  ), per_target as (
    select kind, id, round(avg(average), 1) as average, count(*) as count
    from per_customer
    group by kind, id
  )
  select jsonb_build_object(
    'shops', coalesce(jsonb_object_agg(id, jsonb_build_object('average', average, 'count', count))
      filter (where kind='shop'), '{}'::jsonb),
    'barbers', coalesce(jsonb_object_agg(id, jsonb_build_object('average', average, 'count', count))
      filter (where kind='barber'), '{}'::jsonb)
  )
  from per_target;
$$;

revoke all on function public.customer_catalog_ratings() from public, anon, authenticated, service_role;
grant execute on function public.customer_catalog_ratings() to service_role;

commit;
