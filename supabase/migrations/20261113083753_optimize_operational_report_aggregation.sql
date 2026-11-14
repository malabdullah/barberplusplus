begin;

-- Aggregate allocations once, avoiding a quadratic scan per booking.
create or replace function public.staff_reports(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='45s' as $$
declare
 actor uuid:=auth.uid(); role_name text:=private.live_staff_role(); j private.staff_report_runs%rowtype;
 shops uuid[]; chairs uuid[]; own boolean; typ text; first_day date; last_day date;
 at_time timestamptz:=clock_timestamp(); today date:=(clock_timestamp()at time zone'Asia/Kuwait')::date;
 lower_at timestamptz; upper_at timestamptz; prev_lower timestamptz; prev_upper timestamptz;
 n integer; report_result jsonb; grouping text; rows jsonb; lines jsonb; demand jsonb; trend jsonb; options jsonb;
begin
 if actor is null or role_name is null or role_name not in('manager','barber')
 or nullif(auth.jwt()->>'session_id','') is null then raise exception 'REPORT_FORBIDDEN' using errcode='42501';end if;
 if p_action='options' then
  return jsonb_build_object('role',role_name,'shops',case when role_name='manager' then
   (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'nameAr',name_ar)order by name,id),'[]')from public.branches where manager_id=actor)else '[]'::jsonb end,
   'hasChair',exists(select 1 from public.barbers where user_id=actor));
 end if;
 if p_action='create' then
  perform pg_advisory_xact_lock(hashtextextended('staff-report:'||actor::text,0));
  -- Delete only expired report artifacts, never business records.
  delete from private.staff_report_runs where owner_id=actor and expires_at<=at_time;
  if (select count(*) from private.staff_report_runs where owner_id=actor and created_at>at_time-interval'1 hour')>=30
   then raise exception 'REPORT_RATE_LIMIT';end if;
  own:=role_name='barber' or coalesce((p_data->>'personal')::boolean,false);
  typ:=coalesce(p_data->>'type','overview');
  if typ not in('overview','shops','barbers','services','bookings','customers','demand','ratings') or own and typ in('shops','barbers') then raise exception 'REPORT_INVALID_FILTER';end if;
  if own then
   select array_agg(id)into chairs from public.barbers where user_id=actor;
   if cardinality(coalesce(chairs,'{}'))=0 then raise exception 'REPORT_NO_CHAIR';end if;
  end if;
  if role_name='manager' then
   if p_data->'shopIds' is null or p_data->'shopIds'='[]'::jsonb then
    select coalesce(array_agg(id),'{}')into shops from public.branches where manager_id=actor;
   else
    select array_agg(distinct value::uuid)into shops from jsonb_array_elements_text(p_data->'shopIds');
   end if;
   if cardinality(coalesce(shops,'{}'))=0 then raise exception 'REPORT_NO_SHOPS';end if;
   if cardinality(shops)>500 or exists(select 1 from unnest(shops)x where not exists(select 1 from public.branches b where b.id=x and b.manager_id=actor))
    then raise exception 'REPORT_FORBIDDEN' using errcode='42501';end if;
  else
   if p_data->'shopIds' is not null and p_data->'shopIds'<>'[]'::jsonb then raise exception 'REPORT_FORBIDDEN'using errcode='42501';end if;
   -- Personal history follows the existing linked barber ID, including old shops.
   select coalesce(array_agg(distinct id),'{}')into shops from (
    select branch_id id from public.barbers where id=any(chairs)
    union select branch_id from public.bookings where barber_id=any(chairs)) s;
  end if;
  first_day:=(p_data->>'from')::date;last_day:=(p_data->>'to')::date;
  if p_data->>'preset'='month' then first_day:=date_trunc('month',today)::date;last_day:=today;
  elsif p_data->>'preset'='lastMonth' then first_day:=(date_trunc('month',today)-interval'1 month')::date;last_day:=date_trunc('month',today)::date-1;end if;
  if first_day is null or last_day is null or last_day<first_day or last_day-first_day>365 or first_day<date'2000-01-01' or last_day>today+366 then raise exception 'REPORT_INVALID_RANGE';end if;
  lower_at:=first_day::timestamp at time zone'Asia/Kuwait';
  upper_at:=case when p_data->>'preset'='month' then at_time else (last_day+1)::timestamp at time zone'Asia/Kuwait' end;
  if p_data->>'preset'='month' or first_day=date_trunc('month',first_day)::date and last_day=(first_day+interval'1 month')::date-1 then
   prev_lower:=(first_day-interval'1 month')at time zone'Asia/Kuwait';
   prev_upper:=case when p_data->>'preset'='month' then least(lower_at,prev_lower+(upper_at-lower_at)) else lower_at end;
  else prev_upper:=lower_at;prev_lower:=lower_at-(upper_at-lower_at);end if;
  insert into private.staff_report_runs(owner_id,actor_role,personal,shop_ids,barber_ids,report_type,from_date,to_date,current_from,current_until,previous_from,previous_until,created_at)
   values(actor,role_name,own,shops,chairs,typ,first_day,last_day,lower_at,upper_at,prev_lower,prev_upper,at_time)returning *into j;
  return jsonb_build_object('id',j.id,'state',j.state);
 end if;
 select *into j from private.staff_report_runs where id=(p_data->>'id')::uuid and owner_id=actor;
 if j.id is null then raise exception 'REPORT_NOT_FOUND'using errcode='42501';end if;
 if j.expires_at<=at_time then raise exception 'REPORT_EXPIRED';end if;
 if j.actor_role<>role_name or role_name='manager'and exists(select 1 from unnest(j.shop_ids)x where not exists(select 1 from public.branches b where b.id=x and b.manager_id=actor))
 or j.personal and exists(select 1 from unnest(j.barber_ids)x where not exists(select 1 from public.barbers b where b.id=x and b.user_id=actor))
 then raise exception 'REPORT_FORBIDDEN'using errcode='42501';end if;
 if p_action='fail' then
  update private.staff_report_runs set state='failed',error_code='REPORT_FAILED'where id=j.id and state='queued';return '{}'::jsonb;
 end if;
 if p_action='build' then
  select *into j from private.staff_report_runs where id=j.id for update;
  if j.state<>'queued' then return jsonb_build_object('id',j.id,'state',j.state);end if;
  begin
   -- Capture both periods, identity, ratings, prices and customer classification
   -- in ONE statement snapshot. All subsequent aggregates use only these rows.
   insert into private.staff_report_rows(run_id,booking_id,ordinal,period,branch_id,barber_id,customer_id,day,starts_at,ends_at,minutes,amount,status,is_returning,shop_rating,barber_rating,payload)
   select j.id,b.id,row_number()over(order by b.date desc,b.time desc,b.id),
    case when (b.date+b.time)at time zone'Asia/Kuwait'>=j.current_from then 'current'else'previous'end,
    b.branch_id,b.barber_id,b.customer_id,b.date,(b.date+b.time)at time zone'Asia/Kuwait',
    (b.date+b.time+b.duration*interval'1 minute')at time zone'Asia/Kuwait',b.duration,b.price,b.status,
    exists(select 1 from public.bookings old where old.customer_id=b.customer_id and old.status='completed'and old.branch_id=any(j.shop_ids)
      and(not j.personal or old.barber_id=any(j.barber_ids))and old.date<case when (b.date+b.time)at time zone'Asia/Kuwait'>=j.current_from then j.from_date else(j.previous_from at time zone'Asia/Kuwait')::date end),
    rating.shop_rating,rating.barber_rating,
    jsonb_build_object('id',b.id,'shopId',b.branch_id,'barberId',b.barber_id,'customerId',b.customer_id,
     'shopName',shop.name,'shopNameAr',shop.name_ar,'barberName',barber.name,'barberNameAr',barber.name_ar,
     'customerName',customer.name,'customerNameAr',customer.name_ar,'date',b.date,'time',b.time,'duration',b.duration,
     'salesFils',round(b.price*1000)::bigint::text,'status',b.status,'shopRating',rating.shop_rating,'barberRating',rating.barber_rating,'services',b.service_snapshot,'package',b.package_snapshot)
   from public.bookings b join public.branches shop on shop.id=b.branch_id join public.barbers barber on barber.id=b.barber_id
   left join public.customers customer on customer.id=b.customer_id left join private.customer_booking_ratings rating on rating.booking_id=b.id
   where b.branch_id=any(j.shop_ids)and(not j.personal or b.barber_id=any(j.barber_ids))
    and b.date between (j.previous_from at time zone'Asia/Kuwait')::date and j.to_date
    and ((b.date+b.time)at time zone'Asia/Kuwait'>=j.current_from and(b.date+b.time)at time zone'Asia/Kuwait'<j.current_until
      or(b.date+b.time)at time zone'Asia/Kuwait'>=j.previous_from and(b.date+b.time)at time zone'Asia/Kuwait'<j.previous_until)
   order by b.date desc,b.time desc,b.id limit 200001;
   get diagnostics n=row_count;
   if n>200000 or(select count(*)from private.staff_report_rows where run_id=j.id and period='current')>100000 then raise exception 'REPORT_TOO_LARGE';end if;

   select coalesce(jsonb_agg(jsonb_build_object('date',day,'salesFils',sales::text,'completed',completed)order by day),'[]')into trend from(
    select day,coalesce(round(sum(amount)filter(where status='completed')*1000),0)::bigint sales,count(*)filter(where status='completed')completed
    from private.staff_report_rows where run_id=j.id and period='current'group by day)t;
   select coalesce(jsonb_agg(jsonb_build_object('dayOfWeek',dow,'hour',start_hour,'completed',completed,'minutes',minutes)order by dow,start_hour),'[]')into demand from(
    select extract(isodow from day)::integer dow,extract(hour from starts_at at time zone'Asia/Kuwait')::integer start_hour,
    count(*)filter(where status='completed') completed,coalesce(sum(minutes)filter(where status='completed'),0)minutes
    from private.staff_report_rows where run_id=j.id and period='current'group by 1,2)d;

   -- Package price once, standalone/add-on historical prices once; included
   -- services are usage-only. Any mismatch has a visible reconciliation bucket.
   with selected as(select *from private.staff_report_rows where run_id=j.id and period='current'and status='completed'),
   item as(
    select booking_id,'package:'||(payload->'package'->>'id') key,'package' kind,payload->'package'->>'name' name,payload->'package'->>'name_ar'name_ar,
     private.report_number(payload->'package'->>'price')amount from selected where private.report_number(payload->'package'->>'price')is not null
    union all
    select r.booking_id,case when coalesce(r.payload->'package'->'service_ids','[]')? (x->>'id')then'included:'else'service:'end||(x->>'id'),
     case when coalesce(r.payload->'package'->'service_ids','[]')?(x->>'id')then'included'else'service'end,x->>'name',x->>'name_ar',
     case when coalesce(r.payload->'package'->'service_ids','[]')?(x->>'id')then null else private.report_number(x->>'price')*coalesce(private.report_number(x->>'quantity'),1)end
    from selected r cross join lateral jsonb_array_elements(coalesce(r.payload->'services','[]'))x
   ), allocations as(select booking_id,sum(amount)amount from item group by booking_id), reconciled as(
    select *from item union all select r.booking_id,'unallocated','unallocated','Unallocated',null,r.amount-coalesce(a.amount,0)
     from selected r left join allocations a on a.booking_id=r.booking_id where r.amount<>coalesce(a.amount,0)
   )select coalesce(jsonb_agg(jsonb_build_object('id',key,'kind',kind,'name',name,'nameAr',name_ar,'completed',visits,'salesFils',case when amount is null then null else round(amount*1000)::bigint::text end)order by amount desc nulls last,key),'[]')into lines from(
    select key,kind,max(name)name,max(name_ar)name_ar,count(distinct booking_id)visits,sum(amount)amount from reconciled group by key,kind)l;

   grouping:=case when j.report_type='overview' then case when j.personal then 'services'when cardinality(j.shop_ids)=1 then'barbers'else'shops'end
    when j.report_type in('ratings','demand','bookings') then case when j.personal then'services'else'barbers'end else j.report_type end;
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'nameAr',name_ar)order by name,id),'[]')into options from public.branches where id=any(j.shop_ids);
   if grouping='services'then
    insert into private.staff_report_groups select j.id,ord,item from jsonb_array_elements(lines)with ordinality x(item,ord);
   else
    insert into private.staff_report_groups select j.id,ord,item from private.report_breakdown(j.id,grouping)with ordinality x(item,ord);
   end if;
   report_result:=jsonb_build_object('summary',private.report_totals(j.id,'current'),'previous',private.report_totals(j.id,'previous'),
    'grouping',grouping,'breakdown',(select coalesce(jsonb_agg(payload order by ordinal),'[]')from(select payload,ordinal from private.staff_report_groups where run_id=j.id order by ordinal limit 20)g),
    'breakdownTotal',(select count(*)from private.staff_report_groups where run_id=j.id),
    'trend',trend,'demand',demand,'shops',options,
    'coverage',jsonb_build_object('occupancy',false,'rescheduleEvents',false));
   select count(*)into n from private.staff_report_rows where run_id=j.id and period='current';
   update private.staff_report_runs set state='ready',result=report_result,row_count=n where id=j.id;
  exception when others then
   update private.staff_report_runs set state='failed',error_code=case when sqlerrm='REPORT_TOO_LARGE'then'REPORT_TOO_LARGE'else'REPORT_FAILED'end where id=j.id;
  end;
 end if;
 select *into j from private.staff_report_runs where id=j.id;
 if j.state='queued'and j.created_at<at_time-interval'3 minutes'then
  update private.staff_report_runs set state='failed',error_code='REPORT_FAILED'where id=j.id returning *into j;
 end if;
 if p_action in('rows','groups') then
  if j.state<>'ready'then raise exception 'REPORT_NOT_READY';end if;
  n:=least(500,greatest(1,coalesce((p_data->>'limit')::integer,25)));
  if p_action='groups'then
   select coalesce(jsonb_agg(payload||jsonb_build_object('ordinal',ordinal)order by ordinal),'[]')into rows from(
    select payload,ordinal from private.staff_report_groups where run_id=j.id and ordinal>greatest(0,coalesce((p_data->>'after')::bigint,0))order by ordinal limit n+1)g;
   return jsonb_build_object('rows',rows,'total',j.result->'breakdownTotal');
  end if;
  select coalesce(jsonb_agg(payload||jsonb_build_object('ordinal',ordinal)order by ordinal),'[]')into rows from(
   select payload,ordinal from private.staff_report_rows where run_id=j.id and period='current'and ordinal>greatest(0,coalesce((p_data->>'after')::bigint,0))
    and(coalesce(p_data->>'status','')=''or case when p_data->>'status'='needs_status'then status in('pending','confirmed')and ends_at<=j.created_at else status=p_data->>'status'end)
    and(coalesce(p_data->>'search','')=''or payload->>'customerName'ilike'%'||left(p_data->>'search',100)||'%'or payload->>'customerNameAr'ilike'%'||left(p_data->>'search',100)||'%')
   order by ordinal limit n+1)page;
  return jsonb_build_object('rows',rows,'total',j.row_count);
 end if;
 if p_action not in('get','build')then raise exception 'REPORT_INVALID_ACTION';end if;
 return jsonb_build_object('id',j.id,'state',j.state,'error',j.error_code,'type',j.report_type,'personal',j.personal,
  'from',j.from_date,'to',j.to_date,'currentUntil',j.current_until,'previousFrom',j.previous_from,'previousUntil',j.previous_until,
  'createdAt',j.created_at,'expiresAt',j.expires_at,'total',j.row_count,'result',j.result);
end $$;

commit;
