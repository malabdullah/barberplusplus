-- Serialize eligibility checks with concurrent appointment edits.
create or replace function settlement_api.dispatch(p_action text,p_data jsonb,p_admin boolean)returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='25s'as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid();shop uuid;request_id uuid;input_hash text;cached private.settlement_requests%rowtype;
 result jsonb;reason text:=btrim(coalesce(p_data->>'reason',''));amount bigint;fee bigint;reference text:=btrim(p_data->>'reference');
 happened timestamptz;settled timestamptz;rate private.settlement_rates%rowtype;agreement private.settlement_agreements%rowtype;
 receipt private.settlement_receipts%rowtype;current_receipt private.settlement_receipt_state%rowtype;booking public.bookings%rowtype;
 statement private.settlement_statements%rowtype;payout private.settlement_payouts%rowtype;beneficiary private.settlement_beneficiaries%rowtype;
 event private.settlement_journals%rowtype;preview jsonb;operation uuid;commission bigint;refunded bigint;commission_refunded bigint;
 entries jsonb;period date;available bigint;remaining bigint;allocation bigint;new_id uuid;row_item record;
begin
 if actor is null or p_admin is null or(p_admin and not public.is_admin())or(not p_admin and private.live_staff_role()is distinct from 'manager')then
  raise exception 'SETTLEMENT_FORBIDDEN'using errcode='42501';end if;
 if not exists(select 1 from private.settlement_runtime where singleton and enabled)then raise exception 'SETTLEMENT_DISABLED';end if;
 if p_action is null or p_data is null or jsonb_typeof(p_data)<>'object'or octet_length(p_data::text)>16384 then raise exception 'SETTLEMENT_INVALID';end if;
 if p_action in('shops','settings','bookings','receipts','statements','statement','statement-rows','payouts','history','journal')then
  return private.settlement_read(p_action,p_data,p_admin);
 end if;
 if not p_admin then raise exception 'SETTLEMENT_FORBIDDEN'using errcode='42501';end if;
 if p_action not in('save-policy','save-beneficiary','record-receipt','record-fee','record-refund','settle-receipt','hold','release-hold','reverse-event','prepare-statement','finalize-statement','cancel-statement','prepare-payout','confirm-payout','uncertain-payout','fail-payout','cancel-payout')then raise exception 'SETTLEMENT_INVALID';end if;
 request_id:=(p_data->>'requestId')::uuid;
 if request_id is null then raise exception 'SETTLEMENT_REQUEST_REQUIRED';end if;
 input_hash:=encode(extensions.digest(jsonb_build_object('action',p_action,'data',p_data)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_id::text,991));
 select *into cached from private.settlement_requests where actor_id=actor and settlement_requests.request_id=request_id;
 if cached.request_id is not null then
  if cached.input_hash<>input_hash then raise exception 'SETTLEMENT_RETRY_CHANGED';end if;return cached.result;
 end if;
 shop:=nullif(p_data->>'shopId','')::uuid;
 if shop is null and p_action<>'save-policy'then raise exception 'SETTLEMENT_SHOP_REQUIRED';end if;
 if shop is not null then
  perform 1 from public.branches where id=shop for update;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND';end if;
 else perform pg_advisory_xact_lock(992);end if;
 -- Freeze eligibility while preparing/finalizing statements or transfers.
 -- Concurrent booking edits may proceed before or after this transaction,
 -- never between the eligibility check and recording its allocation.
 if p_action in('prepare-statement','finalize-statement','prepare-payout','confirm-payout')then
  perform 1 from public.bookings b where exists(select 1 from private.settlement_receipts r where r.booking_id=b.id and r.shop_id=shop)
   order by b.id for share of b;
 end if;
 if p_action in('save-policy','save-beneficiary','hold','release-hold','reverse-event','uncertain-payout','fail-payout','cancel-payout','cancel-statement')and length(reason)not between 3 and 240 then raise exception 'SETTLEMENT_REASON_REQUIRED';end if;
 if p_action in('record-receipt','record-fee','record-refund')and(reference is null or length(reference)not between 1 and 120)then raise exception 'SETTLEMENT_REFERENCE_REQUIRED';end if;

 if p_action='save-policy'then
  if p_data ? 'rateBps'then
   insert into private.settlement_rates(shop_id,rate_bps,created_by,reason)values(shop,(p_data->>'rateBps')::integer,actor,reason)returning id into new_id;
  end if;
  if p_data ? 'feeBearer'then
   if shop is null then raise exception 'SETTLEMENT_SHOP_REQUIRED';end if;
   insert into private.settlement_agreements(shop_id,fee_bearer,created_by,reason)values(shop,p_data->>'feeBearer',actor,reason)returning id into new_id;
  end if;
  if new_id is null then raise exception 'SETTLEMENT_INVALID';end if;
 elsif p_action='save-beneficiary'then
  if exists(select 1 from private.settlement_payouts where shop_id=shop and state in('prepared','uncertain'))then raise exception 'SETTLEMENT_BENEFICIARY_BUSY';end if;
  insert into private.settlement_beneficiaries(shop_id,payee_name,beneficiary_ref,iban_last_four,created_by,reason)
  values(shop,btrim(p_data->>'payeeName'),btrim(p_data->>'beneficiaryRef'),upper(btrim(p_data->>'ibanLastFour')),actor,reason)returning id into new_id;
 elsif p_action='record-receipt'then
  perform pg_advisory_xact_lock_shared(992);
  select *into booking from public.bookings where id=(p_data->>'bookingId')::uuid and branch_id=shop for update;
  if booking.id is null then raise exception 'SETTLEMENT_BOOKING_REQUIRED';end if;
  amount:=(p_data->>'amountFils')::bigint;fee:=nullif(p_data->>'feeFils','')::bigint;happened:=(p_data->>'collectedAt')::timestamptz;settled:=nullif(p_data->>'settledAt','')::timestamptz;
  if amount is null or amount not between 1 and 1000000000 or happened is null or happened>clock_timestamp()or happened<clock_timestamp()-interval'10 years'
   or settled>clock_timestamp()or settled<happened or fee<0 then raise exception 'SETTLEMENT_INVALID';end if;
  if amount+coalesce((select sum(r.amount_fils)from private.settlement_receipt_state r where r.booking_id=booking.id and not r.reversed),0)>round(booking.price*1000)then raise exception 'SETTLEMENT_OVERPAYMENT';end if;
  select *into rate from private.settlement_rates where(shop_id=shop or shop_id is null)and created_at<=happened
   order by(shop_id is not null)desc,created_at desc,id desc limit 1;
  if rate.shop_id is not null and rate.rate_bps is null then select *into rate from private.settlement_rates where shop_id is null and created_at<=happened order by created_at desc,id desc limit 1;end if;
  select *into agreement from private.settlement_agreements where shop_id=shop and created_at<=happened order by created_at desc,id desc limit 1;
  if rate.id is null or agreement.id is null then raise exception 'SETTLEMENT_POLICY_REQUIRED';end if;
  commission:=round(amount::numeric*rate.rate_bps/10000)::bigint;
  insert into private.settlement_receipts(shop_id,booking_id,amount_fils,commission_bps,commission_fils,rate_id,agreement_id,fee_bearer,source_ref,collected_at,settled_at,fee_known,created_by)
  values(shop,booking.id,amount,rate.rate_bps,commission,rate.id,agreement.id,agreement.fee_bearer,reference,happened,settled,fee is not null,actor)returning *into receipt;
  new_id:=receipt.id;
  perform private.settlement_post(shop,new_id,null,'receipt',amount,reference,happened,'',jsonb_build_object('cash',amount,'shop',-(amount-commission),'commission',-commission));
  if fee is not null then perform private.settlement_post(shop,new_id,null,'fee',fee,null,happened,'',jsonb_build_object('cash',-fee,case when receipt.fee_bearer='shop'then'shop'else'fees'end,fee));end if;
 elsif p_action in('record-fee','record-refund','settle-receipt','hold','release-hold','reverse-event')then
  select *into receipt from private.settlement_receipts where id=(p_data->>'id')::uuid and shop_id=shop for update;
  if receipt.id is null then raise exception 'SETTLEMENT_NOT_FOUND';end if;
  select *into current_receipt from private.settlement_receipt_state where id=receipt.id;
  new_id:=receipt.id;
  if p_action='settle-receipt'then
   if receipt.settled_at is not null or current_receipt.reversed then raise exception 'SETTLEMENT_STATE';end if;
   happened:=(p_data->>'settledAt')::timestamptz;
   if happened is null or happened>clock_timestamp()or happened<receipt.collected_at then raise exception 'SETTLEMENT_INVALID';end if;
   update private.settlement_receipts set settled_at=happened where id=receipt.id;
  elsif p_action in('hold','release-hold')then
   update private.settlement_receipts set held=(p_action='hold')where id=receipt.id;
  elsif p_action='record-fee'then
   amount:=(p_data->>'amountFils')::bigint;happened:=coalesce(nullif(p_data->>'occurredAt','')::timestamptz,clock_timestamp());
   if amount is null or amount not between -1000000000 and 1000000000 or happened>clock_timestamp()or happened<receipt.collected_at then raise exception 'SETTLEMENT_INVALID';end if;
   if amount<0 and amount+coalesce((select sum(j.amount_fils)from private.settlement_journals j where j.receipt_id=receipt.id and j.kind='fee'and not exists(select 1 from private.settlement_journals x where x.reverses_id=j.id)),0)<0 then raise exception 'SETTLEMENT_INVALID';end if;
   perform private.settlement_post(shop,receipt.id,null,'fee',amount,reference,happened,reason,jsonb_build_object('cash',-amount,case when receipt.fee_bearer='shop'then'shop'else'fees'end,amount));
   update private.settlement_receipts set fee_known=true where id=receipt.id;
  elsif p_action='record-refund'then
   if current_receipt.reversed then raise exception 'SETTLEMENT_STATE';end if;
   amount:=(p_data->>'amountFils')::bigint;happened:=coalesce(nullif(p_data->>'occurredAt','')::timestamptz,clock_timestamp());
   select coalesce(sum(j.amount_fils),0)into refunded from private.settlement_journals j where j.receipt_id=receipt.id and j.kind='refund'and not exists(select 1 from private.settlement_journals x where x.reverses_id=j.id);
   if amount is null or amount<1 or refunded+amount>receipt.amount_fils or happened>clock_timestamp()or happened<receipt.collected_at or length(reason)not between 3 and 240 then raise exception 'SETTLEMENT_INVALID';end if;
   commission:=round(receipt.commission_fils::numeric*(refunded+amount)/receipt.amount_fils)::bigint-round(receipt.commission_fils::numeric*refunded/receipt.amount_fils)::bigint;
   perform private.settlement_post(shop,receipt.id,null,'refund',amount,reference,happened,reason,jsonb_build_object('cash',-amount,'shop',amount-commission,'commission',commission));
  else
   select *into event from private.settlement_journals where id=(p_data->>'eventId')::uuid and receipt_id=receipt.id and kind in('receipt','fee','refund');
   if event.id is null or exists(select 1 from private.settlement_journals where reverses_id=event.id)then raise exception 'SETTLEMENT_STATE';end if;
   if event.kind='receipt'and exists(select 1 from private.settlement_journals j where j.receipt_id=receipt.id and j.kind='refund'and not exists(select 1 from private.settlement_journals x where x.reverses_id=j.id))then raise exception 'SETTLEMENT_REVERSE_REFUNDS_FIRST';end if;
   if event.kind='refund'and exists(select 1 from private.settlement_journals j where j.receipt_id=receipt.id and j.kind='refund'and j.seq>event.seq and not exists(select 1 from private.settlement_journals x where x.reverses_id=j.id))then raise exception 'SETTLEMENT_REVERSE_LATEST_FIRST';end if;
   if event.kind='fee'and(select coalesce(sum(j.amount_fils),0)-event.amount_fils from private.settlement_journals j where j.receipt_id=receipt.id and j.kind='fee'and not exists(select 1 from private.settlement_journals x where x.reverses_id=j.id))<0 then raise exception 'SETTLEMENT_REVERSE_FEE_CREDITS_FIRST';end if;
   select jsonb_object_agg(account,-signed_fils)into entries from private.settlement_entries where journal_id=event.id;
   perform private.settlement_post(shop,receipt.id,null,'reversal',-event.amount_fils,null,clock_timestamp(),reason,entries,event.id);
   if event.kind='fee'and not exists(select 1 from private.settlement_journals j where j.receipt_id=receipt.id and j.kind='fee'and not exists(select 1 from private.settlement_journals x where x.reverses_id=j.id))then update private.settlement_receipts set fee_known=false where id=receipt.id;end if;
  end if;
 elsif p_action='prepare-statement'then
  period:=(p_data->>'period')::date;
  if period is null or extract(day from period)<>1 or period>(clock_timestamp()at time zone'Asia/Kuwait')::date then raise exception 'SETTLEMENT_INVALID';end if;
  happened:=least(clock_timestamp(),((period+interval'1 month')::timestamp at time zone'Asia/Kuwait'));
  preview:=private.settlement_statement_preview(shop,period,happened);
  if(preview->>'count')::integer=0 then raise exception 'SETTLEMENT_NO_ITEMS';end if;
  if(preview->>'count')::integer>10000 then raise exception 'SETTLEMENT_TOO_LARGE';end if;
  insert into private.settlement_statements(shop_id,period,cutoff_at,fingerprint,total_fils,line_count,created_by)
  values(shop,period,happened,preview->>'fingerprint',(preview->>'totalFils')::bigint,(preview->>'count')::integer,actor)returning *into statement;
  insert into private.settlement_statement_lines(statement_id,receipt_id,snapshot)select statement.id,(value->>'id')::uuid,value from jsonb_array_elements(preview->'rows');
  new_id:=statement.id;
 elsif p_action in('finalize-statement','cancel-statement')then
  select *into statement from private.settlement_statements where id=(p_data->>'id')::uuid and shop_id=shop for update;
  if statement.id is null or statement.state<>'draft'then raise exception 'SETTLEMENT_STATE';end if;
  if p_action='finalize-statement'then
   preview:=private.settlement_statement_preview(shop,statement.period,statement.cutoff_at);
   if preview->>'fingerprint'<>statement.fingerprint or p_data->>'fingerprint'is distinct from statement.fingerprint then raise exception 'SETTLEMENT_STALE';end if;
   update private.settlement_receipts set statement_id=statement.id where id in(select receipt_id from private.settlement_statement_lines where statement_id=statement.id)and statement_id is null;
   update private.settlement_statements set state='final',finalized_at=clock_timestamp(),finalized_by=actor where id=statement.id;
  else update private.settlement_statements set state='cancelled'where id=statement.id;end if;
  new_id:=statement.id;
 elsif p_action='prepare-payout'then
  select *into statement from private.settlement_statements where id=(p_data->>'statementId')::uuid and shop_id=shop and state='final';
  if statement.id is null then raise exception 'SETTLEMENT_STATEMENT_REQUIRED';end if;
  select *into beneficiary from private.settlement_beneficiaries where shop_id=shop order by created_at desc,id desc limit 1;
  if beneficiary.id is null then raise exception 'SETTLEMENT_BENEFICIARY_REQUIRED';end if;
  amount:=(p_data->>'amountFils')::bigint;
  if amount is null or amount not between 1 and 1000000000 then raise exception 'SETTLEMENT_INVALID';end if;
  select coalesce(sum(remaining_fils),0)into available from private.settlement_receipt_state where shop_id=shop
   and(remaining_fils<0 or(statement_id=statement.id and eligible));
  if amount>available then raise exception 'SETTLEMENT_INSUFFICIENT';end if;
  insert into private.settlement_payouts(shop_id,statement_id,beneficiary_id,amount_fils,created_by)
  values(shop,statement.id,beneficiary.id,amount,actor)returning *into payout;
  remaining:=amount;
  for row_item in select *from private.settlement_receipt_state where shop_id=shop and remaining_fils<0 order by collected_at,id loop
   insert into private.settlement_allocations values(payout.id,row_item.id,row_item.remaining_fils);
   remaining:=remaining-row_item.remaining_fils;
  end loop;
  for row_item in select *from private.settlement_receipt_state where shop_id=shop and statement_id=statement.id and eligible and remaining_fils>0 order by collected_at,id loop
   exit when remaining=0;allocation:=least(remaining,row_item.remaining_fils);
   insert into private.settlement_allocations values(payout.id,row_item.id,allocation);remaining:=remaining-allocation;
  end loop;
  if remaining<>0 then raise exception 'SETTLEMENT_INSUFFICIENT';end if;
  new_id:=payout.id;
 elsif p_action in('confirm-payout','uncertain-payout','fail-payout','cancel-payout')then
  select *into payout from private.settlement_payouts where id=(p_data->>'id')::uuid and shop_id=shop for update;
  if payout.id is null or payout.state not in('prepared','uncertain')then raise exception 'SETTLEMENT_STATE';end if;
  if p_action='cancel-payout'and payout.state='uncertain'then raise exception 'SETTLEMENT_UNCERTAIN';end if;
  if p_action='confirm-payout'then
   happened:=(p_data->>'transferredAt')::timestamptz;
   if happened is null or happened>clock_timestamp()or happened<payout.created_at-interval'1 minute'or reference is null or length(reference)not between 1 and 120 then raise exception 'SETTLEMENT_INVALID';end if;
   if(p_data->>'amountFils')::bigint is distinct from payout.amount_fils then raise exception 'SETTLEMENT_TRANSFER_MISMATCH';end if;
   if payout.state='prepared'then
    select coalesce(sum(case when net_fils-paid_fils<0 or(eligible and statement_id is not null)then net_fils-paid_fils else 0 end),0)
     into available from private.settlement_receipt_state where shop_id=shop;
    available:=available-coalesce((select sum(amount_fils)from private.settlement_payouts where shop_id=shop and state in('prepared','uncertain')and id<>payout.id),0);
    if payout.amount_fils>available then raise exception 'SETTLEMENT_REVIEW_REQUIRED';end if;
   end if;
   if payout.state='prepared'and exists(select 1 from private.settlement_allocations a join private.settlement_receipt_state r on r.id=a.receipt_id
     where a.payout_id=payout.id and a.amount_fils>0 and(not r.eligible or r.net_fils-r.paid_fils<a.amount_fils))then raise exception 'SETTLEMENT_REVIEW_REQUIRED';end if;
   -- For an uncertain, already-sent transfer, confirmation records the bank fact;
   -- subsequent refunds/holds remain visible as adjustments and recovery balances.
   update private.settlement_payouts set state='paid',bank_ref=reference,transferred_at=happened,confirmed_by=actor where id=payout.id;
   perform private.settlement_post(shop,null,payout.id,'payout',payout.amount_fils,reference,happened,'',jsonb_build_object('cash',-payout.amount_fils,'shop',payout.amount_fils));
  else
   update private.settlement_payouts set state=case p_action when'uncertain-payout'then'uncertain'when'fail-payout'then'failed'else'cancelled'end where id=payout.id;
  end if;
  new_id:=payout.id;
 end if;
 result:=jsonb_build_object('id',new_id,'action',p_action);
 insert into private.settlement_audit(shop_id,actor_id,action,details)values(shop,actor,p_action,
  jsonb_build_object('id',new_id,'reason',reason));
 insert into private.settlement_requests values(actor,request_id,input_hash,result,clock_timestamp());
 return result;
exception when unique_violation then raise exception 'SETTLEMENT_DUPLICATE';
 when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or check_violation or not_null_violation then raise exception 'SETTLEMENT_INVALID';
end $$;
