begin;

-- Wallet-aware payments post refunds together with their funding movements.
-- Settlement operators can still record fees, holds and bank reconciliation.
create function private.b_wallet_settlement_refund_guard() returns trigger
language plpgsql set search_path = '' as $$
declare booking uuid;
begin
  if new.receipt_id is null or new.kind not in ('refund','reversal') then return new; end if;
  select id into booking from upayments_test.booking_attempts
    where receipt_id=new.receipt_id and wallet_id is not null;
  if booking is null then return new; end if;
  if (new.kind='refund' and new.created_by is distinct from booking)
     or (new.kind='reversal' and exists (
       select 1 from private.settlement_journals
       where id=new.reverses_id and kind in ('receipt','refund')
     )) then
    raise exception 'SETTLEMENT_WALLET_MANAGED';
  end if;
  return new;
end
$$;
revoke all on function private.b_wallet_settlement_refund_guard() from public,anon,authenticated,service_role;
create trigger settlement_wallet_refund_guard
  before insert on private.settlement_journals
  for each row execute function private.b_wallet_settlement_refund_guard();

commit;
