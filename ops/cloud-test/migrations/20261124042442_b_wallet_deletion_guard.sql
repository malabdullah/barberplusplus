begin;

create function private.b_wallet_deletion_state(p_customers uuid[],p_now timestamptz) returns jsonb
language sql stable set search_path = '' as $$
  with accounts as (
    select id from private.b_wallet_accounts where customer_id=any(p_customers)
  ), movements as (
    select max(m.id) as latest from private.b_wallet_movements m join accounts a on a.id=m.wallet_id
  ), exposure as (
    select coalesce(sum(l.remaining_fils),0)::text as balance
    from private.b_wallet_lots l join accounts a on a.id=l.wallet_id where l.expires_at>p_now
  ), outstanding as (
    select count(*) as pending from (
      select t.id from private.b_wallet_topups t join accounts a on a.id=t.wallet_id
        where t.state in ('creating','pending','review')
      union all
      select x.id from upayments_test.booking_attempts x join accounts a on a.id=x.wallet_id
        left join public.bookings b on b.id=x.id
        where x.state in ('creating','pending','finalizing')
          or (x.state='expired' and x.session_id is not null and x.created_at>p_now-interval '24 hours')
          or (x.state='review' and x.refund_state is distinct from 'refunded')
          or (x.state='paid' and (
            b.status in ('confirmed','pending')
            or (b.status='cancelled' and x.refund_state is distinct from 'refunded')))
    ) work
  )
  select jsonb_build_object('walletBalanceFils',balance,'walletPending',pending,'walletLastMovement',latest,
    'hasWallet',exists(select 1 from accounts)) from exposure,outstanding,movements
$$;

create function private.b_wallet_log_expiration(p_wallet uuid,p_now timestamptz) returns void
language plpgsql set search_path = '' as $$
declare lot record;
begin
  perform 1 from private.b_wallet_accounts where id=p_wallet for update;
  for lot in select id,remaining_fils from private.b_wallet_lots
    where wallet_id=p_wallet and remaining_fils>0 and expires_at<=p_now order by expires_at,id for update
  loop
    insert into private.b_wallet_movements(wallet_id,kind,amount_fils,reference,occurred_at)
      values(p_wallet,'expiry',-lot.remaining_fils,lot.id,p_now);
    update private.b_wallet_lots set remaining_fils=0 where id=lot.id;
  end loop;
end
$$;

create function private.b_wallet_expire_lots() returns void
language plpgsql security definer set search_path = '' as $$
declare wallet uuid; now_at timestamptz := clock_timestamp();
begin
  for wallet in select a.id from private.b_wallet_accounts a where a.closed_at is null
    and exists(select 1 from private.b_wallet_lots l where l.wallet_id=a.id and l.remaining_fils>0 and l.expires_at<=now_at)
    order by a.id for update skip locked limit 100
  loop
    perform private.b_wallet_log_expiration(wallet,now_at);
  end loop;
end
$$;
select cron.schedule('b-wallet-test-credit-expiry','*/10 * * * *','select private.b_wallet_expire_lots()');

create function private.b_wallet_close_for_deletion(p_customers uuid[],p_confirmed_balance text) returns void
language plpgsql set search_path = '' as $$
declare snapshot jsonb; wallet uuid; lot record; now_at timestamptz := clock_timestamp();
begin
  -- The existing deletion procedure already locked the canonical customer rows.
  perform 1 from private.b_wallet_accounts where customer_id=any(p_customers) order by id for update;
  snapshot := private.b_wallet_deletion_state(p_customers,now_at);
  if snapshot->>'walletPending'<>'0' then raise exception 'WALLET_PENDING_ACTIVITY'; end if;
  if snapshot->>'walletBalanceFils'<>'0' and
     p_confirmed_balance is distinct from snapshot->>'walletBalanceFils' then
    raise exception 'WALLET_CLEAR_CONFIRMATION_REQUIRED';
  end if;
  for wallet in select id from private.b_wallet_accounts where customer_id=any(p_customers) order by id
  loop
    perform private.b_wallet_log_expiration(wallet,now_at);
    for lot in select id,remaining_fils from private.b_wallet_lots
      where wallet_id=wallet and remaining_fils>0 order by id for update
    loop
      insert into private.b_wallet_movements(wallet_id,kind,amount_fils,reference,occurred_at)
        values(wallet,'clear',-lot.remaining_fils,lot.id,now_at);
      update private.b_wallet_lots set remaining_fils=0 where id=lot.id;
    end loop;
    update private.b_wallet_accounts set customer_id=null,closed_at=now_at where id=wallet;
  end loop;
end
$$;

alter function private.deletion_preview(uuid[]) rename to deletion_preview_without_wallet;
create function private.deletion_preview(p_customers uuid[]) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  base jsonb:=private.deletion_preview_without_wallet(p_customers);
  wallet jsonb:=private.b_wallet_deletion_state(p_customers,clock_timestamp());
begin
  if wallet->>'hasWallet' is distinct from 'true' then return base; end if;
  return base || jsonb_build_object(
    'walletBalanceFils',wallet->>'walletBalanceFils','walletPending',(wallet->>'walletPending')::integer,
    'digest',encode(extensions.digest(jsonb_build_array(base->>'digest',wallet)::text,'sha256'),'hex'));
end
$$;

-- Add the final wallet check after the existing fresh preview comparison and
-- canonical customer lock, within the same deletion transaction as anonymization.
do $patch$
declare prior text; patched text;
begin
  prior:=pg_get_functiondef('private.customer_deletion_base_v1(text,jsonb)'::regprocedure);
  patched:=replace(prior,'ids:=j.user_ids;cids:=j.customer_ids;',
    'perform private.b_wallet_close_for_deletion(j.customer_ids,p_data->>''walletBalanceFils'');'||chr(10)||'    ids:=j.user_ids;cids:=j.customer_ids;');
  if patched=prior then raise exception 'Deletion guard placement changed'; end if;
  execute patched;
end $patch$;
revoke all on function private.b_wallet_deletion_state(uuid[],timestamptz),
  private.b_wallet_log_expiration(uuid,timestamptz),private.b_wallet_expire_lots(),
  private.b_wallet_close_for_deletion(uuid[],text),private.deletion_preview(uuid[])
  from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
