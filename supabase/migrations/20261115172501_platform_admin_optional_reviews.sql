-- Keep existing deployments without the optional written-review catalog compatible.
begin;
CREATE OR REPLACE FUNCTION public.shop_reviews(p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  viewer uuid := auth.uid();
  viewer_role text;
begin
  perform public.enforce_account_session();
  if private.current_account_session() is null then raise sqlstate 'PT401' using message='SESSION_ENDED'; end if;
  select private.live_staff_role() into viewer_role;
  if viewer_role is null then select raw_app_meta_data->>'role' into viewer_role from auth.users where id=viewer; end if;
  if viewer_role not in ('admin','manager','barber') or viewer_role is null then
    raise exception 'REVIEWS_FORBIDDEN' using errcode='42501';
  end if;
  if p_page is null or p_page<1 or p_page>1000000 then raise exception 'INVALID_PAGE'; end if;
  -- Written reviews remain a separate, unreleased capability.
  if pg_catalog.to_regclass('private.customer_booking_reviews') is null then
    return jsonb_build_object('total',0,'rows','[]'::jsonb);
  end if;

  return (
    with accessible as (
      select v.booking_id,v.body,v.updated_at,r.shop_rating,r.barber_rating,
        b.branch_id,b.barber_id,b.customer_id
      from private.customer_booking_reviews v
      join private.customer_booking_ratings r on r.booking_id=v.booking_id
      join public.bookings b on b.id=v.booking_id
      where b.status='completed' and (
        viewer_role='admin' or
        (viewer_role='manager' and b.branch_id in (select public.get_user_branch_ids())) or
        (viewer_role='barber' and b.barber_id in (select id from public.barbers where user_id=viewer and status='active'))
      )
    ), page as (
      select * from accessible order by updated_at desc,booking_id limit 25 offset (p_page-1)*25
    )
    select jsonb_build_object('total',(select count(*) from accessible),'rows',
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',p.booking_id,'review',p.body,'updated_at',p.updated_at,
        'shop_rating',p.shop_rating,'barber_rating',p.barber_rating,
        'shop',br.name,'shop_ar',br.name_ar,'barber',ba.name,'barber_ar',ba.name_ar,
        'reference',upper(left(replace(p.booking_id::text,'-',''),10))
      ) order by p.updated_at desc,p.booking_id)
      from page p join public.branches br on br.id=p.branch_id join public.barbers ba on ba.id=p.barber_id),'[]'::jsonb)
    )
  );
end;
$function$;
commit;
