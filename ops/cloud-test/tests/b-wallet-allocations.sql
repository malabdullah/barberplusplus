-- All lots, holds and refunds roll back.
begin;
do $test$
declare
  customer uuid := gen_random_uuid();
  wallet uuid; early uuid := gen_random_uuid(); later uuid := gen_random_uuid();
  hold_id_value uuid := gen_random_uuid(); other_hold uuid := gen_random_uuid();
  refund_a uuid := gen_random_uuid(); refund_b uuid := gen_random_uuid();
  t timestamptz := '2026-11-24 12:00:00+03'; snapshot jsonb; refund_id bigint;
begin
  insert into public.customers(id,name) values(customer,'Wallet allocation QA');
  wallet := private.b_wallet_lock(customer);
  perform private.b_wallet_credit(wallet,'goodwill',3000,early,t,t+interval '1 day');
  perform private.b_wallet_credit(wallet,'goodwill',7000,later,t,t+interval '6 months');
  if private.b_wallet_reserve(wallet,hold_id_value,7000,t,t+interval '7 min') <> t+interval '7 min' then
    raise exception 'Reservation deadline incorrect';
  end if;
  snapshot := private.b_wallet_summary(wallet,t,null);
  if snapshot->>'balanceFils'<>'3000' or snapshot->>'heldFils'<>'7000' then
    raise exception 'Held amount incorrectly available';
  end if;
  begin
    perform private.b_wallet_reserve(wallet,other_hold,3001,t,t+interval '7 min');
    raise exception 'Overspend succeeded';
  exception when raise_exception then
    if sqlerrm <> 'WALLET_INSUFFICIENT_BALANCE' then raise; end if;
  end;
  perform private.b_wallet_reserve(wallet,other_hold,3000,t,t+interval '7 min');
  perform private.b_wallet_release(wallet,other_hold);
  if private.b_wallet_spend(wallet,hold_id_value,t) <> private.b_wallet_spend(wallet,hold_id_value,t) then
    raise exception 'Second capture spent twice';
  end if;
  refund_id := private.b_wallet_restore_spend(wallet,hold_id_value,refund_a,2000,t);
  if refund_id <> private.b_wallet_restore_spend(wallet,hold_id_value,refund_a,2000,t) then
    raise exception 'Refund retry posted twice';
  end if;
  if (select expires_at from private.b_wallet_lots where credit_movement_id=refund_id) <> t+interval '1 day' then
    raise exception 'Unexpired credit lost original expiry';
  end if;
  refund_id := private.b_wallet_restore_spend(wallet,hold_id_value,refund_b,5000,t+interval '1 day');
  if (select count(*) from private.b_wallet_lots where credit_movement_id=refund_id and
      ((original_fils=1000 and expires_at=t+interval '31 days') or
       (original_fils=4000 and expires_at=t+interval '6 months'))) <> 2 then
    raise exception 'Partial refund did not preserve per-portion expiry at the boundary';
  end if;
  begin
    perform private.b_wallet_restore_spend(wallet,hold_id_value,gen_random_uuid(),1,t+interval '1 day');
    raise exception 'Excess refund succeeded';
  exception when raise_exception then
    if sqlerrm <> 'WALLET_REFUND_EXCEEDS_SPEND' then raise; end if;
  end;
  if (select count(*) from private.b_wallet_movements where wallet_id=wallet) <> 5 then
    raise exception 'Unexpected movement count';
  end if;
end
$test$;
select 'allocation, overspend, capture replay, partial refund, exact expiry, and refund ceiling passed' as result;
rollback;
