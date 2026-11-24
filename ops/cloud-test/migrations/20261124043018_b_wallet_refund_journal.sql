begin;

create or replace function private.b_wallet_refund_booking(p_booking uuid,p_refund uuid,p_amount bigint) returns bigint
language plpgsql set search_path = '' as $$
declare a upayments_test.booking_attempts%rowtype; r private.settlement_receipts%rowtype;
  prior bigint; refunded bigint; commission bigint; entry bigint; expiry integer; journal uuid;
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
  -- Automated pilot receipts use the booking ID as their machine actor reference.
  insert into private.settlement_journals(shop_id,receipt_id,kind,amount_fils,external_ref,occurred_at,created_by)
    values(a.shop_id,r.id,'refund',p_amount,source,happened,p_booking) returning id into journal;
  insert into private.settlement_entries values
    (journal,'cash',-p_amount),(journal,'shop',p_amount-commission),(journal,'commission',commission);
  if refunded+p_amount=r.amount_fils then
    update upayments_test.booking_attempts set refund_state='refunded' where id=p_booking;
  end if;
  return entry;
end
$$;
commit;
