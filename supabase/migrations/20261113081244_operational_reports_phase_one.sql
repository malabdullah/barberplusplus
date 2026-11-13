begin;

-- Private, short-lived snapshots. No application role can read these tables.
create table private.staff_report_runs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null,
 actor_role text not null, personal boolean not null, shop_ids uuid[] not null,
 barber_ids uuid[], report_type text not null, from_date date not null, to_date date not null,
 current_from timestamptz not null, current_until timestamptz not null,
 previous_from timestamptz not null, previous_until timestamptz not null,
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
 state text not null default 'queued' check(state in ('queued','ready','failed')),
 error_code text, result jsonb, row_count integer not null default 0
);
create index staff_report_runs_owner on private.staff_report_runs(owner_id,created_at desc);
create index staff_report_runs_expiry on private.staff_report_runs(expires_at);
create table private.staff_report_rows (
 run_id uuid not null references private.staff_report_runs(id) on delete cascade,
 booking_id uuid not null, ordinal bigint not null, period text not null,
 branch_id uuid not null, barber_id uuid not null, customer_id uuid,
 day date not null, starts_at timestamptz not null, ends_at timestamptz not null,
 minutes integer not null, amount numeric not null, status text not null,
 is_returning boolean not null, shop_rating smallint, barber_rating smallint,
 payload jsonb not null, primary key(run_id,booking_id)
);
create index staff_report_rows_page on private.staff_report_rows(run_id,period,ordinal);
create table private.staff_report_groups (
 run_id uuid not null references private.staff_report_runs(id)on delete cascade,
 ordinal bigint not null,payload jsonb not null,primary key(run_id,ordinal)
);
alter table private.staff_report_runs enable row level security;
alter table private.staff_report_rows enable row level security;
alter table private.staff_report_groups enable row level security;
revoke all on private.staff_report_runs,private.staff_report_rows,private.staff_report_groups from public,anon,authenticated,service_role;

create index bookings_report_shop_date on public.bookings(branch_id,date,id);
create index bookings_report_barber_date on public.bookings(barber_id,date,id);
create index bookings_report_customer_completed on public.bookings(customer_id,branch_id,date) where status='completed';

create function private.report_number(value text) returns numeric
language sql immutable set search_path='' as $$
 select case when length(value)<=20 and value ~ '^[0-9]+(\.[0-9]{1,6})?$' then value::numeric end
$$;
revoke all on function private.report_number(text) from public,anon,authenticated,service_role;

create function private.report_totals(p_run uuid,p_period text) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
  'salesFils',coalesce(round(sum(r.amount) filter(where r.status='completed')*1000),0)::bigint::text,
  'completed',count(*) filter(where r.status='completed'),
  'customers',count(distinct r.customer_id) filter(where r.status='completed'),
  'newCustomers',count(distinct r.customer_id) filter(where r.status='completed' and not r.is_returning),
  'returningCustomers',count(distinct r.customer_id) filter(where r.status='completed' and r.is_returning),
  'completedMinutes',coalesce(sum(r.minutes) filter(where r.status='completed'),0),
  'upcomingMinutes',coalesce(sum(r.minutes) filter(where r.status in ('pending','confirmed') and r.starts_at>j.created_at),0),
  'pastEnded',count(*) filter(where r.ends_at<=j.created_at),
  'pastCompleted',count(*) filter(where r.ends_at<=j.created_at and r.status='completed'),
  'pastCancelled',count(*) filter(where r.ends_at<=j.created_at and r.status='cancelled'),
  'pastNoShow',count(*) filter(where r.ends_at<=j.created_at and r.status='no_show'),
  'needsStatus',count(*) filter(where r.ends_at<=j.created_at and r.status in ('pending','confirmed')),
  'cancelled',count(*) filter(where r.status='cancelled'),'noShow',count(*) filter(where r.status='no_show'),
  'pending',count(*) filter(where r.status='pending'),'confirmed',count(*) filter(where r.status='confirmed'),
  'total',count(*),'shopRating',round(avg(r.shop_rating),2),'shopRatingCount',count(r.shop_rating),
  'barberRating',round(avg(r.barber_rating),2),'barberRatingCount',count(r.barber_rating))
 from private.staff_report_rows r join private.staff_report_runs j on j.id=r.run_id
 where r.run_id=p_run and r.period=p_period
$$;
revoke all on function private.report_totals(uuid,text) from public,anon,authenticated,service_role;

create function private.report_breakdown(p_run uuid,p_kind text) returns setof jsonb
language sql stable set search_path='' as $$
 select data from (
 select key as id,max(label) as label,coalesce(sum(amount) filter(where status='completed'),0) sales,
 jsonb_build_object('id',key,'name',max(label),'nameAr',max(label_ar),
 'completed',count(*) filter(where status='completed'),
 'customers',count(distinct customer_id) filter(where status='completed'),
 'salesFils',coalesce(round(sum(amount) filter(where status='completed')*1000),0)::bigint::text,
 'minutes',coalesce(sum(minutes)filter(where status='completed'),0),
 'cancelled',count(*)filter(where status='cancelled'),'noShow',count(*)filter(where status='no_show'),
 'newCustomers',count(distinct customer_id)filter(where status='completed'and not is_returning),
 'returningCustomers',count(distinct customer_id)filter(where status='completed'and is_returning),
 'shopRating',round(avg(shop_rating),2),'shopRatingCount',count(shop_rating),
 'barberRating',round(avg(barber_rating),2),'barberRatingCount',count(barber_rating)) data
 from (select r.*,case p_kind when 'shops' then branch_id::text when 'barbers' then barber_id::text
 when 'customers' then coalesce(customer_id::text,booking_id::text) else branch_id::text end key,
 case p_kind when 'barbers' then payload->>'barberName' when 'customers' then payload->>'customerName' else payload->>'shopName' end label,
 case p_kind when 'barbers' then payload->>'barberNameAr' when 'customers' then payload->>'customerNameAr' else payload->>'shopNameAr' end label_ar
 from private.staff_report_rows r where run_id=p_run and period='current') q group by key
 ) grouped order by sales desc,label,id
$$;
revoke all on function private.report_breakdown(uuid,text) from public,anon,authenticated,service_role;

-- Only this narrow endpoint is exposed; every action checks live role/session,
-- run ownership and current shop/barber access. Caller-controlled metadata is ignored.
create function public.staff_reports(p_action text,p_data jsonb default '{}') returns jsonb
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
     'salesFils',round(b.price*1000)::bigint::text,'status',b.status,'services',b.service_snapshot,'package',b.package_snapshot)
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
   ), reconciled as(
    select *from item union all select r.booking_id,'unallocated','unallocated','Unallocated',null,r.amount-coalesce((select sum(i.amount)from item i where i.booking_id=r.booking_id),0)
     from selected r where r.amount<>coalesce((select sum(i.amount)from item i where i.booking_id=r.booking_id),0)
   )select coalesce(jsonb_agg(jsonb_build_object('id',key,'kind',kind,'name',name,'nameAr',name_ar,'completed',visits,'salesFils',case when amount is null then null else round(amount*1000)::bigint::text end)order by amount desc nulls last,key),'[]')into lines from(
    select key,kind,max(name)name,max(name_ar)name_ar,count(distinct booking_id)visits,sum(amount)amount from reconciled group by key,kind)l;

   grouping:=case when j.report_type='overview' then case when j.personal then 'services'when cardinality(j.shop_ids)=1 then'barbers'else'shops'end
    when j.report_type in('ratings','demand','bookings') then case when j.personal then'services'else'barbers'end else j.report_type end;
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'nameAr',name_ar)order by name,id),'[]')into options from public.branches where id=any(j.shop_ids);
   if grouping='services'then
    insert into private.staff_report_groups select j.id,ord,item from jsonb_array_elements(lines)with ordinality x(item,ord);
   else
    insert into private.staff_report_groups select j.id,row_number()over(),item from private.report_breakdown(j.id,grouping)item;
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
revoke all on function public.staff_reports(text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.staff_reports(text,jsonb)to authenticated;

commit;
