-- Hosted Test only. Deployment leaves all customer and operator wallet routes dark.
begin;

create schema b_wallet_api;
revoke all on schema b_wallet_api from public, anon, authenticated, service_role;
grant usage on schema b_wallet_api to authenticated;

create table private.b_wallet_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  accept_new_payments boolean not null default false,
  expiry_months integer not null default 6 check (expiry_months between 1 and 60),
  check (not accept_new_payments or enabled)
);
insert into private.b_wallet_settings default values;

create table private.b_wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid unique references public.customers(id),
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  check ((customer_id is null) = (closed_at is not null))
);

create table private.b_wallet_movements (
  id bigint generated always as identity primary key,
  wallet_id uuid not null references private.b_wallet_accounts(id),
  kind text not null check (kind in ('top_up','goodwill','spend','refund','expiry','clear')),
  amount_fils bigint not null check (
    amount_fils between -1000000000 and 1000000000 and
    case when kind in ('spend','expiry','clear') then amount_fils < 0 else amount_fils > 0 end
  ),
  reference uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (wallet_id, kind, reference),
  unique (wallet_id, id)
);
create index b_wallet_reference_lookup on private.b_wallet_movements (reference, id desc);
create index b_wallet_movement_history on private.b_wallet_movements (wallet_id, id desc);

create table private.b_wallet_lots (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references private.b_wallet_accounts(id),
  credit_movement_id bigint not null,
  original_fils bigint not null check (original_fils between 1 and 1000000000),
  remaining_fils bigint not null check (remaining_fils between 0 and original_fils),
  expires_at timestamptz not null,
  -- Retain the settled allocation behind a restored wallet-only refund.
  restores_lot_id uuid,
  unique (wallet_id, id),
  foreign key (wallet_id, credit_movement_id) references private.b_wallet_movements(wallet_id, id),
  foreign key (wallet_id, restores_lot_id) references private.b_wallet_lots(wallet_id, id)
);
create index b_wallet_spend_order on private.b_wallet_lots (wallet_id, expires_at, id)
  where remaining_fils > 0;

create table private.b_wallet_holds (
  id uuid primary key,
  wallet_id uuid not null references private.b_wallet_accounts(id),
  expires_at timestamptz not null,
  state text not null default 'held' check (state in ('held','spent','released')),
  spend_movement_id bigint,
  check ((state = 'spent') = (spend_movement_id is not null)),
  unique (wallet_id, id),
  foreign key (wallet_id, spend_movement_id) references private.b_wallet_movements(wallet_id, id)
);
create index b_wallet_active_holds on private.b_wallet_holds (wallet_id, expires_at) where state = 'held';

create table private.b_wallet_allocations (
  wallet_id uuid not null,
  hold_id uuid not null,
  lot_id uuid not null,
  amount_fils bigint not null check (amount_fils > 0),
  refunded_fils bigint not null default 0 check (refunded_fils between 0 and amount_fils),
  primary key (hold_id, lot_id),
  foreign key (wallet_id, hold_id) references private.b_wallet_holds(wallet_id, id),
  foreign key (wallet_id, lot_id) references private.b_wallet_lots(wallet_id, id)
);
create index b_wallet_allocations_lot on private.b_wallet_allocations (lot_id, hold_id);

create table private.b_wallet_admin_audit (
  request_id uuid primary key,
  actor_id uuid not null,
  operation text not null check (operation in ('goodwill','expiry')),
  request_hash bytea not null,
  reason text not null check (length(reason) between 3 and 240),
  movement_id bigint references private.b_wallet_movements(id),
  result jsonb not null,
  acted_at timestamptz not null default clock_timestamp()
);

alter table private.b_wallet_settings enable row level security;
alter table private.b_wallet_accounts enable row level security;
alter table private.b_wallet_movements enable row level security;
alter table private.b_wallet_lots enable row level security;
alter table private.b_wallet_holds enable row level security;
alter table private.b_wallet_allocations enable row level security;
alter table private.b_wallet_admin_audit enable row level security;
revoke all on private.b_wallet_settings, private.b_wallet_accounts, private.b_wallet_movements,
  private.b_wallet_lots, private.b_wallet_holds, private.b_wallet_allocations,
  private.b_wallet_admin_audit from public, anon, authenticated, service_role;

create function private.b_wallet_customer() returns uuid
language sql stable set search_path = '' as $$
  select c.id
  from private.customer_accounts a
  join public.customers c on c.id = a.customer_id
  where a.user_id = coalesce(
    (select account_user_id from private.customer_social_identities where user_id = auth.uid()),
    auth.uid()
  )
    and public.customer_session_is_live(auth.uid(), nullif(auth.jwt()->>'session_id','')::uuid)
    and c.status = 'active' and c.account_deleted_at is null
$$;

-- Customer row first, then wallet, for all new money operations. The deletion
-- integration uses the same order and checks eligibility again after locking.
create function private.b_wallet_lock(p_customer uuid) returns uuid
language plpgsql set search_path = '' as $$
declare wallet uuid;
begin
  perform 1 from public.customers
    where id = p_customer and account_deleted_at is null and status = 'active' for update;
  if not found then raise exception 'WALLET_CUSTOMER_UNAVAILABLE' using errcode = '42501'; end if;
  insert into private.b_wallet_accounts(customer_id) values (p_customer) on conflict (customer_id) do nothing;
  select id into strict wallet from private.b_wallet_accounts where customer_id = p_customer for update;
  return wallet;
end
$$;

create function private.b_wallet_expiry(p_issued timestamptz, p_months integer) returns timestamptz
language sql immutable strict set search_path = '' as $$
  select ((p_issued at time zone 'Asia/Kuwait') + make_interval(months => p_months)) at time zone 'Asia/Kuwait'
$$;

create function private.b_wallet_credit(p_wallet uuid, p_kind text, p_amount bigint, p_reference uuid,
  p_now timestamptz, p_expiry timestamptz) returns bigint
language plpgsql set search_path = '' as $$
declare entry bigint; prior private.b_wallet_movements%rowtype;
begin
  if p_kind is null or p_kind not in ('top_up','goodwill','refund')
    or p_amount is null or p_amount not between 1 and 1000000000
    or p_now is null or p_expiry is null or p_expiry <= p_now then
    raise exception 'WALLET_INVALID_CREDIT';
  end if;
  perform 1 from private.b_wallet_accounts where id = p_wallet and closed_at is null for update;
  if not found then raise exception 'WALLET_CLOSED'; end if;
  select * into prior from private.b_wallet_movements
    where wallet_id = p_wallet and kind = p_kind and reference = p_reference;
  if found then
    if prior.amount_fils <> p_amount then raise exception 'WALLET_RETRY_CHANGED'; end if;
    return prior.id;
  end if;
  insert into private.b_wallet_movements(wallet_id,kind,amount_fils,reference,occurred_at)
    values(p_wallet,p_kind,p_amount,p_reference,p_now) returning id into entry;
  insert into private.b_wallet_lots(wallet_id,credit_movement_id,original_fils,remaining_fils,expires_at)
    values(p_wallet,entry,p_amount,p_amount,p_expiry);
  return entry;
end
$$;

create function private.b_wallet_summary(p_wallet uuid, p_now timestamptz, p_before bigint) returns jsonb
language sql stable set search_path = '' as $$
  with reserved as (
    select a.lot_id, sum(a.amount_fils) as fils
    from private.b_wallet_allocations a join private.b_wallet_holds h on h.id = a.hold_id
    where h.wallet_id = p_wallet and h.state = 'held' and h.expires_at > p_now
    group by a.lot_id
  ), expires as (
    select l.expires_at, sum(l.remaining_fils - coalesce(r.fils,0)) as fils
    from private.b_wallet_lots l left join reserved r on r.lot_id = l.id
    where l.wallet_id = p_wallet and l.expires_at > p_now and l.remaining_fils > 0
    group by l.expires_at
    having sum(l.remaining_fils - coalesce(r.fils,0)) > 0
  ), items as (
    select id,kind,amount_fils,occurred_at
    from private.b_wallet_movements
    where wallet_id = p_wallet and (p_before is null or id < p_before)
    order by id desc limit 21
  )
  select jsonb_build_object(
    'balanceFils',coalesce((select sum(fils) from expires),0)::text,
    'heldFils',coalesce((select sum(fils) from reserved),0)::text,
    'nextExpiry',(select jsonb_build_object('at',expires_at,'amountFils',fils::text) from expires order by expires_at limit 1),
    'transactions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id::text,'kind',kind,'amountFils',amount_fils::text,'at',occurred_at
    ) order by id desc) from (select * from items order by id desc limit 20) page),'[]'::jsonb),
    'nextBefore',case when (select count(*) from items) > 20 then
      (select id::text from items order by id desc offset 19 limit 1) end
  )
$$;

create function b_wallet_api.dispatch(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '12s' as $$
declare
  settings private.b_wallet_settings%rowtype;
  prior private.b_wallet_admin_audit%rowtype;
  person uuid; wallet uuid; request_ref uuid; body_hash bytea; reason text;
  now_at timestamptz := clock_timestamp(); entry bigint; fils bigint; months integer; reply jsonb;
begin
  if p_action is null or p_data is null or jsonb_typeof(p_data) <> 'object'
    or octet_length(p_data::text) > 4096 then raise exception 'WALLET_INVALID'; end if;
  select * into strict settings from private.b_wallet_settings where singleton;
  if p_action = 'status' then
    return jsonb_build_object('enabled', settings.enabled and private.b_wallet_customer() is not null);
  end if;
  if not settings.enabled then raise exception 'WALLET_DISABLED' using errcode='42501'; end if;
  if p_action = 'summary' then
    person := private.b_wallet_customer();
    if person is null then raise exception 'WALLET_FORBIDDEN' using errcode='42501'; end if;
    select id into wallet from private.b_wallet_accounts where customer_id = person;
    return private.b_wallet_summary(wallet, now_at, (p_data->>'before')::bigint)
      || jsonb_build_object('acceptPayments', settings.accept_new_payments, 'expiryMonths',settings.expiry_months);
  end if;
  -- is_admin() uses the live role and a valid MFA session for both platform roles.
  if not public.is_admin() then raise exception 'WALLET_FORBIDDEN' using errcode='42501'; end if;
  if p_action = 'admin-settings' then
    return jsonb_build_object('expiryMonths',settings.expiry_months);
  end if;
  if p_action = 'admin-lookup' then
    request_ref := nullif(p_data->>'reference','')::uuid;
    person := nullif(p_data->>'customerId','')::uuid;
    if request_ref is not null then
      return jsonb_build_object('transactions',coalesce((
        select jsonb_agg(jsonb_build_object('id',m.id::text,'kind',m.kind,'amountFils',m.amount_fils::text,
          'at',m.occurred_at,'walletId',m.wallet_id,'customerId',a.customer_id) order by m.id desc)
        from (select * from private.b_wallet_movements where b_wallet_movements.reference = request_ref
          order by id desc limit 20) m join private.b_wallet_accounts a on a.id = m.wallet_id
      ),'[]'::jsonb));
    end if;
    if person is null then raise exception 'WALLET_INVALID'; end if;
    select id into wallet from private.b_wallet_accounts where customer_id = person;
    return private.b_wallet_summary(wallet, now_at, (p_data->>'before')::bigint);
  end if;
  if p_action not in ('admin-goodwill','admin-set-expiry') then raise exception 'WALLET_INVALID'; end if;
  request_ref := nullif(p_data->>'requestId','')::uuid;
  reason := btrim(coalesce(p_data->>'reason',''));
  if request_ref is null or length(reason) not between 3 and 240 then raise exception 'WALLET_REASON_REQUIRED'; end if;
  body_hash := extensions.digest(jsonb_build_object('action',p_action,'data',p_data)::text,'sha256');
  perform pg_advisory_xact_lock(hashtextextended(request_ref::text, 527440));
  select a.* into prior from private.b_wallet_admin_audit a where a.request_id = request_ref;
  if found then
    if prior.actor_id <> auth.uid() or prior.request_hash <> body_hash then raise exception 'WALLET_RETRY_CHANGED'; end if;
    return prior.result;
  end if;
  if p_action = 'admin-goodwill' then
    person := (p_data->>'customerId')::uuid;
    fils := (p_data->>'amountFils')::bigint;
    if not settings.accept_new_payments then raise exception 'WALLET_DISABLED'; end if;
    if not exists (select 1 from private.customer_accounts where customer_id = person) then
      raise exception 'WALLET_CUSTOMER_UNAVAILABLE';
    end if;
    wallet := private.b_wallet_lock(person);
    entry := private.b_wallet_credit(wallet,'goodwill',fils,request_ref,now_at,private.b_wallet_expiry(now_at, settings.expiry_months));
    reply := jsonb_build_object('transactionId',entry::text,'amountFils',fils::text);
  else
    months := (p_data->>'expiryMonths')::integer;
    if months is null or months not between 1 and 60 then raise exception 'WALLET_INVALID_EXPIRY'; end if;
    update private.b_wallet_settings set expiry_months = months where singleton;
    reply := jsonb_build_object('expiryMonths',months);
  end if;
  insert into private.b_wallet_admin_audit(request_id,actor_id,operation,request_hash,reason,movement_id,result)
    values(request_ref,auth.uid(),case when entry is null then 'expiry' else 'goodwill' end,body_hash,reason,entry,reply);
  return reply;
end
$$;

create function public.b_wallet(p_action text, p_data jsonb default '{}'::jsonb) returns jsonb
language sql set search_path = '' as $$
  select b_wallet_api.dispatch(p_action,p_data)
$$;

revoke all on function private.b_wallet_customer(), private.b_wallet_lock(uuid),
  private.b_wallet_expiry(timestamptz,integer), private.b_wallet_summary(uuid,timestamptz,bigint),
  private.b_wallet_credit(uuid,text,bigint,uuid,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function b_wallet_api.dispatch(text,jsonb), public.b_wallet(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function b_wallet_api.dispatch(text,jsonb), public.b_wallet(text,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
