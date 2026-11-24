begin;

do $$
begin
  if to_regclass('private.cloud_test_emails') is null then
    raise exception 'MYFATOORAH_TEST_ONLY';
  end if;
end
$$;

create schema myfatoorah_test;
revoke all on schema myfatoorah_test from public, anon, authenticated, service_role;

-- An explicit allowlist restricts this experiment to synthetic Test businesses.
create table myfatoorah_test.fixture (
  business_id uuid primary key references private.billing_businesses(id),
  branch_id uuid not null references public.branches(id),
  manager_id uuid not null references auth.users(id),
  code_id uuid references private.billing_discount_codes(id),
  enabled boolean not null default false
);
create table myfatoorah_test.attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references private.billing_businesses(id),
  manager_id uuid not null references auth.users(id),
  request_id uuid not null,
  quote jsonb not null,
  code_id uuid references private.billing_discount_codes(id),
  state text not null default 'creating' check (state in ('creating','pending','paid','failed','review')),
  checkout_url text,
  session_id text unique,
  track_id text unique,
  invoice_id uuid unique references private.billing_invoices(id),
  created_at timestamptz not null default clock_timestamp(),
  last_checked_at timestamptz,
  creation_claimed_at timestamptz,
  check ((state = 'paid') = (invoice_id is not null)),
  unique (business_id, request_id)
);
create unique index myfatoorah_one_unresolved on myfatoorah_test.attempts (business_id)
  where state in ('creating','pending','review');
create index myfatoorah_attempt_history on myfatoorah_test.attempts (business_id, created_at desc);
create index myfatoorah_attempt_code on myfatoorah_test.attempts (code_id);
alter table myfatoorah_test.fixture enable row level security;
alter table myfatoorah_test.attempts enable row level security;

create function myfatoorah_test.view_attempt(a myfatoorah_test.attempts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'state', a.state, 'quote', a.quote, 'invoiceId', a.invoice_id,
    'checkoutUrl', case when a.state = 'pending' then a.checkout_url end,
    'createdAt',a.created_at,'providerInvoiceId',a.session_id,
    'periodEnd', (select i.period_ends_at from private.billing_invoices i where i.id = a.invoice_id)
  )
$$;

create table myfatoorah_test.capacity_quotes (
  id uuid primary key,
  business_id uuid not null references private.billing_businesses(id) on delete cascade,
  manager_id uuid not null references auth.users(id) on delete cascade,
  details jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index myfatoorah_capacity_quotes_business on myfatoorah_test.capacity_quotes (business_id);
create index myfatoorah_capacity_quotes_manager on myfatoorah_test.capacity_quotes (manager_id);
alter table myfatoorah_test.capacity_quotes enable row level security;
revoke all on myfatoorah_test.capacity_quotes from public,anon,authenticated,service_role;

create function myfatoorah_test.capacity_basis_matches(s private.billing_subscriptions,q jsonb) returns boolean
language sql volatile set search_path='' as $$
  select coalesce(
    s.period_started_at=(q->>'periodStart')::timestamptz
    and s.period_started_at<=clock_timestamp()
    and s.period_ends_at=(q->>'periodEnd')::timestamptz
    and s.period_ends_at>clock_timestamp()
    and s.frequency=q->>'frequency'
    and s.paid_capacity=(q->>'fromCapacity')::integer,
    false
  )
$$;
revoke all on function myfatoorah_test.capacity_basis_matches(private.billing_subscriptions,jsonb)
  from public,anon,authenticated,service_role;

create or replace function myfatoorah_test.manager_api(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  actor uuid := auth.uid();
  sid uuid := nullif(auth.jwt()->>'session_id','')::uuid;
  bid uuid := (p_data->>'businessId')::uuid;
  requested_id uuid;
  f myfatoorah_test.fixture%rowtype;
  a myfatoorah_test.attempts%rowtype;
  c private.billing_discount_codes%rowtype;
  s private.billing_subscriptions%rowtype;
  desired integer;
  active_count integer;
  term text;
  code_text text;
  subtotal bigint;
  discount bigint := 0;
  quote jsonb;
  payment_method text := coalesce(p_data->>'paymentMethod','KNET');
  kind text := coalesce(p_data->>'kind','subscription');
  saved myfatoorah_test.capacity_quotes%rowtype;
  quote_time timestamptz;
  expiry timestamptz;
  price_basis jsonb;
begin
  if p_action is null or p_action not in ('read','quote','start')
    or kind not in ('subscription','capacity')
    or payment_method not in ('KNET','CARD')
    or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text) > 4096 then
    raise exception 'MYFATOORAH_INVALID';
  end if;
  if actor is null or private.live_staff_role() is distinct from 'manager'
    or sid is null or not exists (
      select 1 from auth.sessions x where x.id=sid and x.user_id=actor
        and (x.not_after is null or x.not_after>now())
    ) or exists (select 1 from private.account_revoked_sessions x where x.session_id=sid)
    or not public.staff_token_factor_satisfied(actor,sid,auth.jwt()->>'aal') then
    raise exception 'MYFATOORAH_FORBIDDEN' using errcode = '42501';
  end if;
  select pilot.* into f
  from myfatoorah_test.fixture pilot
  join private.billing_businesses b on b.id=pilot.business_id and b.billing_manager_id=actor
  join private.billing_shops l on l.business_id=b.id and l.branch_id=pilot.branch_id
  join public.branches sh on sh.id=l.branch_id and sh.manager_id=actor
  where pilot.enabled and pilot.manager_id=actor and pilot.business_id=bid
    and (select count(*) from private.billing_shops where business_id=b.id)=1;
  if not found then
    if p_action='read' then return jsonb_build_object('eligible',false); end if;
    raise exception 'MYFATOORAH_FORBIDDEN' using errcode = '42501';
  end if;

  if p_action='read' then
    select * into a from myfatoorah_test.attempts x where x.business_id=bid and x.manager_id=actor
    order by x.created_at desc limit 1;
    return jsonb_build_object('eligible',true,'attempt',case when a.id is not null then myfatoorah_test.view_attempt(a) end);
  end if;

  select * into strict s from private.billing_subscriptions x where x.business_id=bid for update;
  if p_action='start' then
    requested_id := (p_data->>'requestId')::uuid;
    if requested_id is null then raise exception 'MYFATOORAH_INVALID'; end if;
    select * into a from myfatoorah_test.attempts x where x.business_id=bid and x.request_id=requested_id;
    if found then
      if a.manager_id<>actor or a.quote is distinct from p_data->'quote'
        or coalesce(a.quote->>'kind','subscription') <> kind
        or a.quote->>'paymentMethod' is distinct from payment_method then
        raise exception 'MYFATOORAH_QUOTE_CHANGED';
      end if;
      return jsonb_build_object('attempt',myfatoorah_test.view_attempt(a),'create',false);
    end if;
  end if;
  if exists (select 1 from myfatoorah_test.attempts x where x.business_id=bid and x.state in ('creating','pending','review')) then
    raise exception 'MYFATOORAH_UNRESOLVED';
  end if;
  if kind='capacity' then
    if p_action='start' then
      select * into saved from myfatoorah_test.capacity_quotes q
      where q.id=(p_data->'quote'->>'quoteId')::uuid and q.business_id=bid and q.manager_id=actor
      for update;
      if not found or saved.consumed_at is not null or saved.expires_at<=clock_timestamp() then
        raise exception 'MYFATOORAH_QUOTE_EXPIRED';
      end if;
      if saved.details is distinct from p_data->'quote'
        or p_data->>'count' is distinct from saved.details->>'count'
        or saved.details->>'paymentMethod' is distinct from payment_method
        or not myfatoorah_test.capacity_basis_matches(s,saved.details)
        or private.billing_active_count(bid)>(saved.details->>'count')::integer then
        raise exception 'MYFATOORAH_QUOTE_CHANGED';
      end if;
      if s.period_ends_at<=clock_timestamp()+interval '2 minutes' then raise exception 'MYFATOORAH_CAPACITY_UNAVAILABLE'; end if;
      insert into myfatoorah_test.attempts (business_id,manager_id,request_id,quote)
      values (bid,actor,requested_id,saved.details) returning * into a;
      update myfatoorah_test.capacity_quotes set consumed_at=clock_timestamp() where id=saved.id;
      return jsonb_build_object('attempt',myfatoorah_test.view_attempt(a),'create',true);
    end if;

    desired := (p_data->>'count')::integer;
    if desired is null or desired not between s.paid_capacity+1 and 100
      or desired<private.billing_active_count(bid) then raise exception 'MYFATOORAH_INVALID'; end if;
    if s.period_ends_at is null or s.period_ends_at<=clock_timestamp()+interval '2 minutes' then
      raise exception 'MYFATOORAH_CAPACITY_UNAVAILABLE';
    end if;
    price_basis := private.billing_capacity_quote(bid,desired);
    if price_basis->>'reason' is distinct from 'BILLING_CAPACITY_REQUIRED'
      or coalesce((price_basis->>'additionalFils')::bigint,0)<=0 then
      raise exception 'MYFATOORAH_CAPACITY_UNAVAILABLE';
    end if;

    quote_time := (price_basis->>'quotedAt')::timestamptz;
    expiry := least(quote_time+interval '5 minutes',s.period_ends_at-interval '2 minutes');
    if expiry<=clock_timestamp() then raise exception 'MYFATOORAH_CAPACITY_UNAVAILABLE'; end if;
    requested_id := gen_random_uuid();
    quote := jsonb_build_object(
      'paymentMethod',payment_method,'quoteId',requested_id,'kind','capacity','frequency',s.frequency,'count',desired,
      'fromCapacity',s.paid_capacity,'addedPlaces',desired-s.paid_capacity,'currency','KWD',
      'subtotalFils',(price_basis->>'additionalFils')::bigint,'discountFils',0,
      'totalFils',(price_basis->>'additionalFils')::bigint,'quotedAt',quote_time,'expiresAt',expiry,
      'periodStart',s.period_started_at,'periodEnd',s.period_ends_at
    );
    insert into myfatoorah_test.capacity_quotes (id,business_id,manager_id,details,expires_at)
    values (requested_id,bid,actor,quote,expiry);
    return quote;
  end if;
  if s.period_ends_at > clock_timestamp() then raise exception 'MYFATOORAH_TERM_ACTIVE'; end if;

  active_count := private.billing_active_count(bid);
  term := p_data->>'frequency';
  desired := (p_data->>'count')::integer;
  if term is null or term not in ('monthly','yearly') or desired is null
    or desired not between greatest(1,active_count) and 100 then
    raise exception 'MYFATOORAH_INVALID';
  end if;
  subtotal := private.billing_price(desired, term);
  code_text := upper(btrim(coalesce(p_data->>'code','')));
  if code_text <> '' then
    -- Only the dedicated one-payment sandbox offer can be used in this pilot.
    select * into c from private.billing_discount_codes d where d.id=f.code_id
      and d.code=code_text and d.enabled and d.expires_at>clock_timestamp()
      and d.payments=1 and d.eligibility in ('both',term) for update;
    if not found then raise exception 'BILLING_CODE_UNAVAILABLE'; end if;
    if exists (select 1 from private.billing_redemptions r where r.code_id=c.id and r.business_id=bid)
      or (c.redemption_limit is not null and
           (select count(*) from private.billing_redemptions r where r.code_id=c.id)>=c.redemption_limit) then
      raise exception 'BILLING_CODE_USED';
    end if;
    discount := least(subtotal, case when c.kind='fixed' then c.value else (subtotal*c.value+50)/100 end);
  end if;
  if subtotal <= discount then raise exception 'MYFATOORAH_ZERO_TOTAL'; end if;
  quote := jsonb_build_object(
    'paymentMethod',payment_method,'frequency',term,'count',desired,'activeCount',active_count,'currency','KWD',
    'subtotalFils',subtotal,'discountFils',discount,'totalFils',subtotal-discount,'code',code_text
  );
  if p_action='quote' then return quote; end if;
  if quote is distinct from p_data->'quote' then raise exception 'MYFATOORAH_QUOTE_CHANGED'; end if;
  insert into myfatoorah_test.attempts (business_id,manager_id,request_id,quote,code_id)
  values (bid,actor,requested_id,quote,c.id) returning * into a;
  return jsonb_build_object('attempt',myfatoorah_test.view_attempt(a),'create',true);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'MYFATOORAH_INVALID';
end
$$;

create or replace function myfatoorah_test.provider_api(p_action text, p_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  a myfatoorah_test.attempts%rowtype;
  s private.billing_subscriptions%rowtype;
  c private.billing_discount_codes%rowtype;
  receipt uuid;
  start_at timestamptz;
  end_at timestamptz;
  term text;
  track text := p_data->>'trackId';
  captured boolean := p_action='capture';
  capacity_purchase boolean;
begin
  if p_action is null or p_action not in ('claim-create','attach','create-rejected','inquire','capture','failed')
    or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>4096 then
    raise exception 'MYFATOORAH_INVALID';
  end if;
  -- Use the same lock order as checkout, including with concurrent gateway events.
  select * into s from private.billing_subscriptions x
  where x.business_id=(select business_id from myfatoorah_test.attempts where id=p_id)
  for update;
  select * into a from myfatoorah_test.attempts where id=p_id for update;
  if not found then return null; end if;
  capacity_purchase := coalesce(a.quote->>'kind','subscription')='capacity';
  if p_action='claim-create' then
    update myfatoorah_test.attempts set creation_claimed_at=clock_timestamp()
    where id=p_id and state='creating' and creation_claimed_at is null;
    return to_jsonb(found);
  end if;
  if a.state='paid' then return myfatoorah_test.view_attempt(a); end if;
  if p_action='attach' and a.state='creating' and a.creation_claimed_at is not null
    and p_data->>'sessionId' ~ '^[0-9]{1,100}$' then
    update myfatoorah_test.attempts set state='pending', session_id=p_data->>'sessionId',
      checkout_url=p_data->>'checkoutUrl' where id=p_id returning * into a;
  elsif p_action='create-rejected' and a.state='creating' then
    update myfatoorah_test.attempts set state='failed' where id=p_id returning * into a;
  elsif p_action='inquire' then
    if a.state <> 'pending' or a.last_checked_at>clock_timestamp()-interval '5 seconds' then return null; end if;
    update myfatoorah_test.attempts set last_checked_at=clock_timestamp() where id=p_id;
    return jsonb_build_object('sessionId',a.session_id);
  elsif p_action in ('capture','failed') then
    if p_data->>'orderId' is distinct from p_id::text
      or a.session_id is null or p_data->>'sessionId' is distinct from a.session_id
      or (captured and (track is null or track !~ '^[0-9]{1,100}$'))
      or (a.track_id is not null and a.track_id<>track) then
      raise exception 'MYFATOORAH_PROVIDER_MISMATCH';
    end if;
    if p_action='failed' and a.state in ('pending','creating') then
      update myfatoorah_test.attempts set state='failed' where id=p_id returning * into a;
    elsif captured and a.state in ('pending','failed') then
      if p_data->>'totalFils' is distinct from a.quote->>'totalFils'
        or p_data->>'currency' is distinct from 'KWD' then
        raise exception 'MYFATOORAH_PROVIDER_MISMATCH';
      end if;
      if a.code_id is not null then
        select * into c from private.billing_discount_codes where id=a.code_id for update;
      end if;
      if a.state='failed' or s.business_id is null
        or (capacity_purchase and not myfatoorah_test.capacity_basis_matches(s,a.quote))
        or (not capacity_purchase and s.period_ends_at>clock_timestamp())
        or private.billing_active_count(a.business_id)>(a.quote->>'count')::integer
        or (c.id is not null and (
          exists (select 1 from private.billing_redemptions r where r.code_id=c.id and r.business_id=a.business_id)
          or (c.redemption_limit is not null and
              (select count(*) from private.billing_redemptions r where r.code_id=c.id)>=c.redemption_limit)
        )) then
        -- A conflicting capture requires review before updating the subscription.
        -- If a replacement is already open, keep the earlier terminal row and record the conflict.
        if not exists (select 1 from myfatoorah_test.attempts x where x.business_id=a.business_id
            and x.id<>p_id and x.state in ('creating','pending','review')) then
          update myfatoorah_test.attempts set state='review', track_id=track where id=p_id returning * into a;
        end if;
        if a.track_id is distinct from track then
          update myfatoorah_test.attempts set track_id=track where id=p_id and track_id is null returning * into a;
          if not found then return null; end if;
        end if;
        if not exists (select 1 from private.billing_audit x where x.business_id=a.business_id
            and x.action='myfatoorah-test-review' and x.details->>'attemptId'=p_id::text) then
          insert into private.billing_audit (business_id,actor_id,action,reason,details)
          values (a.business_id,a.manager_id,'myfatoorah-test-review','Sandbox capture requires review',
            jsonb_build_object('attemptId',a.id,'trackId',track));
        end if;
        return myfatoorah_test.view_attempt(a);
      end if;
      if capacity_purchase then
        start_at := (a.quote->>'quotedAt')::timestamptz;
        end_at := s.period_ends_at;
      else
        term := a.quote->>'frequency';
        start_at := case when s.renewal_requested and s.renewal_failed_at is not null
          and clock_timestamp()<s.period_ends_at+interval '72 hours' then s.period_ends_at else clock_timestamp() end;
        end_at := ((start_at at time zone 'Asia/Kuwait') +
          case term when 'monthly' then interval '1 month' else interval '1 year' end) at time zone 'Asia/Kuwait';
      end if;
      insert into private.billing_invoices
        (business_id,provider_reference,state,subtotal_fils,discount_fils,period_starts_at,period_ends_at)
      values (a.business_id,
        (case when capacity_purchase then 'myfatoorah-capacity-sandbox:' else 'myfatoorah-sandbox:' end)||track,
        'paid',(a.quote->>'subtotalFils')::bigint,(a.quote->>'discountFils')::bigint,start_at,end_at)
      returning id into receipt;
      if capacity_purchase then
        update private.billing_subscriptions set paid_capacity=(a.quote->>'count')::integer,revision=revision+1
        where business_id=a.business_id;
      else
        update private.billing_subscriptions set frequency=term,next_frequency=null,period_started_at=start_at,
          period_ends_at=end_at,paid_capacity=(a.quote->>'count')::integer,renewal_failed_at=null,revision=revision+1
        where business_id=a.business_id;
      end if;
      if a.code_id is not null then
        insert into private.billing_redemptions (code_id,business_id,invoice_id) values (a.code_id,a.business_id,receipt);
      end if;
      update myfatoorah_test.attempts set state='paid',track_id=track,invoice_id=receipt where id=p_id returning * into a;
      insert into private.billing_audit (business_id,actor_id,action,reason,details)
      values (a.business_id,a.manager_id,case when capacity_purchase then 'myfatoorah-test-capacity' else 'myfatoorah-test-payment' end,
        'Verified MyFatoorah sandbox capture',
        jsonb_build_object('attemptId',a.id,'invoiceId',receipt,'totalFils',a.quote->'totalFils',
          'addedPlaces',a.quote->'addedPlaces'));
    end if;
  end if;
  return myfatoorah_test.view_attempt(a);
end
$$;

revoke all on all functions in schema myfatoorah_test from public,anon,authenticated,service_role;
grant usage on schema myfatoorah_test to authenticated,service_role;
grant execute on function myfatoorah_test.manager_api(text,jsonb) to authenticated;
grant execute on function myfatoorah_test.provider_api(text,uuid,jsonb) to service_role;

create function public.myfatoorah_test_manager(p_action text, p_data jsonb) returns jsonb
language sql set search_path = '' as $$ select myfatoorah_test.manager_api(p_action,p_data) $$;
create function public.myfatoorah_test_provider(p_action text, p_id uuid, p_data jsonb) returns jsonb
language sql set search_path = '' as $$ select myfatoorah_test.provider_api(p_action,p_id,p_data) $$;
revoke all on function public.myfatoorah_test_manager(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.myfatoorah_test_provider(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.myfatoorah_test_manager(text,jsonb) to authenticated;
grant execute on function public.myfatoorah_test_provider(text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
