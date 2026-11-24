begin;

alter table upayments_test.booking_attempts
  add column wallet_id uuid references private.b_wallet_accounts(id),
  add column wallet_fils bigint not null default 0 check(wallet_fils between 0 and total_fils),
  add column wallet_refund_preference text check(wallet_refund_preference in ('wallet','gateway')),
  add check(wallet_fils=0 or wallet_id is not null);

-- Both the refund movement and shop adjustment commit together. Provider refunds
-- continue through the signed UPayments worker and the existing reconciliation.
create function private.b_wallet_refund_booking(p_booking uuid,p_refund uuid,p_amount bigint) returns bigint
language plpgsql set search_path = '' as $$
declare a upayments_test.booking_attempts%rowtype; r private.settlement_receipts%rowtype;
  prior bigint; refunded bigint; commission bigint; entry bigint; expiry integer;
  happened timestamptz := clock_timestamp();
  source text := 'online-refund:' || p_refund::text;
begin
  select * into strict a from upayments_test.booking_attempts where id=p_booking for update;
  if a.state<>'paid' or a.wallet_id is null
    or not exists(select 1 from public.bookings where id=p_booking and status='cancelled') then
    raise exception 'WALLET_INVALID_REFUND';
  end if;
  select id into prior from private.b_wallet_movements
    where wallet_id=a.wallet_id and kind='refund' and reference=p_refund and amount_fils=p_amount;
  if found and exists(select 1 from private.settlement_journals where receipt_id=a.receipt_id and external_ref=source) then return prior; end if;
  select * into strict r from private.settlement_receipts where id=a.receipt_id for update;
  select coalesce(sum(j.amount_fils),0) into refunded from private.settlement_journals j
    where j.receipt_id=a.receipt_id and j.kind='refund'
      and not exists(select 1 from private.settlement_journals x where x.reverses_id=j.id);
  if p_amount is null or p_amount < 1 or refunded+p_amount>r.amount_fils then raise exception 'WALLET_INVALID_REFUND'; end if;
  if a.wallet_fils=a.total_fils then
    entry := private.b_wallet_restore_spend(a.wallet_id,p_booking,p_refund,p_amount,happened);
  else
    select expiry_months into strict expiry from private.b_wallet_settings where singleton;
    entry := private.b_wallet_credit(a.wallet_id,'refund',p_amount,p_refund,happened,private.b_wallet_expiry(happened,expiry));
  end if;
  commission := round(r.commission_fils::numeric*(refunded+p_amount)/r.amount_fils)::bigint
    - round(r.commission_fils::numeric*refunded/r.amount_fils)::bigint;
  perform private.settlement_post(a.shop_id,r.id,null,'refund',p_amount,source,happened,'',
    jsonb_build_object('cash',-p_amount,'shop',p_amount-commission,'commission',commission));
  if refunded+p_amount=r.amount_fils then
    update upayments_test.booking_attempts set refund_state='refunded' where id=p_booking;
  end if;
  return entry;
end
$$;
revoke all on function private.b_wallet_refund_booking(uuid,uuid,bigint) from public,anon,authenticated,service_role;

create or replace function upayments_test.booking_attempt_view(a upayments_test.booking_attempts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'state', case when a.state in ('creating','pending')
       and a.hold_until <= clock_timestamp() then 'expired' else a.state end,
    'totalFils', a.total_fils, 'externalFils', a.total_fils-a.wallet_fils, 'holdUntil', a.hold_until, 'refundState', a.refund_state,
    'accountSaved', a.account_checkout,
    'checkoutUrl', case when a.state = 'pending' and a.hold_until > clock_timestamp() then a.checkout_url end)
$$;
revoke all on function upayments_test.booking_attempt_view(upayments_test.booking_attempts) from public, anon, authenticated, service_role;

create or replace function public.upayments_test_booking(p_action text, p_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '12s' as $$
declare
  a upayments_test.booking_attempts%rowtype;
  r private.settlement_receipts%rowtype;
  rate private.settlement_rates%rowtype;
  agreement private.settlement_agreements%rowtype;
  shop uuid;
  barber public.barbers%rowtype;
  d date;
  t time;
  duration integer;
  slots jsonb;
  result jsonb;
  slot_range tsrange;
  capability bytea;
  amount bigint;
  commission bigint;
  event_id uuid;
  source text;
  happened timestamptz;
  data jsonb;
  wallet uuid;
  wallet_amount bigint := 0;
  wallet_requested boolean := false;
  expiry timestamptz;
  refund_movement bigint;
  settings private.b_wallet_settings%rowtype;
begin
  select * into strict settings from private.b_wallet_settings where singleton;
  if p_action = 'sweep' then
    if p_data->>'secret' is distinct from (select decrypted_secret from vault.decrypted_secrets where name = 'upayments_test_booking_sweep')
       or length(coalesce(p_data->>'secret','')) <> 64 then raise exception 'UPAYMENTS_FORBIDDEN'; end if;
    -- A failed network response never causes a second refund POST.
    update upayments_test.booking_attempts set refund_state = 'review'
      where refund_state = 'requesting' and next_check < clock_timestamp();
    update upayments_test.booking_attempts set state = 'expired', booking_data = null
      where state in ('creating','pending') and hold_until <= clock_timestamp();
    return coalesce((select jsonb_agg(c.id) from (
      select x.id from upayments_test.booking_attempts x
       where x.next_check <= clock_timestamp() and (
        (x.state in ('pending','expired') and x.session_id is not null and x.created_at > clock_timestamp() - interval '24 hours') or
        x.refund_state = 'pending' or
        (x.refund_state is null and (x.state = 'review' or (x.state = 'paid' and exists (
          select 1 from public.bookings b where b.id = x.id and b.status = 'cancelled'))))
      ) order by x.next_check limit 8
    ) c), '[]'::jsonb);
  end if;

  if p_action in ('slots','start') then
    data := case when p_action = 'start' then p_data->'booking' else p_data end;
    shop := (data->>'branch_id')::uuid;
    if p_action = 'slots' and not exists (select 1 from upayments_test.booking_fixture where shop_id = shop) then
      return public.customer_booking('slots', data);
    end if;
    if p_action = 'start' then
      if nullif(p_data->>'capability','') is null or p_id is null or (data->>'id')::uuid is distinct from p_id then
        raise exception 'UPAYMENTS_INVALID';
      end if;
      capability := extensions.digest(((p_data->>'capability')::uuid)::text, 'sha256');
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 0));
      select * into a from upayments_test.booking_attempts where id = p_id;
      if found then
        if a.capability_hash is distinct from capability or (a.booking_data is not null and a.booking_data <> data)
           or a.wallet_fils is distinct from coalesce((p_data->>'wallet_fils')::bigint,0) then
          raise exception 'UPAYMENTS_FORBIDDEN';
        end if;
        return upayments_test.booking_attempt_view(a);
      end if;
      wallet_requested := p_data ? 'wallet_fils';
      if wallet_requested then
        if not settings.enabled or not settings.accept_new_payments then raise exception 'WALLET_DISABLED'; end if;
        wallet_amount := (p_data->>'wallet_fils')::bigint;
        if wallet_amount is null or wallet_amount < 0 then raise exception 'WALLET_INVALID'; end if;
        wallet := private.b_wallet_lock(private.b_wallet_member((data->>'account_user_id')::uuid,(data->>'session_id')::uuid));
      end if;
      if not exists (select 1 from upayments_test.booking_fixture where shop_id = shop and enabled)
         or exists(select 1 from public.bookings where id = p_id)
         or exists(select 1 from private.native_booking_closures where booking_id = p_id) then
        raise exception 'UPAYMENTS_NOT_AVAILABLE';
      end if;
      select * into barber from public.barbers where id = (data->>'barber_id')::uuid and branch_id = shop for share;
      if not found or not barber.auto_confirm_bookings then raise exception 'UPAYMENTS_NOT_AVAILABLE'; end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(barber.id::text, 23231));
    end if;

    slots := public.customer_booking('slots', data);
    d := (data->>'date')::date;
    duration := (slots->>'duration')::integer;
    amount := round((slots->>'price')::numeric * 1000)::bigint;
    if p_action = 'slots' then
      select coalesce(jsonb_agg(s.value order by s.value), '[]'::jsonb) into result
      from jsonb_array_elements_text(slots->'slots') s
      where not exists (
        select 1 from upayments_test.booking_attempts x
        where x.barber_id = (data->>'barber_id')::uuid and x.state in ('creating','pending')
          and x.hold_until > clock_timestamp() and
          x.appointment && tsrange(d + s.value::time, d + s.value::time + make_interval(mins => duration), '[)')
      );
      return slots || jsonb_build_object('slots', result, 'wallet_payment', settings.enabled and settings.accept_new_payments
          and amount between 1 and 1000000000 and (slots->>'confirmation_required')::boolean is false
          and exists(select 1 from upayments_test.booking_fixture where shop_id=shop and enabled),
        'online_payment', (slots->>'confirmation_required')::boolean is false and amount between 1 and 1000000000
          and exists (select 1 from upayments_test.booking_fixture where shop_id = shop and enabled));
    end if;

    t := (data->>'time')::time;
    if (data->>'expected_price')::numeric is distinct from (slots->>'price')::numeric
       or (data->>'expected_duration')::integer is distinct from duration then raise exception 'PRICE_CHANGED'; end if;
    if data->'booking_policy' is distinct from slots->'booking_policy' then raise exception 'BOOKING_POLICY_CHANGED'; end if;
    if data ? 'package_offer_id' and data->'package_quote' is distinct from slots->'package_quote' then raise exception 'PACKAGE_CHANGED'; end if;
    if amount not between 1 and 1000000000 then raise exception 'UPAYMENTS_NOT_AVAILABLE'; end if;
    if t is null or not (slots->'slots' ? to_char(d+t, 'HH24:MI'))
       or ((d+t) at time zone 'Asia/Kuwait') <= clock_timestamp() + interval '8 minutes' then raise exception 'SLOT_UNAVAILABLE'; end if;
    slot_range := tsrange(d+t, d+t+make_interval(mins => duration), '[)');
    if exists (
      select 1 from upayments_test.booking_attempts x where x.barber_id = barber.id and x.state in ('creating','pending')
      and x.hold_until > clock_timestamp() and x.appointment && slot_range
    ) or exists (
      select 1 from public.bookings b where b.barber_id = barber.id and b.status not in ('cancelled','no_show')
      and tsrange(b.date+b.time, b.date+b.time+make_interval(mins => b.duration), '[)') && slot_range
    ) then raise exception 'SLOT_UNAVAILABLE'; end if;

    -- A dry run checks canonical account/phone, service snapshots, billing,
    -- schedule and booking policies. Its side effects roll back with the block.
    begin
      result := public.native_customer_booking('book', data);
      if result->>'status' is distinct from 'confirmed' then raise exception 'UPAYMENTS_NOT_AVAILABLE'; end if;
      raise sqlstate 'B0001';
    exception when sqlstate 'B0001' then null;
    end;
    select * into rate from private.settlement_rates s where s.shop_id = shop
      order by s.created_at desc, s.id desc limit 1;
    if rate.rate_bps is null then
      select * into rate from private.settlement_rates where shop_id is null order by created_at desc, id desc limit 1;
    end if;
    select * into agreement from private.settlement_agreements where shop_id = shop order by created_at desc, id desc limit 1;
    if rate.id is null or agreement.id is null or not exists(select 1 from private.settlement_runtime where singleton and enabled) then
      raise exception 'UPAYMENTS_NOT_AVAILABLE';
    end if;
    if wallet_amount > amount then raise exception 'WALLET_INVALID'; end if;
    expiry := clock_timestamp()+interval '7 minutes';
    if wallet_amount > 0 then
      expiry := private.b_wallet_reserve(wallet,p_id,wallet_amount,clock_timestamp(),expiry);
    end if;
    insert into upayments_test.booking_attempts(id,capability_hash,account_checkout,shop_id,barber_id,appointment,
      hold_until,total_fils,rate_id,agreement_id,booking_data,wallet_id,wallet_fils)
    values (p_id,capability,data ? 'account_user_id',shop,barber.id,slot_range,expiry,amount,rate.id,agreement.id,data,wallet,wallet_amount)
      returning * into a;
    return upayments_test.booking_attempt_view(a) || jsonb_build_object('create', true);
  end if;

  if p_action = 'read' then
    if nullif(p_data->>'capability','') is null then raise exception 'UPAYMENTS_FORBIDDEN'; end if;
    select * into a from upayments_test.booking_attempts
      where capability_hash = extensions.digest(((p_data->>'capability')::uuid)::text,'sha256');
    if not found then return null; end if;
    if a.wallet_id is not null and not exists (
      select 1 from private.b_wallet_accounts w where w.id=a.wallet_id and w.customer_id=
       private.b_wallet_member((p_data->>'account_user_id')::uuid,(p_data->>'session_id')::uuid)
    ) then raise exception 'WALLET_FORBIDDEN' using errcode='42501'; end if;
    return upayments_test.booking_attempt_view(a);
  end if;

  if p_action in ('capture','wallet-capture') then
    -- Same lock order as normal checkout and an online hold.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 0));
    select b.* into barber from public.barbers b join upayments_test.booking_attempts x on x.barber_id = b.id
      where x.id = p_id for share of b;
  end if;
  select * into a from upayments_test.booking_attempts where id = p_id for update;
  if not found then return null; end if;
  if p_action = 'inquire' then
    return jsonb_build_object('sessionId',a.session_id,'state',a.state,'totalFils',a.total_fils,'externalFils',a.total_fils-a.wallet_fils,
      'providerOrderId',a.provider_order_id,'providerRefundKey',a.provider_refund_key,
      'refundState',a.refund_state,'refundOrderId',a.refund_order_id);
  elsif p_action = 'attach' and a.state = 'creating' then
    update upayments_test.booking_attempts set state = 'pending', session_id = p_data->>'sessionId',
      checkout_url = p_data->>'checkoutUrl', next_check = clock_timestamp() + interval '1 minute' where id = p_id;
  elsif p_action = 'failed' and a.state in ('creating','pending','expired') then
    if a.wallet_fils>0 then perform private.b_wallet_release(a.wallet_id,p_id); end if;
    update upayments_test.booking_attempts set state = 'failed', booking_data = null, checkout_url = null where id = p_id;
  elsif p_action = 'defer' then
    update upayments_test.booking_attempts set next_check = clock_timestamp() + interval '1 minute'
      where id = p_id and next_check <= clock_timestamp();
  elsif (p_action = 'capture' and a.state in ('pending','expired','failed'))
     or (p_action = 'wallet-capture' and a.state = 'creating') then
    if p_action = 'capture' and (a.total_fils<=a.wallet_fils
       or (p_data->>'totalFils')::bigint is distinct from a.total_fils-a.wallet_fils or p_data->>'currency' is distinct from 'KWD'
       or p_data->>'sessionId' is distinct from a.session_id or p_data->>'trackId' is null
       or p_data->>'providerOrderId' is null or p_data->>'providerRefundKey' is null) then
      raise exception 'UPAYMENTS_PROVIDER_MISMATCH';
    end if;
    if p_action = 'wallet-capture' and (a.wallet_id is null or a.wallet_fils<>a.total_fils) then
      raise exception 'WALLET_INVALID';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a.barber_id::text, 23231));
    update upayments_test.booking_attempts set state = 'finalizing', checkout_url = null, track_id = p_data->>'trackId',
      provider_order_id = p_data->>'providerOrderId', provider_refund_key = p_data->>'providerRefundKey' where id = p_id;
    if a.booking_data is not null and a.hold_until > clock_timestamp()
       and coalesce(barber.auto_confirm_bookings,false) and not exists (select 1 from public.bookings where id = p_id) then
      begin
        result := public.native_customer_booking('book', a.booking_data);
        if result->>'status' is distinct from 'confirmed' then raise exception 'UPAYMENTS_NOT_AVAILABLE'; end if;
        select * into strict rate from private.settlement_rates where id = a.rate_id;
        select * into strict agreement from private.settlement_agreements where id = a.agreement_id;
        commission := round(a.total_fils::numeric * rate.rate_bps / 10000)::bigint;
        if a.wallet_fils>0 then perform private.b_wallet_spend(a.wallet_id,p_id,clock_timestamp()); end if;
        source := case when a.wallet_id is not null then 'online-booking:' || p_id::text
          else 'upayments-booking-sandbox:' || (p_data->>'trackId') end;
        happened := clock_timestamp();
        insert into private.settlement_receipts(shop_id,booking_id,amount_fils,commission_bps,commission_fils,rate_id,
          agreement_id,fee_bearer,source_ref,collected_at,created_by)
        values(a.shop_id,p_id,a.total_fils,rate.rate_bps,commission,rate.id,agreement.id,agreement.fee_bearer,source,happened,p_id)
        returning id into event_id;
        update upayments_test.booking_attempts set receipt_id = event_id where id = p_id;
        insert into private.settlement_journals(shop_id,receipt_id,kind,amount_fils,external_ref,occurred_at,created_by)
        values(a.shop_id,event_id,'receipt',a.total_fils,source,happened,p_id) returning id into event_id;
        insert into private.settlement_entries values
          (event_id,'cash',a.total_fils),(event_id,'shop',-(a.total_fils-commission)),(event_id,'commission',-commission);
      exception when sqlstate 'P0001' or exclusion_violation then
        result := null;
      end;
    end if;
    if result is null and a.wallet_fils>0 then perform private.b_wallet_release(a.wallet_id,p_id); end if;
    update upayments_test.booking_attempts set
      state = case when result is not null then 'paid' when p_action='wallet-capture' then 'failed' else 'review' end,
      booking_data = null, next_check = clock_timestamp() where id = p_id;
  elsif p_action = 'claim-refund' then
    if a.refund_state is not null or
      not (a.state = 'review' or (a.state = 'paid' and exists(select 1 from public.bookings b where b.id = p_id and b.status = 'cancelled'))) then
      return 'false'::jsonb;
    end if;
    if a.state='paid' and a.wallet_id is not null and (a.wallet_fils>0 or a.wallet_refund_preference='wallet') then
      select a.total_fils-coalesce(sum(j.amount_fils),0) into refund_movement from private.settlement_journals j
        where j.receipt_id=a.receipt_id and j.kind='refund'
          and not exists(select 1 from private.settlement_journals x where x.reverses_id=j.id);
      if refund_movement>0 then
        perform private.b_wallet_refund_booking(p_id,gen_random_uuid(),refund_movement);
      else
        update upayments_test.booking_attempts set refund_state='review' where id=p_id;
      end if;
      return 'false'::jsonb;
    end if;
    update upayments_test.booking_attempts set refund_state = 'requesting', next_check = clock_timestamp() + interval '3 minutes' where id = p_id;
    return 'true'::jsonb;
  elsif p_action = 'refund-pending' and a.refund_state = 'requesting' then
    if nullif(p_data->>'refundOrderId','') is null then raise exception 'UPAYMENTS_PROVIDER_MISMATCH'; end if;
    update upayments_test.booking_attempts set refund_state = 'pending', refund_order_id = p_data->>'refundOrderId',
      next_check = clock_timestamp() + interval '1 minute' where id = p_id;
  elsif p_action = 'refund-review' and a.refund_state in ('requesting','pending') then
    update upayments_test.booking_attempts set refund_state = 'review' where id = p_id;
  elsif p_action = 'refunded' and a.refund_state = 'pending' and p_data->>'refundOrderId' = a.refund_order_id then
    if a.receipt_id is not null then
      select * into strict r from private.settlement_receipts where id = a.receipt_id for update;
      if exists(select 1 from private.settlement_journals where receipt_id = r.id and kind = 'refund') then
        update upayments_test.booking_attempts set refund_state = 'review' where id = p_id;
        return null;
      end if;
      insert into private.settlement_journals(shop_id,receipt_id,kind,amount_fils,external_ref,occurred_at,created_by)
      values(a.shop_id,r.id,'refund',a.total_fils,'upayments-booking-sandbox-refund:' || p_id,clock_timestamp(),p_id)
        returning id into event_id;
      insert into private.settlement_entries values
        (event_id,'cash',-a.total_fils),(event_id,'shop',a.total_fils-r.commission_fils),(event_id,'commission',r.commission_fils);
    end if;
    update upayments_test.booking_attempts set refund_state = 'refunded' where id = p_id;
  end if;
  select * into a from upayments_test.booking_attempts where id = p_id;
  return upayments_test.booking_attempt_view(a);
end $$;
revoke all on function public.upayments_test_booking(text,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.upayments_test_booking(text,uuid,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
