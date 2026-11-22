begin;

alter table upayments_test.attempts add column creation_claimed_at timestamptz;

create or replace function upayments_test.provider_api(p_action text, p_id uuid, p_data jsonb) returns jsonb
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
  if p_action is null or p_action not in ('claim-create','attach','create-rejected','inquire','capture','failed')
    or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>4096 then
    raise exception 'UPAYMENTS_INVALID';
  end if;
  -- Use the same lock order as checkout, including with concurrent gateway events.
  select * into s from private.billing_subscriptions x
  where x.business_id=(select business_id from upayments_test.attempts where id=p_id)
  for update;
  select * into a from upayments_test.attempts where id=p_id for update;
  if not found then return null; end if;
  if p_action='claim-create' then
    update upayments_test.attempts set creation_claimed_at=clock_timestamp()
    where id=p_id and state='creating' and creation_claimed_at is null;
    return to_jsonb(found);
  end if;
  if a.state='paid' then return upayments_test.view_attempt(a); end if;
  if p_action='attach' and a.state='creating' and a.creation_claimed_at is not null
    and p_data->>'sessionId' ~ '^[A-Za-z0-9_-]{10,100}$' then
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
      or (captured and (track is null or track !~ '^[A-Za-z0-9_-]{10,100}$'))
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

commit;
