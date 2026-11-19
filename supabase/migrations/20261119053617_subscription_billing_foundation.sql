-- Additive foundation only. No gateway, payment simulation, booking restrictions,
-- account changes, messages or production activation. All money is integer fils.
begin;
create table private.billing_businesses (
  id uuid primary key default gen_random_uuid(),
  origin_manager_id uuid not null unique references auth.users(id),
  billing_manager_id uuid not null references auth.users(id),
  name text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index billing_business_manager on private.billing_businesses(billing_manager_id);
create table private.billing_shops (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  business_id uuid not null references private.billing_businesses(id)
);
create index billing_shops_business on private.billing_shops(business_id,branch_id);
create table private.billing_subscriptions (
  business_id uuid primary key references private.billing_businesses(id),
  frequency text not null default 'monthly' check(frequency in('monthly','yearly')),
  next_frequency text check(next_frequency in('monthly','yearly')),
  renewal_requested boolean not null default true,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  transition_ends_at timestamptz,
  period_started_at timestamptz,
  period_ends_at timestamptz,
  paid_capacity integer not null default 0 check(paid_capacity>=0),
  renewal_failed_at timestamptz,
  revision bigint not null default 1,
  check((trial_started_at is null and trial_ends_at is null) or (trial_started_at is not null and trial_ends_at is not null and trial_ends_at=trial_started_at+interval'14 days')),
  check((period_started_at is null and period_ends_at is null) or (period_started_at is not null and period_ends_at is not null and period_ends_at>period_started_at)),
  check(renewal_failed_at is null or (period_ends_at is not null and renewal_failed_at>=period_ends_at))
);
create table private.billing_access_grants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references private.billing_businesses(id),
  kind text not null check(kind in('full','manual')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check(ends_at>starts_at),
  branch_ids uuid[] not null default '{}',
  reason text not null check(length(btrim(reason)) between 1 and 500),
  actor_id uuid not null references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check(kind<>'manual' or cardinality(branch_ids)>0)
);
create index billing_access_business on private.billing_access_grants(business_id,ends_at) where revoked_at is null;
create table private.billing_discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check(code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'),
  kind text not null check(kind in('percent','fixed')),
  value bigint not null check(value>0),
  eligibility text not null check(eligibility in('monthly','yearly','both')),
  payments integer not null check(payments in(1,3)),
  expires_at timestamptz not null,
  redemption_limit integer check(redemption_limit>0),
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  check(kind<>'percent' or value<=100),
  check(payments<>3 or eligibility='monthly')
);
-- Future gateway reconciliation will populate these. No browser settlement API.
create table private.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references private.billing_businesses(id),
  provider_reference text unique,
  state text not null check(state in('paid','refunded')),
  currency text not null default 'KWD' check(currency='KWD'),
  subtotal_fils bigint not null check(subtotal_fils>=0),
  discount_fils bigint not null default 0 check(discount_fils>=0 and discount_fils<=subtotal_fils),
  total_fils bigint generated always as(subtotal_fils-discount_fils) stored,
  period_starts_at timestamptz not null,
  period_ends_at timestamptz not null check(period_ends_at>period_starts_at),
  created_at timestamptz not null default clock_timestamp()
);
create index billing_invoices_business on private.billing_invoices(business_id,created_at desc,id);
create table private.billing_redemptions (
  code_id uuid not null references private.billing_discount_codes(id),
  business_id uuid not null references private.billing_businesses(id),
  invoice_id uuid not null unique references private.billing_invoices(id),
  primary key(code_id,business_id)
);
create table private.billing_audit (
  id bigint generated always as identity primary key,
  business_id uuid references private.billing_businesses(id),
  actor_id uuid references auth.users(id),
  action text not null,
  reason text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index billing_audit_business on private.billing_audit(business_id,id desc);
create table private.billing_requests (
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,request_id)
);

do $$declare t text;begin
 foreach t in array array['billing_businesses','billing_shops','billing_subscriptions','billing_access_grants','billing_discount_codes','billing_invoices','billing_redemptions','billing_audit','billing_requests']loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

create function private.billing_active_count(p_business uuid)returns integer
language sql stable set search_path='' as $$
 select count(distinct coalesce(b.user_id,b.id))::integer from public.barbers b
 join private.billing_shops s on s.branch_id=b.branch_id
 where s.business_id=p_business and b.status='active'
 and (b.management_mode='managed' or b.manager_chair or (b.user_id is not null and coalesce(b.invite_status,'accepted')='accepted'));
$$;
create function private.billing_price(p_count integer,p_frequency text)returns bigint
language plpgsql immutable set search_path='' as $$
begin
 if p_count is null or p_count<0 or p_count>1000000 or p_frequency is null or p_frequency not in('monthly','yearly')then raise exception 'BILLING_INVALID';end if;
 return greatest(25000,p_count::bigint*10000)*case when p_frequency='yearly'then 10 else 1 end;
end $$;
create function private.billing_access(p_business uuid,p_at timestamptz default clock_timestamp())returns jsonb
language plpgsql stable set search_path='' as $$
declare s private.billing_subscriptions%rowtype;state text:='not_started';until_at timestamptz;g private.billing_access_grants%rowtype;full_access boolean:=false;
begin
 select *into s from private.billing_subscriptions where business_id=p_business;
 if s.period_started_at<=p_at and s.period_ends_at>p_at then state:='active';until_at:=s.period_ends_at;
 elsif s.trial_started_at<=p_at and s.trial_ends_at>p_at then state:='trial';until_at:=s.trial_ends_at;
 elsif s.transition_ends_at>p_at then state:='transition';until_at:=s.transition_ends_at;
 elsif s.period_ends_at is not null and s.renewal_requested and s.renewal_failed_at is not null
   and p_at>=s.period_ends_at and p_at<s.period_ends_at+interval'72 hours' then state:='grace';until_at:=s.period_ends_at+interval'72 hours';
 elsif s.trial_ends_at is not null or s.period_ends_at is not null or s.transition_ends_at is not null then state:='expired';end if;
 full_access:=state in('active','trial','transition','grace');
 if not full_access then
  select *into g from private.billing_access_grants where business_id=p_business and revoked_at is null and starts_at<=p_at and ends_at>p_at
   order by (kind='full')desc,ends_at desc,id limit 1;
  if g.id is not null then state:=case when g.kind='full'then'complimentary'else'manual'end;until_at:=g.ends_at;full_access:=g.kind='full';end if;
 end if;
 return jsonb_build_object('status',state,'until',until_at,'fullAccess',full_access,'manualBranchIds',
  (select coalesce(jsonb_agg(distinct x),'[]')from private.billing_access_grants a cross join lateral unnest(a.branch_ids)x
   where a.business_id=p_business and a.kind='manual' and a.revoked_at is null and a.starts_at<=p_at and a.ends_at>p_at),
  'enforced',false,'gatewayConnected',false);
end $$;

-- Existing published businesses get the agreed transition, not a paid invoice.
insert into private.billing_businesses(origin_manager_id,billing_manager_id,name)
 select b.manager_id,b.manager_id,(array_agg(b.name order by b.created_at,b.id))[1]
 from public.branches b where b.manager_id is not null group by b.manager_id;
insert into private.billing_shops(branch_id,business_id)
 select s.id,b.id from public.branches s join private.billing_businesses b on b.origin_manager_id=s.manager_id;
insert into private.billing_subscriptions(business_id,transition_ends_at)
 select b.id,case when exists(select 1 from private.billing_shops l join public.branches s on s.id=l.branch_id
  where l.business_id=b.id and s.status='active'and s.publication_state='published')then clock_timestamp()+interval'30 days'end
 from private.billing_businesses b;

create function private.billing_register_shop()returns trigger
language plpgsql security definer set search_path='' as $$
declare business uuid;t timestamptz:=clock_timestamp();
begin
 if tg_op='INSERT'and new.manager_id is not null then
  insert into private.billing_businesses(origin_manager_id,billing_manager_id,name)values(new.manager_id,new.manager_id,new.name)on conflict(origin_manager_id)do nothing;
  select id into business from private.billing_businesses where origin_manager_id=new.manager_id;
  insert into private.billing_subscriptions(business_id)values(business)on conflict do nothing;
  insert into private.billing_shops(branch_id,business_id)values(new.id,business)on conflict do nothing;
 end if;
 if new.status='active'and new.publication_state='published'and(tg_op='INSERT'or old.publication_state is distinct from 'published')then
  select business_id into business from private.billing_shops where branch_id=new.id;
  update private.billing_subscriptions set trial_started_at=t,trial_ends_at=t+interval'14 days',revision=revision+1
   where business_id=business and trial_started_at is null and transition_ends_at is null and period_started_at is null;
 end if;
 return new;
end $$;
create trigger billing_shop_foundation after insert or update of publication_state on public.branches
 for each row execute function private.billing_register_shop();

create function private.billing_business_view(p_business uuid,p_actor uuid,p_admin boolean)returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',b.id,'name',b.name,'managerId',b.billing_manager_id,
 'managerName',coalesce(u.raw_user_meta_data->>'name',split_part(u.email,'@',1)),
 'count',private.billing_active_count(b.id),'frequency',s.frequency,'nextFrequency',s.next_frequency,
 'renewalRequested',s.renewal_requested,'revision',s.revision,'access',private.billing_access(b.id),
 'trialStartedAt',s.trial_started_at,'trialEndsAt',s.trial_ends_at,'periodStartsAt',s.period_started_at,'periodEndsAt',s.period_ends_at,
 'paidCapacity',s.paid_capacity,'priceFils',private.billing_price(private.billing_active_count(b.id),s.frequency),
 'canManage',p_actor=b.billing_manager_id and exists(select 1 from private.billing_shops bs join public.branches br on br.id=bs.branch_id where bs.business_id=b.id and br.manager_id=p_actor),
 'shops',(select coalesce(jsonb_agg(jsonb_build_object('id',br.id,'name',br.name,'status',br.status,'publicationState',br.publication_state)order by br.name,br.id),'[]')from private.billing_shops bs join public.branches br on br.id=bs.branch_id where bs.business_id=b.id),
 'managers',case when p_admin then(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',coalesce(x.raw_user_meta_data->>'name',split_part(x.email,'@',1)))),'[]')from auth.users x
  where x.raw_app_meta_data->>'role'='manager' and x.deleted_at is null and(x.banned_until is null or x.banned_until<=now())
  and exists(select 1 from private.billing_shops bs join public.branches br on br.id=bs.branch_id where bs.business_id=b.id and br.manager_id=x.id))else'[]'::jsonb end)
 from private.billing_businesses b join private.billing_subscriptions s on s.business_id=b.id join auth.users u on u.id=b.billing_manager_id where b.id=p_business;
$$;

create function private.billing_api(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='12s' as $$
#variable_conflict use_column
declare
 actor uuid:=auth.uid();role_name text;is_admin boolean;business uuid;request_id uuid;prior private.billing_requests%rowtype;
 s private.billing_subscriptions%rowtype;b private.billing_businesses%rowtype;c private.billing_discount_codes%rowtype;g private.billing_access_grants%rowtype;
 result jsonb;reason text;frequency text;count_barbers integer;subtotal bigint;discount bigint:=0;code text;next_manager uuid;
 first_at timestamptz;last_at timestamptz;today date:=(clock_timestamp()at time zone'Asia/Kuwait')::date;
 ids uuid[];offset_rows integer;limit_rows integer;query_text text;status_filter text;
begin
 role_name:=private.live_staff_role();is_admin:=role_name='admin';
 if actor is null or role_name is null or role_name not in('manager','admin')or nullif(auth.jwt()->>'session_id','')is null
  or not exists(select 1 from auth.sessions ss where ss.id=(auth.jwt()->>'session_id')::uuid and ss.user_id=actor and(ss.not_after is null or ss.not_after>now()))
  or exists(select 1 from private.account_revoked_sessions r where r.session_id=(auth.jwt()->>'session_id')::uuid)
 then raise exception 'BILLING_FORBIDDEN'using errcode='42501';end if;
 if p_action is null or p_data is null or jsonb_typeof(p_data)<>'object'or octet_length(p_data::text)>16384 then raise exception 'BILLING_INVALID';end if;
 if p_action='businesses'then
  offset_rows:=greatest(0,coalesce((p_data->>'offset')::integer,0));limit_rows:=least(50,greatest(1,coalesce((p_data->>'limit')::integer,20)));
  query_text:=left(lower(btrim(coalesce(p_data->>'query',''))),120);status_filter:=coalesce(p_data->>'status','all');
  return(select jsonb_build_object('rows',coalesce(jsonb_agg(v order by name,id),'[]'),'hasMore',count(*)>limit_rows)from(
   select private.billing_business_view(x.id,actor,is_admin) v,x.name,x.id from private.billing_businesses x
   where(is_admin or exists(select 1 from private.billing_shops l join public.branches br on br.id=l.branch_id where l.business_id=x.id and br.manager_id=actor))
   and(query_text=''or lower(x.name)like'%'||query_text||'%'or exists(select 1 from auth.users u where u.id=x.billing_manager_id and lower(coalesce(u.raw_user_meta_data->>'name',''))like'%'||query_text||'%'))
   and(status_filter='all'or private.billing_access(x.id)->>'status'=status_filter)
   order by x.name,x.id limit limit_rows+1 offset offset_rows)q);
 end if;
 if p_action in('codes','create-code','toggle-code')and not is_admin then raise exception 'BILLING_FORBIDDEN'using errcode='42501';end if;
 if p_action='codes'then
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(q)order by q.created_at desc,q.id),'[]')from(
   select d.*,(select count(*)from private.billing_redemptions r where r.code_id=d.id)used from private.billing_discount_codes d
   where lower(d.code)like'%'||left(lower(coalesce(p_data->>'query','')),24)||'%'order by d.created_at desc,d.id limit 51 offset greatest(0,coalesce((p_data->>'offset')::integer,0)))q));
 end if;
 if p_action not in('create-code','toggle-code')then
  business:=nullif(p_data->>'businessId','')::uuid;
  select *into b from private.billing_businesses where id=business;
  if b.id is null or(not is_admin and not exists(select 1 from private.billing_shops l join public.branches br on br.id=l.branch_id where l.business_id=business and br.manager_id=actor))then raise exception 'BILLING_FORBIDDEN'using errcode='42501';end if;
 end if;
 if p_action='detail'then
  return private.billing_business_view(business,actor,is_admin)||jsonb_build_object(
   'grants',(select coalesce(jsonb_agg(to_jsonb(a)order by a.created_at desc),'[]')from private.billing_access_grants a where a.business_id=business and a.revoked_at is null),
   'history',(select coalesce(jsonb_agg(to_jsonb(q)order by q.id desc),'[]')from(select id,action,reason,details,created_at from private.billing_audit where business_id=business order by id desc limit 100)q),
   'invoices',case when is_admin or b.billing_manager_id=actor then(select coalesce(jsonb_agg(to_jsonb(i)order by i.created_at desc),'[]')from(select id,state,currency,subtotal_fils,discount_fils,total_fils,period_starts_at,period_ends_at,created_at from private.billing_invoices where business_id=business order by created_at desc,id limit 50)i)else'[]'::jsonb end);
 end if;
 if p_action='quote'then
  count_barbers:=private.billing_active_count(business);frequency:=coalesce(p_data->>'frequency','monthly');
  subtotal:=private.billing_price(count_barbers,frequency);code:=upper(btrim(coalesce(p_data->>'code','')));
  if code<>''then
   select *into c from private.billing_discount_codes where billing_discount_codes.code=code and enabled and expires_at>clock_timestamp();
   if c.id is null then raise exception 'BILLING_CODE_UNAVAILABLE';end if;
   if c.eligibility not in('both',frequency)then raise exception 'BILLING_CODE_INELIGIBLE';end if;
   if exists(select 1 from private.billing_redemptions r where r.code_id=c.id and r.business_id=business)
    or(c.redemption_limit is not null and(select count(*)from private.billing_redemptions r where r.code_id=c.id)>=c.redemption_limit)then raise exception 'BILLING_CODE_USED';end if;
   discount:=least(subtotal,case when c.kind='fixed'then c.value else (subtotal*c.value+50)/100 end);
  end if;
  return jsonb_build_object('count',count_barbers,'frequency',frequency,'subtotalFils',subtotal,'discountFils',discount,'totalFils',subtotal-discount,
   'normalRenewalFils',subtotal,'discountPayments',coalesce(c.payments,0),'currency','KWD','code',nullif(code,''),'settled',false,'gatewayConnected',false);
 end if;
 if p_action not in('preferences','grant','revoke-grant','transfer','create-code','toggle-code')then raise exception 'BILLING_INVALID';end if;
 if p_action='preferences'then
  if role_name<>'manager'or b.billing_manager_id<>actor then raise exception 'BILLING_FORBIDDEN'using errcode='42501';end if;
 elsif not is_admin then raise exception 'BILLING_FORBIDDEN'using errcode='42501';end if;
 request_id:=nullif(p_data->>'requestId','')::uuid;
 if request_id is null then raise exception 'BILLING_REQUEST_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_id::text,711));
 select *into prior from private.billing_requests where actor_id=actor and billing_requests.request_id=request_id;
 if found then
  if prior.input<>jsonb_build_object('action',p_action,'data',p_data)then raise exception 'BILLING_RETRY_CHANGED';end if;
  return prior.result;
 end if;
 reason:=btrim(coalesce(p_data->>'reason',''));
 if p_action<>'preferences'and length(reason)not between 1 and 500 then raise exception 'BILLING_REASON_REQUIRED';end if;
 if business is not null then
  select *into s from private.billing_subscriptions where business_id=business for update;
  if p_action='preferences'and(p_data->>'revision')::bigint is distinct from s.revision then raise exception 'BILLING_STALE';end if;
 end if;
 if p_action='preferences'then
  frequency:=p_data->>'frequency';
  if frequency is null or frequency not in('monthly','yearly')or jsonb_typeof(p_data->'renewalRequested')is distinct from'boolean'then raise exception 'BILLING_INVALID';end if;
  update private.billing_subscriptions set next_frequency=case when frequency=s.frequency then null else frequency end,renewal_requested=(p_data->>'renewalRequested')::boolean,revision=revision+1 where business_id=business;
  reason:='Manager renewal preference';
 elsif p_action='grant'then
  first_at:=((p_data->>'startsOn')::date::timestamp at time zone'Asia/Kuwait');last_at:=((p_data->>'endsOn')::date::timestamp at time zone'Asia/Kuwait');
  if first_at is null or last_at is null or first_at<(today::timestamp at time zone'Asia/Kuwait')or last_at<=first_at or last_at>first_at+interval'5 years'or p_data->>'kind'not in('full','manual')or p_data->>'kind'is null then raise exception 'BILLING_INVALID_DATES';end if;
  select coalesce(array_agg(distinct value::uuid),'{}')into ids from jsonb_array_elements_text(coalesce(p_data->'branchIds','[]'));
  if cardinality(ids)>500 or exists(select 1 from unnest(ids)x where not exists(select 1 from private.billing_shops l where l.business_id=business and l.branch_id=x))or(p_data->>'kind'='manual'and cardinality(ids)=0)then raise exception 'BILLING_BRANCH_REQUIRED';end if;
  insert into private.billing_access_grants(business_id,kind,starts_at,ends_at,branch_ids,reason,actor_id)
   values(business,p_data->>'kind',first_at,last_at,case when p_data->>'kind'='manual'then ids else'{}'::uuid[]end,reason,actor)returning *into g;
 elsif p_action='revoke-grant'then
  update private.billing_access_grants set revoked_at=clock_timestamp()where id=(p_data->>'grantId')::uuid and business_id=business and revoked_at is null returning *into g;
  if g.id is null then raise exception 'BILLING_NOT_FOUND';end if;
 elsif p_action='transfer'then
  next_manager:=(p_data->>'managerId')::uuid;
  if next_manager is null or next_manager=b.billing_manager_id or not exists(select 1 from auth.users u where u.id=next_manager and u.raw_app_meta_data->>'role'='manager'and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
   and exists(select 1 from private.billing_shops l join public.branches br on br.id=l.branch_id where l.business_id=business and br.manager_id=u.id))then raise exception 'BILLING_MANAGER_REQUIRED';end if;
  update private.billing_businesses set billing_manager_id=next_manager where id=business;
  update private.billing_subscriptions set revision=revision+1 where business_id=business;
 elsif p_action='create-code'then
  code:=upper(btrim(p_data->>'code'));last_at:=(((p_data->>'expiresOn')::date+1)::timestamp at time zone'Asia/Kuwait');
  if last_at is null or last_at<=clock_timestamp()then raise exception 'BILLING_INVALID_DATES';end if;
  if jsonb_typeof(p_data->'value')<>'number'or(p_data->>'value')!~'^[0-9]+$'then raise exception 'BILLING_INVALID';end if;
  insert into private.billing_discount_codes(code,kind,value,eligibility,payments,expires_at,redemption_limit)
   values(code,p_data->>'kind',(p_data->>'value')::bigint,p_data->>'eligibility',(p_data->>'payments')::integer,last_at,nullif(p_data->>'limit','')::integer)returning *into c;
 elsif p_action='toggle-code'then
  if jsonb_typeof(p_data->'enabled')is distinct from'boolean'then raise exception 'BILLING_INVALID';end if;
  update private.billing_discount_codes set enabled=(p_data->>'enabled')::boolean where id=(p_data->>'codeId')::uuid returning *into c;
  if c.id is null then raise exception 'BILLING_NOT_FOUND';end if;
 end if;
 insert into private.billing_audit(business_id,actor_id,action,reason,details)values(business,actor,p_action,reason,
  case when p_action='transfer'then jsonb_build_object('previousManagerId',b.billing_manager_id,'managerId',next_manager)
  when g.id is not null then jsonb_build_object('grantId',g.id)
  when c.id is not null then jsonb_build_object('codeId',c.id,'code',c.code)else jsonb_build_object('frequency',frequency,'renewalRequested',p_data->'renewalRequested')end);
 result:=jsonb_build_object('saved',true,'id',coalesce(g.id,c.id,business));
 insert into private.billing_requests(actor_id,request_id,input,result)values(actor,request_id,jsonb_build_object('action',p_action,'data',p_data),result);
 return result;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range or check_violation or not_null_violation then raise exception 'BILLING_INVALID';
 when unique_violation then raise exception 'BILLING_DUPLICATE';
end $$;

-- Small exposed invoker wrapper; privilege elevation and live-session checks are
-- confined to the private dispatcher. No direct table access from Data API.
create function public.subscription_billing(p_action text,p_data jsonb default '{}')returns jsonb
language sql set search_path='' as $$select private.billing_api(p_action,p_data);$$;
revoke all on function public.subscription_billing(text,jsonb)from public,anon,service_role;
grant execute on function public.subscription_billing(text,jsonb)to authenticated;
revoke all on function private.billing_api(text,jsonb)from public,anon,service_role;
grant execute on function private.billing_api(text,jsonb)to authenticated;
revoke all on function private.billing_active_count(uuid),private.billing_price(integer,text),private.billing_access(uuid,timestamptz),private.billing_register_shop(),private.billing_business_view(uuid,uuid,boolean)from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
