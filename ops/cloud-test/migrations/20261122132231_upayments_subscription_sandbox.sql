begin;

do $$
begin
  if to_regclass('private.cloud_test_emails') is null then
    raise exception 'UPAYMENTS_TEST_ONLY';
  end if;
end
$$;

create schema upayments_test;
revoke all on schema upayments_test from public, anon, authenticated, service_role;

-- A singleton binding keeps this experiment restricted to one synthetic business.
create table upayments_test.fixture (
  singleton boolean primary key default true check (singleton),
  business_id uuid not null references private.billing_businesses(id),
  branch_id uuid not null references public.branches(id),
  manager_id uuid not null references auth.users(id),
  code_id uuid references private.billing_discount_codes(id),
  enabled boolean not null default false
);
create table upayments_test.attempts (
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
  check ((state = 'paid') = (invoice_id is not null)),
  unique (business_id, request_id)
);
create unique index upayments_one_unresolved on upayments_test.attempts (business_id)
  where state in ('creating','pending','review');
create index upayments_attempt_history on upayments_test.attempts (business_id, created_at desc);
create index upayments_attempt_code on upayments_test.attempts (code_id);
alter table upayments_test.fixture enable row level security;
alter table upayments_test.attempts enable row level security;

create function upayments_test.view_attempt(a upayments_test.attempts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'state', a.state, 'quote', a.quote, 'invoiceId', a.invoice_id,
    'checkoutUrl', case when a.state = 'pending' then a.checkout_url end,
    'periodEnd', (select i.period_ends_at from private.billing_invoices i where i.id = a.invoice_id)
  )
$$;

create function upayments_test.manager_api(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  actor uuid := auth.uid();
  sid uuid := nullif(auth.jwt()->>'session_id','')::uuid;
  bid uuid := (p_data->>'businessId')::uuid;
  requested_id uuid;
  f upayments_test.fixture%rowtype;
  a upayments_test.attempts%rowtype;
  c private.billing_discount_codes%rowtype;
  s private.billing_subscriptions%rowtype;
  desired integer;
  active_count integer;
  term text;
  code_text text;
  subtotal bigint;
  discount bigint := 0;
  quote jsonb;
begin
  if p_action is null or p_action not in ('read','quote','start')
    or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text) > 4096 then
    raise exception 'UPAYMENTS_INVALID';
  end if;
  if actor is null or private.live_staff_role() is distinct from 'manager'
    or sid is null or not exists (
      select 1 from auth.sessions x where x.id=sid and x.user_id=actor
        and (x.not_after is null or x.not_after>now())
    ) or exists (select 1 from private.account_revoked_sessions x where x.session_id=sid)
    or not public.staff_token_factor_satisfied(actor,sid,auth.jwt()->>'aal') then
    raise exception 'UPAYMENTS_FORBIDDEN' using errcode = '42501';
  end if;
  select pilot.* into f
  from upayments_test.fixture pilot
  join private.billing_businesses b on b.id=pilot.business_id and b.billing_manager_id=actor
  join private.billing_shops l on l.business_id=b.id and l.branch_id=pilot.branch_id
  join public.branches sh on sh.id=l.branch_id and sh.manager_id=actor
  where pilot.enabled and pilot.manager_id=actor and pilot.business_id=bid
    and (select count(*) from private.billing_shops where business_id=b.id)=1;
  if not found then
    if p_action='read' then return jsonb_build_object('eligible',false); end if;
    raise exception 'UPAYMENTS_FORBIDDEN' using errcode = '42501';
  end if;

  if p_action='read' then
    select * into a from upayments_test.attempts x where x.business_id=bid and x.manager_id=actor
    order by x.created_at desc limit 1;
    return jsonb_build_object('eligible',true,'attempt',case when a.id is not null then upayments_test.view_attempt(a) end);
  end if;

  select * into strict s from private.billing_subscriptions x where x.business_id=bid for update;
  if p_action='start' then
    requested_id := (p_data->>'requestId')::uuid;
    if requested_id is null then raise exception 'UPAYMENTS_INVALID'; end if;
    select * into a from upayments_test.attempts x where x.business_id=bid and x.request_id=requested_id;
    if found then
      if a.manager_id<>actor or a.quote is distinct from p_data->'quote' then
        raise exception 'UPAYMENTS_QUOTE_CHANGED';
      end if;
      return jsonb_build_object('attempt',upayments_test.view_attempt(a),'create',false);
    end if;
  end if;
  if exists (select 1 from upayments_test.attempts x where x.business_id=bid and x.state in ('creating','pending','review')) then
    raise exception 'UPAYMENTS_UNRESOLVED';
  end if;
  if s.period_ends_at > clock_timestamp() then raise exception 'UPAYMENTS_TERM_ACTIVE'; end if;

  active_count := private.billing_active_count(bid);
  term := p_data->>'frequency';
  desired := (p_data->>'count')::integer;
  if term is null or term not in ('monthly','yearly') or desired is null
    or desired not between greatest(1,active_count) and 100 then
    raise exception 'UPAYMENTS_INVALID';
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
  if subtotal <= discount then raise exception 'UPAYMENTS_ZERO_TOTAL'; end if;
  quote := jsonb_build_object(
    'frequency',term,'count',desired,'activeCount',active_count,'currency','KWD',
    'subtotalFils',subtotal,'discountFils',discount,'totalFils',subtotal-discount,'code',code_text
  );
  if p_action='quote' then return quote; end if;
  if quote is distinct from p_data->'quote' then raise exception 'UPAYMENTS_QUOTE_CHANGED'; end if;
  insert into upayments_test.attempts (business_id,manager_id,request_id,quote,code_id)
  values (bid,actor,requested_id,quote,c.id) returning * into a;
  return jsonb_build_object('attempt',upayments_test.view_attempt(a),'create',true);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'UPAYMENTS_INVALID';
end
$$;

-- Only the function backend may call fulfillment or attach provider identifiers.
create function upayments_test.provider_api(p_action text, p_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  a upayments_test.attempts%rowtype;
  s private.billing_subscriptions%rowtype;
  c private.billing_discount_codes%rowtype;
  receipt uuid;
  start_at timestamptz;
  end_at timestamptz;
  term text;
  track text := p_data->>'trackId';
  captured boolean := p_action='capture';
begin
  if p_action is null or p_action not in ('attach','create-rejected','inquire','capture','failed')
    or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>4096 then
    raise exception 'UPAYMENTS_INVALID';
  end if;
  -- Use the same lock order as checkout, including with concurrent gateway events.
  select * into s from private.billing_subscriptions x
  where x.business_id=(select business_id from upayments_test.attempts where id=p_id)
  for update;
  select * into a from upayments_test.attempts where id=p_id for update;
  if not found then return null; end if;
  if a.state='paid' then return upayments_test.view_attempt(a); end if;
  if p_action='attach' and a.state='creating' then
    update upayments_test.attempts set state='pending', session_id=p_data->>'sessionId',
      checkout_url=p_data->>'checkoutUrl' where id=p_id returning * into a;
  elsif p_action='create-rejected' and a.state='creating' then
    update upayments_test.attempts set state='failed' where id=p_id returning * into a;
  elsif p_action='inquire' then
    if a.state <> 'pending' or a.last_checked_at>clock_timestamp()-interval '5 seconds' then return null; end if;
    update upayments_test.attempts set last_checked_at=clock_timestamp() where id=p_id;
    return jsonb_build_object('sessionId',a.session_id);
  elsif p_action in ('capture','failed') then
    if p_data->>'orderId' is distinct from replace(p_id::text,'-','')
      or a.session_id is null or p_data->>'sessionId' is distinct from a.session_id
      or track is null or track !~ '^[A-Za-z0-9_-]{10,100}$'
      or (a.track_id is not null and a.track_id<>track) then
      raise exception 'UPAYMENTS_PROVIDER_MISMATCH';
    end if;
    if p_action='failed' and a.state in ('pending','creating') then
      update upayments_test.attempts set state='failed' where id=p_id returning * into a;
    elsif captured and a.state in ('pending','failed') then
      if p_data->>'totalFils' is distinct from a.quote->>'totalFils'
        or p_data->>'currency' is distinct from 'KWD' then
        raise exception 'UPAYMENTS_PROVIDER_MISMATCH';
      end if;
      if a.code_id is not null then
        select * into c from private.billing_discount_codes where id=a.code_id for update;
      end if;
      if a.state='failed' or s.business_id is null or s.period_ends_at>clock_timestamp()
        or private.billing_active_count(a.business_id)>(a.quote->>'count')::integer
        or (c.id is not null and (
          exists (select 1 from private.billing_redemptions r where r.code_id=c.id and r.business_id=a.business_id)
          or (c.redemption_limit is not null and
              (select count(*) from private.billing_redemptions r where r.code_id=c.id)>=c.redemption_limit)
        )) then
        -- A paid but conflicting order needs review and must never issue a second term.
        -- If a replacement is already open, keep the earlier terminal row and record the conflict.
        if not exists (select 1 from upayments_test.attempts x where x.business_id=a.business_id
            and x.id<>p_id and x.state in ('creating','pending','review')) then
          update upayments_test.attempts set state='review', track_id=track where id=p_id returning * into a;
        end if;
        if a.track_id is distinct from track then
          update upayments_test.attempts set track_id=track where id=p_id and track_id is null returning * into a;
          if not found then return null; end if;
        end if;
        if not exists (select 1 from private.billing_audit x where x.business_id=a.business_id
            and x.action='upayments-test-review' and x.details->>'attemptId'=p_id::text) then
          insert into private.billing_audit (business_id,actor_id,action,reason,details)
          values (a.business_id,a.manager_id,'upayments-test-review','Sandbox capture requires review',
            jsonb_build_object('attemptId',a.id,'trackId',track));
        end if;
        return upayments_test.view_attempt(a);
      end if;
      term := a.quote->>'frequency';
      start_at := case when s.renewal_requested and s.renewal_failed_at is not null
        and clock_timestamp()<s.period_ends_at+interval '72 hours' then s.period_ends_at else clock_timestamp() end;
      end_at := ((start_at at time zone 'Asia/Kuwait') +
        case term when 'monthly' then interval '1 month' else interval '1 year' end) at time zone 'Asia/Kuwait';
      insert into private.billing_invoices
        (business_id,provider_reference,state,subtotal_fils,discount_fils,period_starts_at,period_ends_at)
      values (a.business_id,'upayments-sandbox:'||track,'paid',
        (a.quote->>'subtotalFils')::bigint,(a.quote->>'discountFils')::bigint,start_at,end_at)
      returning id into receipt;
      update private.billing_subscriptions set frequency=term,next_frequency=null,period_started_at=start_at,
        period_ends_at=end_at,paid_capacity=(a.quote->>'count')::integer,renewal_failed_at=null,revision=revision+1
        where business_id=a.business_id;
      if a.code_id is not null then
        insert into private.billing_redemptions (code_id,business_id,invoice_id) values (a.code_id,a.business_id,receipt);
      end if;
      update upayments_test.attempts set state='paid',track_id=track,invoice_id=receipt where id=p_id returning * into a;
      insert into private.billing_audit (business_id,actor_id,action,reason,details)
      values (a.business_id,a.manager_id,'upayments-test-payment','Verified UPayments sandbox capture',
        jsonb_build_object('attemptId',a.id,'invoiceId',receipt,'totalFils',a.quote->'totalFils'));
    end if;
  end if;
  return upayments_test.view_attempt(a);
end
$$;

revoke all on all functions in schema upayments_test from public,anon,authenticated,service_role;
grant usage on schema upayments_test to authenticated,service_role;
grant execute on function upayments_test.manager_api(text,jsonb) to authenticated;
grant execute on function upayments_test.provider_api(text,uuid,jsonb) to service_role;

create function public.upayments_test_manager(p_action text, p_data jsonb) returns jsonb
language sql set search_path = '' as $$ select upayments_test.manager_api(p_action,p_data) $$;
create function public.upayments_test_provider(p_action text, p_id uuid, p_data jsonb) returns jsonb
language sql set search_path = '' as $$ select upayments_test.provider_api(p_action,p_id,p_data) $$;
revoke all on function public.upayments_test_manager(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.upayments_test_provider(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.upayments_test_manager(text,jsonb) to authenticated;
grant execute on function public.upayments_test_provider(text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
