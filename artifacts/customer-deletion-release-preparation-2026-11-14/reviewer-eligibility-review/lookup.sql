\set ON_ERROR_STOP on
begin isolation level repeatable read read only;
set local search_path = pg_catalog;
set local statement_timeout = '8s';
set local lock_timeout = '1s';
set local idle_in_transaction_session_timeout = '12s';
with required(s,r,c,t) as (values
('auth','users','id','uuid'),
('auth','users','email','character varying'),
('auth','users','email_confirmed_at','timestamp with time zone'),
('auth','users','encrypted_password','character varying'),
('auth','users','raw_app_meta_data','jsonb'),
('auth','users','banned_until','timestamp with time zone'),
('auth','users','deleted_at','timestamp with time zone'),
('auth','identities','user_id','uuid'),
('auth','identities','provider','text'),
('public','customers','id','uuid'),
('public','customers','email','character varying'),
('public','customers','status','character varying'),
('private','customer_accounts','user_id','uuid'),
('private','customer_accounts','customer_id','uuid'),
('private','customer_social_identities','user_id','uuid'),
('private','customer_social_identities','account_user_id','uuid'),
('public','branches','id','uuid'),
('public','branches','manager_id','uuid'),
('public','branches','name','text'),
('public','branches','status','text'),
('public','branches','publication_state','text'),
('public','branches','working_hours','jsonb'),
('public','barbers','id','uuid'),
('public','barbers','user_id','uuid'),
('public','barbers','branch_id','uuid'),
('public','barbers','name','text'),
('public','barbers','status','text'),
('public','barbers','service_ids','uuid[]'),
('public','barbers','availability','jsonb'),
('public','barbers','time_offs','jsonb'),
('public','barbers','vacations','jsonb'),
('public','barbers','availability_approved_at','timestamp with time zone'),
('public','barbers','invite_status','character varying'),
('public','barbers','manager_chair','boolean'),
('public','barbers','management_mode','text'),
('public','barbers','max_booking_days','integer'),
('public','services','id','uuid'),
('public','services','branch_id','uuid'),
('public','services','name','text'),
('public','services','status','text'),
('public','services','duration','integer'),
('public','services','price','numeric'),
('public','audit_logs','admin_user_id','uuid'),
('private','shop_barber_invitations','manager_id','uuid'),
('private','shop_barber_invitations','accepted_user_id','uuid'),
('private','shop_barber_invitations','email','text'),
('private','shop_barber_invitations','status','text'),
('private','customer_checkout_runtime','singleton','boolean'),
('private','customer_checkout_runtime','policy','text')
)
select (current_setting('server_version_num')::integer between 170000 and 179999
 and to_regprocedure('pg_catalog.pg_input_is_valid(text,text)') is not null
 and not exists(
 select 1 from required x
 left join pg_namespace ns on ns.nspname=x.s
 left join pg_class cl on cl.relnamespace=ns.oid and cl.relname=x.r and cl.relkind='r'
 left join pg_attribute a on a.attrelid=cl.oid and a.attname=x.c and a.attnum>0 and not a.attisdropped
 where a.atttypid is distinct from to_regtype(x.t))) as schema_ok
\gset
\if :schema_ok
with
target_auth as materialized (
 select id,email_confirmed_at,encrypted_password,raw_app_meta_data,banned_until,deleted_at
 from auth.users where lower(email)='support@barberplusplus.com'
), primary_owners as materialized (
 select distinct coalesce(x.account_user_id,u.id) as id from target_auth u
 left join private.customer_social_identities x on x.user_id=u.id
), people as materialized (
 select u.id,u.raw_app_meta_data,u.banned_until,u.deleted_at from auth.users u
 where u.id in(select id from target_auth) or u.id in(select id from primary_owners)
 or u.id in(select x.user_id from private.customer_social_identities x where x.account_user_id in(select id from primary_owners))
), email_customers as materialized (
 select id,status from public.customers where lower(email)='support@barberplusplus.com'
), owned_customers as materialized (
 select distinct a.customer_id from private.customer_accounts a where a.user_id in(select id from people)
), shop as materialized (
 select id,manager_id,status,publication_state,working_hours from public.branches
 where name='Atlas Grooming — Sharq (Demo)'
), barber as materialized (
 select b.id,b.user_id,b.branch_id,b.status,b.service_ids,b.availability,b.time_offs,b.vacations,
 b.availability_approved_at,b.invite_status,b.manager_chair,b.management_mode,b.max_booking_days
 from public.barbers b join shop s on s.id=b.branch_id where b.name='Kareem Shah'
), service as materialized (
 select v.id,v.branch_id,v.status,v.duration,v.price from public.services v
 join shop s on s.id=v.branch_id where v.name='Beard trim'
), schedule as materialized (
 select
 (jsonb_typeof(s.working_hours)='object' and jsonb_typeof(b.availability)='object'
 and jsonb_typeof(b.time_offs)='array' and jsonb_typeof(b.vacations)='array'
 and not exists(select 1 from jsonb_each(case when jsonb_typeof(s.working_hours)='object' then s.working_hours else '{}'::jsonb end) h
   where not coalesce(h.key in('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
   and jsonb_typeof(h.value)='object'
   and (nullif(h.value->>'open','') is null or
    (h.value->>'open' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and h.value->>'close' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and h.value->>'open'<h.value->>'close')),false))
 and not exists(select 1 from jsonb_each(case when jsonb_typeof(b.availability)='object' then b.availability else '{}'::jsonb end) h
   where not coalesce(h.key in('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
   and jsonb_typeof(h.value)='object' and coalesce(h.value->>'enabled',h.value->>'available','false') in('true','false')
   and (coalesce(h.value->>'enabled',h.value->>'available','false')='false' or
    (h.value->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and h.value->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and h.value->>'start'<h.value->>'end')),false))
 and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(b.time_offs)='array' then b.time_offs else '[]'::jsonb end) x
   where not coalesce(jsonb_typeof(x)='object'
   and x->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and x->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and x->>'start'<x->>'end'
   and ((x->>'type'='recurring' and x->>'day' in('monday','tuesday','wednesday','thursday','friday','saturday','sunday'))
     or (x->>'type'='one-time' and x->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and pg_input_is_valid(x->>'date','date'))),false))
 and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(b.vacations)='array' then b.vacations else '[]'::jsonb end) x
   where not coalesce(jsonb_typeof(x)='object' and x->>'startDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   and x->>'endDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   and pg_input_is_valid(x->>'startDate','date') and pg_input_is_valid(x->>'endDate','date')
   and x->>'startDate'<=x->>'endDate',false))) as recognized,
 exists(select 1 from jsonb_each(case when jsonb_typeof(b.availability)='object' then b.availability else '{}'::jsonb end) h
   where h.key in('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
   and case when coalesce(h.value->>'enabled',h.value->>'available','false')='true'
     and h.value->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and h.value->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and s.working_hours->h.key->>'open' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and s.working_hours->h.key->>'close' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and h.value->>'start'<h.value->>'end' and s.working_hours->h.key->>'open'<s.working_hours->h.key->>'close'
   then least(h.value->>'end',s.working_hours->h.key->>'close')::time
     - greatest(h.value->>'start',s.working_hours->h.key->>'open')::time >= interval '15 minutes'
   else false end) as regular_overlap
 from shop s join barber b on b.branch_id=s.id
), policy as materialized (
 select policy from private.customer_checkout_runtime where singleton
)
select jsonb_build_object(
 'schemaAvailable',true,
 'authMatchCount',(select count(*)from target_auth),
 'customerEmailMatchCount',(select count(*)from email_customers),
 'canonicalCustomerCount',(select count(*)from owned_customers),
 'shopMatchCount',(select count(*)from shop),
 'barberMatchCount',(select count(*)from barber),
 'serviceMatchCount',(select count(*)from service),
 'emailConfirmed',coalesce((select bool_and(email_confirmed_at is not null)from target_auth),false),
 'passwordAvailable',coalesce((select bool_and(length(encrypted_password)>0)from target_auth),false),
 'authEnabled',coalesce((select bool_and(deleted_at is null and (banned_until is null or banned_until<=now()))from people),false),
 'trustedRoleIsCustomer',coalesce((select bool_and(raw_app_meta_data->>'role'='customer')from people),false),
 'emailProviderAvailable',exists(select 1 from auth.identities where user_id in(select id from people)and provider='email'),
 'googleProviderAvailable',exists(select 1 from auth.identities where user_id in(select id from people)and provider='google'),
 'appleProviderAvailable',exists(select 1 from auth.identities where user_id in(select id from people)and provider='apple'),
 'privilegedWorkConflict',exists(select 1 from people where raw_app_meta_data->>'role' is distinct from 'customer')
   or exists(select 1 from public.barbers where user_id in(select id from people))
   or exists(select 1 from public.branches where manager_id in(select id from people))
   or exists(select 1 from public.audit_logs where admin_user_id in(select id from people))
   or exists(select 1 from private.shop_barber_invitations where manager_id in(select id from people)or accepted_user_id in(select id from people)),
 'customerScopeConflict',exists(select 1 from private.customer_accounts where customer_id in(select customer_id from owned_customers)and user_id not in(select id from people))
   or exists(select 1 from private.customer_accounts where customer_id in(select id from email_customers)and user_id not in(select id from people)),
 'pendingShopInvitationForEmail',exists(select 1 from private.shop_barber_invitations where lower(email)='support@barberplusplus.com'and status='pending'),
 'customerProfileActive',coalesce((select bool_and(status='active')from public.customers where id in(select customer_id from owned_customers)),false),
 'shopActive',coalesce((select bool_and(status='active')from shop),false),
 'shopPublished',coalesce((select bool_and(publication_state='published')from shop),false),
 'barberActive',coalesce((select bool_and(status='active')from barber),false),
 'barberAccountEligible',exists(select 1 from barber b join shop s on s.id=b.branch_id
   where (b.management_mode='managed'and b.user_id is null and not b.manager_chair)
   or (b.management_mode='account'and (b.invite_status is null or b.invite_status='accepted'or b.manager_chair)
     and exists(select 1 from auth.users u where u.id=b.user_id and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
       and ((b.manager_chair and u.id=s.manager_id and u.raw_app_meta_data->>'role'='manager')
        or(not b.manager_chair and u.raw_app_meta_data->>'role'='barber'))))),
 'serviceActive',coalesce((select bool_and(status='active')from service),false),
 'serviceLinked',exists(select 1 from service s join barber b on b.branch_id=s.branch_id where s.id=any(b.service_ids)),
 'priceMatches',coalesce((select bool_and(price=3.000)from service),false),
 'durationMatches',coalesce((select bool_and(duration=15)from service),false),
 'scheduleDataRecognized',coalesce((select bool_and(recognized)from schedule),false),
 'scheduleApproved',coalesce((select bool_and(availability_approved_at is not null)from barber),false),
 'regularHoursCanFitService',coalesce((select bool_and(regular_overlap)from schedule),false),
 'maxBookingDaysValid',coalesce((select bool_and(max_booking_days between 1 and 365)from barber),false),
 'hasBreaks',exists(select 1 from barber where time_offs<>'[]'::jsonb),
 'hasVacations',exists(select 1 from barber where vacations<>'[]'::jsonb),
 'futureSlotVerified',false,
 'fullDeletionEligibilityVerified',false,
 'checkoutPolicy',case when(select count(*)from policy)=1 then(select case when policy in('standard','email_only')then policy else null end from policy)else null end
);
\else
select '{"schemaAvailable":false}'::jsonb;
\endif
rollback;
