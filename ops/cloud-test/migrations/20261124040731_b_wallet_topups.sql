begin;

create table private.b_wallet_topups (
  id uuid primary key,
  wallet_id uuid not null references private.b_wallet_accounts(id),
  provider text not null default 'upayments',
  amount_fils bigint not null check (amount_fils between 1000 and 100000),
  state text not null default 'creating' check (state in ('creating','pending','failed','review','credited')),
  provider_session text,
  provider_order text,
  provider_track text,
  checkout_url text,
  movement_id bigint,
  created_at timestamptz not null default clock_timestamp(),
  next_check timestamptz not null default clock_timestamp(),
  unique (provider,provider_session),
  unique (provider,provider_track),
  foreign key (wallet_id,movement_id) references private.b_wallet_movements(wallet_id,id),
  check ((state = 'credited') = (movement_id is not null))
);
create index b_wallet_topup_followup on private.b_wallet_topups (next_check,id) where state = 'pending';
create index b_wallet_topup_wallet on private.b_wallet_topups (wallet_id,created_at desc);
alter table private.b_wallet_topups enable row level security;
revoke all on private.b_wallet_topups from public,anon,authenticated,service_role;

create function private.b_wallet_member(p_user uuid,p_session uuid) returns uuid
language sql stable set search_path = '' as $$
  select c.id from private.customer_accounts a join public.customers c on c.id=a.customer_id
  where a.user_id = coalesce((select account_user_id from private.customer_social_identities where user_id=p_user),p_user)
    and public.customer_session_is_live(p_user,p_session) and c.account_deleted_at is null and c.status='active'
$$;
create or replace function private.b_wallet_customer() returns uuid
language sql stable set search_path = '' as $$
  select private.b_wallet_member(auth.uid(),nullif(auth.jwt()->>'session_id','')::uuid)
$$;

create function public.b_wallet_topup_service(p_action text,p_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout='12s' as $$
declare
  topup private.b_wallet_topups%rowtype;
  settings private.b_wallet_settings%rowtype;
  person uuid; wallet uuid; entry bigint; requested bigint;
  now_at timestamptz := clock_timestamp();
begin
  if p_action in ('start','read','latest') then
    person := private.b_wallet_member((p_data->>'user_id')::uuid,(p_data->>'session_id')::uuid);
    if person is null then raise exception 'WALLET_FORBIDDEN' using errcode='42501'; end if;
    select * into strict settings from private.b_wallet_settings where singleton;
    if not settings.enabled then raise exception 'WALLET_DISABLED' using errcode='42501'; end if;
    if p_action = 'latest' then
      select t.* into topup from private.b_wallet_topups t
        join private.b_wallet_accounts a on a.id=t.wallet_id where a.customer_id=person
        and t.state in ('creating','pending','review') order by t.created_at desc limit 1;
    elsif p_action = 'read' then
      select t.* into topup from private.b_wallet_topups t
        join private.b_wallet_accounts a on a.id=t.wallet_id where a.customer_id=person and t.id=p_id;
    else
      if not settings.accept_new_payments then raise exception 'WALLET_DISABLED' using errcode='42501'; end if;
      requested := (p_data->>'amount_fils')::bigint;
      if requested is null or requested not between 1000 and 100000 or p_id is null then
        raise exception 'WALLET_INVALID_TOPUP';
      end if;
      wallet := private.b_wallet_lock(person);
      select * into topup from private.b_wallet_topups where id=p_id;
      if found and (topup.wallet_id<>wallet or topup.amount_fils<>requested) then
        raise exception 'WALLET_RETRY_CHANGED';
      end if;
      if not found then
        select * into topup from private.b_wallet_topups
          where wallet_id=wallet and state in ('creating','pending','review') order by created_at desc limit 1;
        if not found then
          insert into private.b_wallet_topups(id,wallet_id,amount_fils) values(p_id,wallet,requested) returning * into topup;
          return jsonb_build_object('id',p_id,'state','creating','amountFils',requested::text,'create',true);
        elsif topup.amount_fils<>requested then
          raise exception 'WALLET_TOPUP_PENDING';
        end if;
      end if;
    end if;
  elsif p_action = 'due-ids' then
    if p_data->>'worker_key' is null or not exists (
      select 1 from vault.decrypted_secrets where name='upayments_test_booking_sweep'
        and decrypted_secret=p_data->>'worker_key'
    ) then raise exception 'WALLET_FORBIDDEN' using errcode='42501'; end if;
    update private.b_wallet_topups set state='review',checkout_url=null
      where (state='creating' and created_at < now_at-interval '2 minutes')
        or (state='pending' and created_at < now_at-interval '24 hours');
    return coalesce((select jsonb_agg(id) from (
      select id from private.b_wallet_topups where state='pending' and next_check<=now_at
        order by next_check,id limit 20
    ) due),'[]'::jsonb);
  elsif p_action in ('attach','reconcile','capture','fail','review','delay') then
    select a.customer_id,t.wallet_id into person,wallet from private.b_wallet_topups t
      join private.b_wallet_accounts a on a.id=t.wallet_id where t.id=p_id;
    if not found then return null; end if;
    -- This order also serializes provider completion against account deletion.
    if p_action='capture' then
      if person is null then raise exception 'WALLET_CLOSED'; end if;
      perform private.b_wallet_lock(person);
    end if;
    select * into topup from private.b_wallet_topups where id=p_id for update;
    if p_action='reconcile' then
      return jsonb_build_object('id',p_id,'state',topup.state,'sessionId',topup.provider_session);
    elsif p_action='attach' and topup.state in ('creating','review') and topup.provider_session is null then
      update private.b_wallet_topups set state='pending',provider_session=p_data->>'session_id',
        checkout_url=p_data->>'checkout_url',next_check=now_at+interval '45 seconds' where id=p_id;
    elsif p_action='review' and topup.state='creating' then
      update private.b_wallet_topups set state='review' where id=p_id;
    elsif p_action='fail' and topup.state in ('creating','pending') then
      update private.b_wallet_topups set state='failed',checkout_url=null where id=p_id;
    elsif p_action='delay' and topup.state='pending' then
      update private.b_wallet_topups set next_check=now_at+interval '1 minute' where id=p_id;
    elsif p_action='capture' and topup.state in ('pending','failed','review','credited') then
      if (p_data->>'amount_fils')::bigint is distinct from topup.amount_fils
        or p_data->>'currency' is distinct from 'KWD'
        or p_data->>'session_id' is distinct from topup.provider_session or topup.provider_session is null
        or nullif(p_data->>'track_id','') is null or nullif(p_data->>'order_id','') is null
        or (topup.state='credited' and (topup.provider_track is distinct from p_data->>'track_id'
          or topup.provider_order is distinct from p_data->>'order_id')) then
        raise exception 'WALLET_PROVIDER_MISMATCH';
      end if;
      if topup.state<>'credited' then
        select * into strict settings from private.b_wallet_settings where singleton;
        entry := private.b_wallet_credit(topup.wallet_id,'top_up',topup.amount_fils,topup.id,
          now_at,private.b_wallet_expiry(now_at,settings.expiry_months));
        update private.b_wallet_topups set state='credited',provider_track=p_data->>'track_id',
          provider_order=p_data->>'order_id',checkout_url=null,movement_id=entry where id=p_id;
      end if;
    end if;
    select * into strict topup from private.b_wallet_topups where id=p_id;
  else
    raise exception 'WALLET_INVALID';
  end if;
  if topup.id is null then return null; end if;
  return jsonb_build_object('id',topup.id,'state',topup.state,'amountFils',topup.amount_fils::text,
    'checkoutUrl',case when topup.state='pending' and topup.created_at>now_at-interval '5 minutes' then topup.checkout_url end);
end
$$;
revoke all on function private.b_wallet_member(uuid,uuid),public.b_wallet_topup_service(text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.b_wallet_topup_service(text,uuid,jsonb) to service_role;
create function private.b_wallet_kick_topups() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.b_wallet_topups where
    (state='pending' and next_check<=clock_timestamp()) or
    (state='creating' and created_at<clock_timestamp()-interval '2 minutes')
  ) then return; end if;
  perform net.http_post(url := 'https://qvkucvcjmojjbphlzlks.supabase.co/functions/v1/b-wallet/sweep',
    headers := jsonb_build_object('Content-Type','application/json','x-booking-sweep',
      (select decrypted_secret from vault.decrypted_secrets where name='upayments_test_booking_sweep')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
end
$$;
revoke all on function private.b_wallet_kick_topups() from public,anon,authenticated,service_role;
select cron.schedule('b-wallet-test-topups','* * * * *','select private.b_wallet_kick_topups()');
notify pgrst,'reload schema';
commit;
