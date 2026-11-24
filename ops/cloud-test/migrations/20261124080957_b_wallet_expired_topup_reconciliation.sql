begin;

create or replace function public.b_wallet_topup_service(p_action text,p_id uuid,p_data jsonb) returns jsonb
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
          return jsonb_build_object('id',p_id,'state','creating','amountFils',requested::text,'linkExpired',false,'create',true);
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
    elsif p_action='fail' and (topup.state in ('creating','pending') or
      (topup.state='review' and topup.provider_session=p_data->>'session_id')) then
      -- Only a confirmed provider result for the bound session clears review.
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
    'linkExpired',topup.state in ('pending','review') and
      (topup.state='review' or topup.checkout_url is null or topup.created_at<=now_at-interval '5 minutes'),
    'checkoutUrl',case when topup.state='pending' and topup.created_at>now_at-interval '5 minutes' then topup.checkout_url end);
end
$$;

notify pgrst,'reload schema';
commit;
