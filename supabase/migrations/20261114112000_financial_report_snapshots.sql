create or replace function public.manager_finances(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='25s' as $$
#variable_conflict use_column
declare
 actor uuid:=auth.uid(); shops uuid[]; shop uuid; request_id uuid; v_result jsonb; cached private.shop_finance_requests%rowtype;
 b public.bookings%rowtype; expense private.shop_finance_expenses%rowtype; entry private.shop_finance_entries%rowtype;
 run private.shop_finance_runs%rowtype; amount bigint; paid bigint; desired bigint; rid uuid;
 first_day date;last_day date;today date:=(clock_timestamp()at time zone'Asia/Kuwait')::date;
 method text;kind text;day date;reason text;after_id bigint; row_limit int; n bigint;
begin
 if actor is null or private.live_staff_role() is distinct from 'manager' or nullif(auth.jwt()->>'session_id','') is null then
  raise exception 'FINANCE_FORBIDDEN' using errcode='42501';end if;
 if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>8192 then raise exception 'FINANCE_INVALID';end if;
 if p_action='options' then
  return jsonb_build_object('shops',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'nameAr',name_ar)order by name,id),'[]')from public.branches where manager_id=actor));
 end if;
 if p_action in('get','rows') then
  select *into run from private.shop_finance_runs where id=(p_data->>'id')::uuid and owner_id=actor;
  if run.id is null or exists(select 1 from unnest(run.shop_ids)x where not exists(select 1 from public.branches s where s.id=x and s.manager_id=actor))then raise exception 'FINANCE_FORBIDDEN'using errcode='42501';end if;
  if run.expires_at<=clock_timestamp()then raise exception 'FINANCE_EXPIRED';end if;
  if p_action='get'then return run.result;end if;
  after_id:=coalesce((p_data->>'after')::bigint,0);row_limit:=least(500,greatest(1,coalesce((p_data->>'limit')::int,25)));
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(payload||jsonb_build_object('ordinal',ordinal)order by ordinal),'[]')from(select *from private.shop_finance_rows where run_id=run.id and ordinal>after_id order by ordinal limit row_limit+1)q));
 end if;
 if p_data->'shopIds' is null or p_data->'shopIds'='[]'::jsonb then
  select coalesce(array_agg(id),'{}')into shops from public.branches where manager_id=actor;
 else select array_agg(distinct value::uuid)into shops from jsonb_array_elements_text(p_data->'shopIds');end if;
 if coalesce(cardinality(shops),0)=0 then raise exception 'FINANCE_NO_SHOPS';end if;
 if cardinality(shops)>500 or exists(select 1 from unnest(shops)x where not exists(select 1 from public.branches s where s.id=x and s.manager_id=actor))then raise exception 'FINANCE_FORBIDDEN'using errcode='42501';end if;
 if p_action in('record','expense','void','reverse') then
  -- Serialize records and ownership transfer at the shop; retries are exact and safe.
  shop:=(p_data->>'shopId')::uuid;
  if shop is null or not(shop=any(shops))then raise exception 'FINANCE_FORBIDDEN'using errcode='42501';end if;
  perform 1 from public.branches where id=shop and manager_id=actor for update;
  if not found then raise exception 'FINANCE_FORBIDDEN'using errcode='42501';end if;
  request_id:=(p_data->>'requestId')::uuid;
  if request_id is null then raise exception 'FINANCE_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('finance-request:'||request_id::text,0));
  select *into cached from private.shop_finance_requests where id=request_id;
  if found then
   if cached.actor_id<>actor or cached.request<>jsonb_build_object('action',p_action,'data',p_data)then raise exception 'FINANCE_DUPLICATE';end if;
   return cached.result;
  end if;
  reason:=btrim(coalesce(p_data->>'reason',''));
  day:=coalesce((p_data->>'date')::date,today);
  if day>today or day<date'2000-01-01' or length(reason)>240 then raise exception 'FINANCE_INVALID';end if;
  if p_action='expense'then
   if coalesce(p_data->>'amountFils','')!~'^[0-9]{1,10}$'then raise exception 'FINANCE_INVALID_AMOUNT';end if;
   amount:=(p_data->>'amountFils')::bigint;
   if amount not between 1 and 1000000000 or coalesce(p_data->>'category','')not in('rent','supplies','utilities','wages','maintenance','other')or length(btrim(coalesce(p_data->>'description','')))not between 1 and 160 then raise exception 'FINANCE_INVALID';end if;
   insert into private.shop_finance_expenses(shop_id,incurred_on,category,description,amount_fils,created_by)
    values(shop,day,p_data->>'category',btrim(p_data->>'description'),amount,actor)returning id into rid;
  elsif p_action='void'then
   select *into expense from private.shop_finance_expenses where id=(p_data->>'expenseId')::uuid and shop_id=shop for update;
   if expense.id is null or expense.voided_at is not null then raise exception 'FINANCE_NOT_FOUND';end if;
   select coalesce(sum(signed_fils),0)into paid from private.shop_finance_entries where expense_id=expense.id;
   if paid<>0 then raise exception 'FINANCE_EXPENSE_PAID';end if;
   if length(reason)<3 then raise exception 'FINANCE_REASON_REQUIRED';end if;
   update private.shop_finance_expenses set voided_at=clock_timestamp(),voided_by=actor,void_reason=reason where id=expense.id;
   rid:=expense.id;
  else
   method:=coalesce(p_data->>'method','cash');kind:=p_data->>'kind';
   if method not in('cash','card','transfer','other')or length(coalesce(p_data->>'reference',''))>100 then raise exception 'FINANCE_INVALID';end if;
   if p_action='reverse'then
    select *into entry from private.shop_finance_entries where id=(p_data->>'entryId')::uuid and shop_id=shop;
    if entry.id is null or entry.kind='reversal'or exists(select 1 from private.shop_finance_entries where reverses_id=entry.id)then raise exception 'FINANCE_NOT_FOUND';end if;
    if length(reason)<3 then raise exception 'FINANCE_REASON_REQUIRED';end if;
    amount:=entry.amount_fils;desired:=-entry.signed_fils;kind:='reversal';method:=entry.method;
    if day<entry.occurred_on then raise exception 'FINANCE_INVALID';end if;
   else
    if coalesce(p_data->>'amountFils','')!~'^[0-9]{1,10}$'then raise exception 'FINANCE_INVALID_AMOUNT';end if;
    amount:=(p_data->>'amountFils')::bigint;
    if amount not between 1 and 1000000000 or kind not in('receipt','refund','expense_payment')or kind is null then raise exception 'FINANCE_INVALID_AMOUNT';end if;
    desired:=case when kind='refund'then-amount else amount end;
   end if;
   if (case when p_action='reverse'then entry.booking_id else(p_data->>'bookingId')::uuid end)is not null and kind<>'expense_payment'then
    select *into b from public.bookings where id=(case when p_action='reverse'then entry.booking_id else(p_data->>'bookingId')::uuid end) and branch_id=shop for update;
    if b.id is null then raise exception 'FINANCE_NOT_FOUND';end if;
    select coalesce(sum(signed_fils),0)into paid from private.shop_finance_entries where booking_id=b.id;
    if paid+desired<0 then raise exception 'FINANCE_REFUND_LIMIT';end if;
    if kind='receipt'and (b.status not in('pending','confirmed','completed')or paid+amount>round(b.price*1000)::bigint)then raise exception 'FINANCE_PAYMENT_LIMIT';end if;
    if kind='refund'and length(reason)<3 then raise exception 'FINANCE_REASON_REQUIRED';end if;
    insert into private.shop_finance_entries(id,shop_id,booking_id,kind,amount_fils,signed_fils,occurred_on,method,reference,reason,reverses_id,created_by)
     values(request_id,shop,b.id,kind,amount,desired,day,method,coalesce(p_data->>'reference',''),reason,entry.id,actor)returning id into rid;
   else
    select *into expense from private.shop_finance_expenses where id=(case when p_action='reverse'then entry.expense_id else(p_data->>'expenseId')::uuid end)and shop_id=shop for update;
    if expense.id is null or expense.voided_at is not null then raise exception 'FINANCE_NOT_FOUND';end if;
    select coalesce(sum(signed_fils),0)into paid from private.shop_finance_entries where expense_id=expense.id;
    if paid+desired<0 or paid+desired>expense.amount_fils then raise exception 'FINANCE_PAYMENT_LIMIT';end if;
    if day<expense.incurred_on then raise exception 'FINANCE_INVALID';end if;
    insert into private.shop_finance_entries(id,shop_id,expense_id,kind,amount_fils,signed_fils,occurred_on,method,reference,reason,reverses_id,created_by)
     values(request_id,shop,expense.id,kind,amount,desired,day,method,coalesce(p_data->>'reference',''),reason,entry.id,actor)returning id into rid;
   end if;
  end if;
  v_result:=jsonb_build_object('id',rid);
  insert into private.shop_finance_requests(id,actor_id,request,result)values(request_id,actor,jsonb_build_object('action',p_action,'data',p_data),v_result);
  return v_result;
 end if;
 if p_action in('bookings','expenses')and coalesce((p_data->>'offset')::int,0)not between 0 and 100000 then raise exception 'FINANCE_TOO_LARGE';end if;
 if p_action='bookings'then
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(item order by date desc,time desc,id),'[]')from(
   select b.date,b.time,b.id,jsonb_build_object('id',b.id,'shopId',b.branch_id,'shopName',s.name,'customer',coalesce(c.name,''),'barber',r.name,'date',b.date,'time',b.time,'status',b.status,
    'priceFils',round(b.price*1000)::bigint::text,'paidFils',coalesce(p.paid,0)::text,'dueFils',greatest(0,case when b.status in('cancelled','no_show')then 0 else round(b.price*1000)::bigint end-coalesce(p.paid,0))::text,
    'creditFils',greatest(0,coalesce(p.paid,0)-case when b.status in('cancelled','no_show')then 0 else round(b.price*1000)::bigint end)::text)item
   from public.bookings b join public.branches s on s.id=b.branch_id join public.barbers r on r.id=b.barber_id left join public.customers c on c.id=b.customer_id
   left join lateral(select sum(signed_fils)paid from private.shop_finance_entries where booking_id=b.id)p on true
   where b.branch_id=any(shops)and (coalesce(p_data->>'search','')=''or c.name ilike '%'||left(p_data->>'search',100)||'%'or b.id::text= p_data->>'search')
   and(coalesce(p_data->>'status','')=''or b.status=p_data->>'status')
   order by b.date desc,b.time desc,b.id limit 26 offset least(100000,greatest(0,coalesce((p_data->>'offset')::int,0))))q));
 elsif p_action='expenses'then
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(item order by incurred_on desc,id),'[]')from(
   select e.incurred_on,e.id,jsonb_build_object('id',e.id,'shopId',e.shop_id,'shopName',s.name,'date',e.incurred_on,'category',e.category,'description',e.description,'amountFils',e.amount_fils::text,'paidFils',coalesce(p.paid,0)::text,'voided',e.voided_at is not null)item
   from private.shop_finance_expenses e join public.branches s on s.id=e.shop_id left join lateral(select sum(signed_fils)paid from private.shop_finance_entries where expense_id=e.id)p on true
   where e.shop_id=any(shops)order by e.incurred_on desc,e.id limit 26 offset least(100000,greatest(0,coalesce((p_data->>'offset')::int,0))))q));
 elsif p_action='history'then
  if not exists(select 1 from public.bookings where id=(p_data->>'bookingId')::uuid and branch_id=any(shops))and not exists(select 1 from private.shop_finance_expenses where id=(p_data->>'expenseId')::uuid and shop_id=any(shops))then raise exception 'FINANCE_NOT_FOUND';end if;
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'shopId',e.shop_id,'date',e.occurred_on,'kind',e.kind,'amountFils',e.amount_fils::text,'signedFils',e.signed_fils::text,'method',e.method,'reference',e.reference,'reason',e.reason,'reversed',exists(select 1 from private.shop_finance_entries x where x.reverses_id=e.id),'createdAt',e.created_at)order by e.created_at desc),'[]')from private.shop_finance_entries e where e.shop_id=any(shops)and(e.booking_id=(p_data->>'bookingId')::uuid or e.expense_id=(p_data->>'expenseId')::uuid)));
 elsif p_action='generate'then
  first_day:=(p_data->>'from')::date;last_day:=(p_data->>'to')::date;
  if first_day is null or last_day is null or last_day<first_day or last_day-first_day>365 or last_day>today or first_day<date'2000-01-01'then raise exception 'FINANCE_INVALID_RANGE';end if;
  perform pg_advisory_xact_lock(hashtextextended('finance-report:'||actor::text,0));
  delete from private.shop_finance_runs where owner_id=actor and expires_at<=clock_timestamp();
  if(select count(*)from private.shop_finance_runs where owner_id=actor and created_at>clock_timestamp()-interval'1 hour')>=30 then raise exception 'FINANCE_RATE_LIMIT';end if;
  insert into private.shop_finance_runs(owner_id,shop_ids,from_date,to_date)values(actor,shops,first_day,last_day)returning *into run;
  -- A single statement freezes sales, movements, expenses and live balances together.
  -- Export never reads mutable operational tables; no customer contact data is stored.
  insert into private.shop_finance_rows
  with bp as materialized(select booking_id,sum(signed_fils)paid from private.shop_finance_entries where shop_id=any(shops)and booking_id is not null group by booking_id),
  ep as materialized(select expense_id,sum(signed_fils)paid from private.shop_finance_entries where shop_id=any(shops)and expense_id is not null group by expense_id),
  data as(
   select b.branch_id shop_id,b.date as report_day,'sale'kind,b.id reference,round(b.price*1000)::bigint amount,0::bigint cash,0::bigint receivable,0::bigint credit,0::bigint payable,''category
   from public.bookings b where b.branch_id=any(shops)and b.status='completed'and b.date between first_day and last_day
   union all select e.shop_id,e.incurred_on,'expense',e.id,e.amount_fils,0,0,0,0,e.category from private.shop_finance_expenses e where e.shop_id=any(shops)and e.voided_at is null and e.incurred_on between first_day and last_day
   union all select e.shop_id,e.occurred_on,e.kind,e.id,e.signed_fils,case when e.booking_id is not null then e.signed_fils else-e.signed_fils end,0,0,0,case when e.booking_id is null then'expense'else'booking'end from private.shop_finance_entries e where e.shop_id=any(shops)and e.occurred_on between first_day and last_day
   union all select b.branch_id,today,'booking_balance',b.id,0,0,greatest(0,case when b.status in('cancelled','no_show')then 0 else round(b.price*1000)::bigint end-coalesce(bp.paid,0)),greatest(0,coalesce(bp.paid,0)-case when b.status in('cancelled','no_show')then 0 else round(b.price*1000)::bigint end),0,'' from public.bookings b left join bp on bp.booking_id=b.id where b.branch_id=any(shops)
   union all select e.shop_id,today,'expense_balance',e.id,0,0,0,0,e.amount_fils-coalesce(ep.paid,0),e.category from private.shop_finance_expenses e left join ep on ep.expense_id=e.id where e.shop_id=any(shops)and e.voided_at is null
  )select run.id,row_number()over(order by report_day,kind,reference),jsonb_build_object('shopId',d.shop_id,'shopName',s.name,'shopNameAr',s.name_ar,'date',report_day,'kind',kind,'reference',reference,'amountFils',amount::text,'cashFils',cash::text,'dueFils',receivable::text,'creditFils',credit::text,'payableFils',payable::text,'category',category)from data d join public.branches s on s.id=d.shop_id limit 100001;
  get diagnostics n=row_count;
  if n>100000 then raise exception 'FINANCE_TOO_LARGE';end if;
  with grouped as(select payload->>'shopId'id,max(payload->>'shopName')name,max(payload->>'shopNameAr')name_ar,
   coalesce(sum((payload->>'amountFils')::bigint)filter(where payload->>'kind'='sale'),0)sales,
   coalesce(sum((payload->>'amountFils')::bigint)filter(where payload->>'kind'='expense'),0)expenses,
   coalesce(sum((payload->>'cashFils')::bigint)filter(where payload->>'category'='booking'),0)receipts,
   -coalesce(sum((payload->>'cashFils')::bigint)filter(where payload->>'category'='expense'),0)paid,
   coalesce(sum((payload->>'dueFils')::bigint),0)due,coalesce(sum((payload->>'creditFils')::bigint),0)credit,coalesce(sum((payload->>'payableFils')::bigint),0)payable
   from private.shop_finance_rows where run_id=run.id group by payload->>'shopId')
  select jsonb_build_object('id',run.id,'from',first_day,'to',last_day,'createdAt',run.created_at,'expiresAt',run.expires_at,'total',n,
   'summary',jsonb_build_object('salesFils',sum(sales)::text,'expenseFils',sum(expenses)::text,'netReceiptsFils',sum(receipts)::text,'expensePaidFils',sum(paid)::text,'operatingFils',sum(sales-expenses)::text,'cashFlowFils',sum(receipts-paid)::text,'dueFils',sum(due)::text,'creditFils',sum(credit)::text,'payableFils',sum(payable)::text),
   'shops',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'nameAr',name_ar,'salesFils',sales::text,'expenseFils',expenses::text,'operatingFils',(sales-expenses)::text,'cashFlowFils',(receipts-paid)::text)order by name,id),'[]'))into v_result from grouped;
  -- Empty reports still return numeric zeroes and the selected scope.
  v_result:=jsonb_set(v_result,'{summary}',(select jsonb_object_agg(key,case when value='null'::jsonb then '"0"'::jsonb else value end)from jsonb_each(v_result->'summary')));
  if exists(select 1 from jsonb_each_text(v_result->'summary')where abs(value::numeric)>9007199254740991)then raise exception 'FINANCE_TOO_LARGE';end if;
  update private.shop_finance_runs set result=v_result where id=run.id;
  return v_result;
 end if;
 raise exception 'FINANCE_INVALID';
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'FINANCE_INVALID';
end $$;
revoke all on function public.manager_finances(text,jsonb)from public,anon,service_role;
grant execute on function public.manager_finances(text,jsonb)to authenticated;
