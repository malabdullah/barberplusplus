begin;

create table upayments_test.shop_payment_methods (
  shop_id uuid primary key references public.branches(id) on delete cascade,
  method text not null check (method in ('at_shop','online','both'))
);
alter table upayments_test.shop_payment_methods enable row level security;
revoke all on upayments_test.shop_payment_methods from public,anon,authenticated,service_role;

create function upayments_test.shop_online_enabled(p_shop uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from upayments_test.booking_fixture where shop_id=p_shop and enabled)
$$;

create function upayments_test.shop_payment_method(p_shop uuid) returns text
language sql stable set search_path='' as $$
  select coalesce((select method from upayments_test.shop_payment_methods where shop_id=p_shop),
    case when upayments_test.shop_online_enabled(p_shop) then 'both' else 'at_shop' end)
$$;

revoke all on function upayments_test.shop_online_enabled(uuid),upayments_test.shop_payment_method(uuid) from public,anon,authenticated,service_role;

create function public.manage_test_shop_payment_methods(p_shop uuid,p_method text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare available boolean;
begin
  if p_shop is null or not exists (
    select 1 from auth.users u where u.id=auth.uid() and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
      and u.raw_app_meta_data->>'role'='manager'
  ) or not public.staff_factor_satisfied() or not exists (
    select 1 from public.get_user_branch_ids() branch(id) where branch.id=p_shop
  ) then raise exception 'SHOP_PAYMENT_FORBIDDEN' using errcode='42501'; end if;

  available := upayments_test.shop_online_enabled(p_shop);
  if p_method is not null then
    if p_method not in ('at_shop','online','both') or (p_method<>'at_shop' and not available) then
      raise exception 'SHOP_PAYMENT_UNAVAILABLE';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_shop::text,71428));
    insert into upayments_test.shop_payment_methods(shop_id,method) values (p_shop,p_method)
      on conflict(shop_id) do update set method=excluded.method;
  end if;
  return jsonb_build_object('method',upayments_test.shop_payment_method(p_shop),'onlineAvailable',available);
end
$$;
revoke all on function public.manage_test_shop_payment_methods(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.manage_test_shop_payment_methods(uuid,text) to authenticated;

-- Keep existing provider attempts and approved appointments payable after changes.
alter function public.upayments_test_booking(text,uuid,jsonb) rename to booking_with_wallet;
alter function public.booking_with_wallet(text,uuid,jsonb) set schema upayments_test;
revoke all on function upayments_test.booking_with_wallet(text,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.upayments_test_booking(p_action text,p_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='12s' as $$
declare shop uuid; method text; result jsonb;
begin
  if p_action in ('start','request-approval','book-at-shop','slots') then
    shop := (case when p_action in ('start','request-approval') then p_data->'booking' else p_data end->>'branch_id')::uuid;
    if shop is null then raise exception 'INVALID_SELECTION'; end if;
    if p_action<>'slots' then
      perform pg_advisory_xact_lock_shared(hashtextextended(shop::text,71428));
    end if;
    method := upayments_test.shop_payment_method(shop);
    if p_action='book-at-shop' then
      if method='online' and not exists(
        select 1 from public.bookings where id=(p_data->>'id')::uuid and branch_id=shop
          and online_payment_state is null
      ) then raise exception 'SHOP_PAYMENT_CHANGED'; end if;
      return public.native_customer_booking('book',p_data);
    end if;
    if method='at_shop' and (
      (p_action='start' and not exists(select 1 from upayments_test.booking_attempts where id=p_id and shop_id=shop))
      or (p_action='request-approval' and not exists(
        select 1 from public.bookings where id=p_id and branch_id=shop and online_payment_state is not null
      ))
    ) then raise exception 'SHOP_PAYMENT_CHANGED'; end if;
  end if;
  result := upayments_test.booking_with_wallet(p_action,p_id,p_data);
  if p_action='slots' then
    result := result || jsonb_build_object(
      'pay_at_shop',method<>'online',
      'online_payment',method<>'at_shop' and coalesce((result->>'online_payment')::boolean,false),
      'wallet_payment',method<>'at_shop' and coalesce((result->>'wallet_payment')::boolean,false)
    );
  end if;
  return result;
end
$$;
revoke all on function public.upayments_test_booking(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.upayments_test_booking(text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
