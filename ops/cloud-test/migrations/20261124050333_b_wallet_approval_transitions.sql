begin;

-- Preserve the price and slot sent with the customer request, and prevent a
-- stale confirmation from reopening a cancelled or expired paid-flow booking.
create or replace function private.b_wallet_guard_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
declare operation text := current_setting('barber.b_wallet_operation',true);
  expires timestamptz;
begin
  if tg_op='INSERT' then
    if new.online_payment_state is not null or new.online_payment_due_at is not null then
      raise exception 'WALLET_FORBIDDEN' using errcode='42501';
    end if;
    return new;
  end if;
  expires := (old.date+old.time) at time zone 'Asia/Kuwait';
  if row(new.online_payment_state,new.online_payment_due_at) is distinct from
      row(old.online_payment_state,old.online_payment_due_at) and operation is distinct from new.id::text then
    raise exception 'WALLET_FORBIDDEN' using errcode='42501';
  end if;
  if old.online_payment_state is null or operation=new.id::text then return new; end if;
  if old.status='cancelled' and new.status<>'cancelled' then
    raise exception 'WALLET_PAYMENT_REQUIRED';
  end if;
  if old.online_payment_state in ('pending_approval','awaiting_payment') and old.status='pending'
    and new.status<>'cancelled' and row(new.branch_id,new.barber_id,new.service_ids,new.date,new.time,new.duration,new.price)
      is distinct from row(old.branch_id,old.barber_id,old.service_ids,old.date,old.time,old.duration,old.price) then
    raise exception 'WALLET_PAYMENT_REQUIRED';
  end if;
  if old.online_payment_state='pending_approval' and old.status='pending' and new.status='confirmed' then
    if expires<=clock_timestamp()+interval '1 minute' then raise exception 'WALLET_PAYMENT_WINDOW_CLOSED'; end if;
    new.status:='pending';
    new.online_payment_state:='awaiting_payment';
    new.online_payment_due_at:=least(clock_timestamp()+interval '30 minutes',expires-interval '1 minute');
  elsif old.online_payment_state in ('pending_approval','awaiting_payment') and old.status='pending' then
    if new.status not in ('pending','cancelled') then raise exception 'WALLET_PAYMENT_REQUIRED'; end if;
  elsif old.online_payment_state='paid' and new.price is distinct from old.price then
    raise exception 'WALLET_PAID_PRICE_LOCKED';
  end if;
  return new;
end
$$;

commit;
