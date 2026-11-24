begin;

create function private.b_wallet_reserve(p_wallet uuid, p_hold uuid, p_amount bigint,
  p_now timestamptz, p_deadline timestamptz) returns timestamptz
language plpgsql set search_path = '' as $$
declare current_hold private.b_wallet_holds%rowtype; lot record; picked bigint;
  needed bigint := p_amount; deadline timestamptz := p_deadline;
begin
  if p_amount is null or p_amount not between 1 and 1000000000 or p_now is null
    or p_deadline is null or p_deadline <= p_now or p_hold is null then
    raise exception 'WALLET_INVALID_HOLD';
  end if;
  perform 1 from private.b_wallet_accounts where id = p_wallet and closed_at is null for update;
  if not found then raise exception 'WALLET_CLOSED'; end if;
  select * into current_hold from private.b_wallet_holds where id = p_hold;
  if found then
    if current_hold.wallet_id <> p_wallet or p_amount <> (
      select coalesce(sum(amount_fils),0) from private.b_wallet_allocations where hold_id = p_hold
    ) or current_hold.state <> 'held' or current_hold.expires_at <= p_now then
      raise exception 'WALLET_RETRY_CHANGED';
    end if;
    return current_hold.expires_at;
  end if;
  insert into private.b_wallet_holds(id,wallet_id,expires_at) values(p_hold,p_wallet,p_deadline);
  for lot in
    select l.id, l.expires_at, l.remaining_fils - coalesce((
      select sum(a.amount_fils) from private.b_wallet_allocations a
      join private.b_wallet_holds h on h.id = a.hold_id
      where a.lot_id = l.id and h.state = 'held' and h.expires_at > p_now
    ),0) as free
    from private.b_wallet_lots l
    where l.wallet_id = p_wallet and l.expires_at > p_now and l.remaining_fils > 0
    order by l.expires_at,l.id
  loop
    picked := least(needed,lot.free);
    if picked > 0 then
      insert into private.b_wallet_allocations(wallet_id,hold_id,lot_id,amount_fils)
        values(p_wallet,p_hold,lot.id,picked);
      needed := needed - picked;
      deadline := least(deadline,lot.expires_at);
      exit when needed = 0;
    end if;
  end loop;
  if needed <> 0 then raise exception 'WALLET_INSUFFICIENT_BALANCE'; end if;
  update private.b_wallet_holds set expires_at = deadline where id = p_hold;
  return deadline;
end
$$;

create function private.b_wallet_release(p_wallet uuid, p_hold uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform 1 from private.b_wallet_accounts where id = p_wallet for update;
  update private.b_wallet_holds set state = 'released'
    where wallet_id = p_wallet and id = p_hold and state = 'held';
end
$$;

create function private.b_wallet_spend(p_wallet uuid, p_hold uuid, p_now timestamptz) returns bigint
language plpgsql set search_path = '' as $$
declare current_hold private.b_wallet_holds%rowtype; entry bigint; amount bigint;
begin
  perform 1 from private.b_wallet_accounts where id = p_wallet and closed_at is null for update;
  if not found then raise exception 'WALLET_CLOSED'; end if;
  select * into current_hold from private.b_wallet_holds where id = p_hold and wallet_id = p_wallet;
  if current_hold.state = 'spent' then return current_hold.spend_movement_id; end if;
  if p_now is null or current_hold.state is distinct from 'held' or current_hold.expires_at <= p_now then
    raise exception 'WALLET_HOLD_EXPIRED';
  end if;
  select sum(amount_fils) into strict amount from private.b_wallet_allocations where hold_id = p_hold;
  insert into private.b_wallet_movements(wallet_id,kind,amount_fils,reference,occurred_at)
    values(p_wallet,'spend',-amount,p_hold,p_now) returning id into entry;
  update private.b_wallet_lots l set remaining_fils = l.remaining_fils - a.amount_fils
    from private.b_wallet_allocations a where a.hold_id = p_hold and a.lot_id = l.id;
  update private.b_wallet_holds set state = 'spent',spend_movement_id = entry where id = p_hold;
  return entry;
end
$$;

create function private.b_wallet_restore_spend(p_wallet uuid,p_hold uuid,p_reference uuid,
  p_amount bigint,p_now timestamptz) returns bigint
language plpgsql set search_path = '' as $$
declare prior private.b_wallet_movements%rowtype; portion record; entry bigint;
  needed bigint := p_amount; restored bigint;
begin
  if p_amount is null or p_amount not between 1 and 1000000000
    or p_reference is null or p_now is null then raise exception 'WALLET_INVALID_REFUND'; end if;
  perform 1 from private.b_wallet_accounts where id = p_wallet and closed_at is null for update;
  if not found then raise exception 'WALLET_CLOSED'; end if;
  select * into prior from private.b_wallet_movements
    where wallet_id = p_wallet and kind = 'refund' and reference = p_reference;
  if found then
    if prior.amount_fils <> p_amount then raise exception 'WALLET_RETRY_CHANGED'; end if;
    return prior.id;
  end if;
  if not exists (select 1 from private.b_wallet_holds where id = p_hold and wallet_id = p_wallet and state = 'spent') then
    raise exception 'WALLET_INVALID_REFUND';
  end if;
  insert into private.b_wallet_movements(wallet_id,kind,amount_fils,reference,occurred_at)
    values(p_wallet,'refund',p_amount,p_reference,p_now) returning id into entry;
  for portion in
    select a.lot_id, a.amount_fils-a.refunded_fils as available, l.expires_at
    from private.b_wallet_allocations a join private.b_wallet_lots l on l.id = a.lot_id
    where a.hold_id = p_hold and a.refunded_fils < a.amount_fils
    order by l.expires_at,l.id
  loop
    restored := least(needed,portion.available);
    insert into private.b_wallet_lots(wallet_id,credit_movement_id,original_fils,remaining_fils,expires_at,restores_lot_id)
      values(p_wallet,entry,restored,restored,
        case when portion.expires_at <= p_now then p_now + interval '720 hours' else portion.expires_at end,
        portion.lot_id);
    update private.b_wallet_allocations set refunded_fils = refunded_fils + restored
      where hold_id = p_hold and lot_id = portion.lot_id;
    needed := needed - restored;
    exit when needed = 0;
  end loop;
  if needed <> 0 then raise exception 'WALLET_REFUND_EXCEEDS_SPEND'; end if;
  return entry;
end
$$;

revoke all on function private.b_wallet_reserve(uuid,uuid,bigint,timestamptz,timestamptz),
  private.b_wallet_release(uuid,uuid), private.b_wallet_spend(uuid,uuid,timestamptz),
  private.b_wallet_restore_spend(uuid,uuid,uuid,bigint,timestamptz)
  from public,anon,authenticated,service_role;
commit;
