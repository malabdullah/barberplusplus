-- Hosted Test only. Share booking holds, but never provider fulfilment evidence.
begin;
alter table upayments_test.booking_attempts add column provider text not null default 'upayments'
  check(provider in ('upayments','myfatoorah'));
create table myfatoorah_test.booking_shops (
  shop_id uuid primary key references public.branches(id), enabled boolean not null default false
);
create table myfatoorah_test.booking_invoices (
  attempt_id uuid primary key references upayments_test.booking_attempts(id),
  invoice_id text unique, create_claimed boolean not null default false
);
alter table myfatoorah_test.booking_shops enable row level security;
alter table myfatoorah_test.booking_invoices enable row level security;
revoke all on myfatoorah_test.booking_shops,myfatoorah_test.booking_invoices from public,anon,authenticated,service_role;

-- Keep the proven booking/settlement transaction. Provider-specific wrappers
-- validate access/evidence before invoking it. UPayments still requires its
-- original refund key; MyFatoorah never fabricates a UPayments refund key.
do $$ declare definition text; needle text; begin
 select pg_get_functiondef('upayments_test.booking_with_wallet(text,uuid,jsonb)'::regprocedure) into definition;
 needle := 'or p_data->>''providerOrderId'' is null or p_data->>''providerRefundKey'' is null';
 if position(needle in definition)=0 then raise exception 'Capture contract changed'; end if;
 definition := replace(definition,needle,'or p_data->>''providerOrderId'' is null or (a.provider=''upayments'' and p_data->>''providerRefundKey'' is null)');
 needle := 'else ''upayments-booking-sandbox:'' || (p_data->>''trackId'') end';
 if position(needle in definition)=0 then raise exception 'Receipt contract changed'; end if;
 definition := replace(definition,needle,'else a.provider || ''-booking-sandbox:'' || (p_data->>''trackId'') end');
 -- The existing UPayments sweeper must not inquire/refund MyFatoorah IDs.
 needle := 'where x.next_check <= clock_timestamp() and (';
 if position(needle in definition)=0 then raise exception 'Sweep contract changed'; end if;
 definition := replace(definition,needle,'where x.provider=''upayments'' and x.next_check <= clock_timestamp() and (');
 execute definition;
end $$;

alter function public.upayments_test_booking(text,uuid,jsonb) rename to booking_with_methods;
alter function public.booking_with_methods(text,uuid,jsonb) set schema upayments_test;
revoke all on function upayments_test.booking_with_methods(text,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.upayments_test_booking(p_action text,p_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='12s' as $$
declare shop uuid; provider text; result jsonb;
begin
 if p_action='sweep' then
  result:=upayments_test.booking_with_methods(p_action,p_id,p_data);
  return coalesce((select jsonb_agg(v.value) from jsonb_array_elements_text(result) v
    join upayments_test.booking_attempts a on a.id=v.value::uuid where a.provider='upayments'),'[]'::jsonb);
 end if;
 if p_id is not null then select a.provider,a.shop_id into provider,shop from upayments_test.booking_attempts a where a.id=p_id; end if;
 if p_action='read' then select a.provider,a.shop_id into provider,shop from upayments_test.booking_attempts a
   where a.capability_hash=extensions.digest(((p_data->>'capability')::uuid)::text,'sha256'); end if;
 if shop is null then
  if p_action in ('start','request-approval') then shop:=(p_data->'booking'->>'branch_id')::uuid;
  elsif p_action in ('slots','book-at-shop') then shop:=(p_data->>'branch_id')::uuid;
  elsif p_action='approval-checkout' then select branch_id into shop from public.bookings where id=p_id; end if;
 end if;
 if provider='myfatoorah' or exists(select 1 from myfatoorah_test.booking_shops where shop_id=shop) then
  if p_action='slots' then
   return upayments_test.booking_with_methods(p_action,p_id,p_data)
     ||jsonb_build_object('online_payment',false,'wallet_payment',false);
  elsif p_action<>'book-at-shop' then raise exception 'UPAYMENTS_NOT_AVAILABLE'; end if;
 end if;
 return upayments_test.booking_with_methods(p_action,p_id,p_data);
end $$;
revoke all on function public.upayments_test_booking(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.upayments_test_booking(text,uuid,jsonb) to service_role;

create function public.myfatoorah_test_booking(p_action text,p_id uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='12s' as $$
declare a upayments_test.booking_attempts%rowtype; shop uuid; result jsonb; invoice text;
begin
 if p_action='route' then
  if p_data?'capability' then select shop_id into shop from upayments_test.booking_attempts
   where capability_hash=extensions.digest(((p_data->>'capability')::uuid)::text,'sha256') and provider='myfatoorah';
  elsif p_id is not null then
   select shop_id into shop from upayments_test.booking_attempts where id=p_id and provider='myfatoorah';
   if shop is null then select branch_id into shop from public.bookings where id=p_id; end if;
  else shop:=(p_data->>'branch_id')::uuid; end if;
  return to_jsonb(exists(select 1 from myfatoorah_test.booking_shops where shop_id=shop));
 end if;
 if p_action='sweep' then
  if p_data->>'secret' is distinct from (select decrypted_secret from vault.decrypted_secrets where name='upayments_test_booking_sweep')
   or length(coalesce(p_data->>'secret',''))<>64 then raise exception 'UPAYMENTS_FORBIDDEN'; end if;
  -- MyFatoorah refunds are a separate phase. Never send them to UPayments.
  update upayments_test.booking_attempts a set refund_state='review'
   where provider='myfatoorah' and refund_state is null and (state='review' or state='paid'
    and exists(select 1 from public.bookings b where b.id=a.id and b.status='cancelled'));
  return coalesce((select jsonb_agg(id) from (select a.id from upayments_test.booking_attempts a
    join myfatoorah_test.booking_invoices i on i.attempt_id=a.id
    where a.provider='myfatoorah' and a.state in ('pending','expired','failed') and i.invoice_id is not null
     and a.next_check<=clock_timestamp() and a.created_at>clock_timestamp()-interval '24 hours'
    order by a.next_check limit 8) rows),'[]'::jsonb);
 end if;
 if p_action='read' then
  select * into a from upayments_test.booking_attempts where provider='myfatoorah'
   and capability_hash=extensions.digest(((p_data->>'capability')::uuid)::text,'sha256');
  if not found then return null; end if;
 else
  if p_id is not null then
   perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
   select * into a from upayments_test.booking_attempts where id=p_id;
   if found and a.provider<>'myfatoorah' then raise exception 'UPAYMENTS_FORBIDDEN'; end if;
  end if;
 end if;
 shop:=a.shop_id;
 if p_action in ('start','request-approval') then shop:=(p_data->'booking'->>'branch_id')::uuid;
 elsif p_action='slots' then shop:=(p_data->>'branch_id')::uuid;
 elsif p_action='approval-checkout' and shop is null then select branch_id into shop from public.bookings where id=p_id; end if;
 if shop is null or not exists(select 1 from myfatoorah_test.booking_shops where shop_id=shop) then raise exception 'UPAYMENTS_NOT_AVAILABLE'; end if;
 if p_action in ('start','request-approval','approval-checkout') then
  if not exists(select 1 from myfatoorah_test.booking_shops where shop_id=shop and enabled)
    or coalesce((p_data->>'wallet_fils')::bigint,0)<>0 then raise exception 'UPAYMENTS_NOT_AVAILABLE'; end if;
  result:=upayments_test.booking_with_methods(p_action,p_id,case when p_action='approval-checkout' then p_data||jsonb_build_object('wallet_fils',0) else p_data-'wallet_fils' end);
  if p_action='request-approval' then return result; end if;
  update upayments_test.booking_attempts set provider='myfatoorah',wallet_id=null where id=p_id and wallet_fils=0;
  insert into myfatoorah_test.booking_invoices(attempt_id) values(p_id) on conflict do nothing;
  select * into a from upayments_test.booking_attempts where id=p_id;
  return result||jsonb_build_object('provider','myfatoorah','create',a.state='creating');
 elsif p_action='slots' then
  result:=upayments_test.booking_with_methods('slots',null,p_data);
  return result||jsonb_build_object('payment_provider','myfatoorah','wallet_payment',false,
    'online_payment',coalesce((result->>'online_payment')::boolean,false) and exists(select 1 from myfatoorah_test.booking_shops where shop_id=shop and enabled),
    'approval_payment',upayments_test.shop_payment_method(shop)<>'at_shop' and exists(select 1 from myfatoorah_test.booking_shops where shop_id=shop and enabled));
 elsif p_action='claim-create' then
  update myfatoorah_test.booking_invoices set create_claimed=true where attempt_id=p_id and not create_claimed
    and a.state='creating' and a.hold_until>clock_timestamp()+interval '1 minute';
  return to_jsonb(found);
 elsif p_action='inquire' then
  select invoice_id into invoice from myfatoorah_test.booking_invoices where attempt_id=p_id;
  return jsonb_build_object('id',a.id,'sessionId',invoice,'totalFils',a.total_fils,'holdUntil',a.hold_until,'state',a.state);
 elsif p_action='attach' then
  if coalesce(p_data->>'sessionId','')!~'^[0-9]{1,30}$' or coalesce(p_data->>'checkoutUrl','')!~'^https://demo[.]myfatoorah[.]com/' then raise exception 'UPAYMENTS_PROVIDER_MISMATCH'; end if;
  update myfatoorah_test.booking_invoices set invoice_id=p_data->>'sessionId'
   where attempt_id=p_id and create_claimed and invoice_id is null;
  if not found then raise exception 'UPAYMENTS_PROVIDER_MISMATCH'; end if;
 elsif p_action='capture' then
  select invoice_id into invoice from myfatoorah_test.booking_invoices where attempt_id=p_id;
  if invoice is null or invoice is distinct from p_data->>'sessionId' or coalesce(p_data->>'paymentId','')!~'^[0-9]{1,100}$'
   or p_data->>'externalIdentifier' is distinct from p_id::text or p_data->>'currency' is distinct from 'KWD'
   or (p_data->>'totalFils')::bigint is distinct from a.total_fils then raise exception 'UPAYMENTS_PROVIDER_MISMATCH'; end if;
  p_data:=p_data||jsonb_build_object('providerOrderId',invoice,'trackId','myfatoorah:'||(p_data->>'paymentId'));
 elsif p_action not in ('read','failed','defer') then raise exception 'INVALID_REQUEST';
 end if;
 result:=upayments_test.booking_with_methods(p_action,coalesce(p_id,a.id),p_data);
 if p_action='capture' and result->>'state'='review' then
  update upayments_test.booking_attempts set refund_state='review' where id=p_id and refund_state is null;
  result:=result||jsonb_build_object('refundState','review');
 end if;
 return result||jsonb_build_object('provider','myfatoorah');
end $$;
revoke all on function public.myfatoorah_test_booking(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.myfatoorah_test_booking(text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
