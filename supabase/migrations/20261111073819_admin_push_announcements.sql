begin;
-- Admin announcements are separate from booking events, preferences and dashboards.
create table private.announcement_preferences (
 account_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false, enabled_since timestamptz not null default clock_timestamp()
);
create table private.announcement_devices (
 device_id uuid primary key references private.customer_push_devices(id) on delete cascade,
 account_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null references auth.sessions(id) on delete cascade,
 registration_version bigint not null, registered_at timestamptz not null default clock_timestamp()
);
create index announcement_devices_account on private.announcement_devices(account_id,device_id);
create table private.announcement_campaigns (
 id uuid primary key default gen_random_uuid(), created_by uuid references auth.users(id) on delete set null,
 created_session uuid, title_en text not null check(length(title_en) between 1 and 80),
 body_en text not null check(length(body_en) between 1 and 500), title_ar text not null default '' check(length(title_ar)<=80),
 body_ar text not null default '' check(length(body_ar)<=500),
 destination text not null check(destination in ('none','book','account','favourites')),
 filters jsonb not null, state text not null default 'preview' check(state in ('preview','queued')),
 created_at timestamptz not null default clock_timestamp(), preview_expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',
 queued_at timestamptz, expires_at timestamptz not null default clock_timestamp()+interval '24 hours'
);
create index announcement_campaigns_history on private.announcement_campaigns(created_at desc,id desc);
create index announcement_campaigns_admin on private.announcement_campaigns(created_by,created_at);
create table private.announcement_targets (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references private.announcement_campaigns(id) on delete cascade,
 account_id uuid references auth.users(id) on delete set null, exclusion text,
 unique(campaign_id,account_id)
);
create index announcement_targets_campaign on private.announcement_targets(campaign_id,id);
create table private.announcement_deliveries (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references private.announcement_campaigns(id) on delete cascade,
 target_id uuid not null references private.announcement_targets(id) on delete cascade,
 device_id uuid references private.customer_push_devices(id) on delete set null,
 registration_version bigint not null, token_hash bytea not null,
 state text not null default 'pending' check(state in ('pending','sending','accepted','captured','skipped','failed','unknown')),
 attempts integer not null default 0, available_at timestamptz not null default now(), lease_id uuid, leased_until timestamptz,
 delivery_mode text check(delivery_mode in('capture','apns')), provider_status integer, provider_id text, last_error text, finished_at timestamptz,
 unique(campaign_id,device_id)
);
create index announcement_deliveries_campaign on private.announcement_deliveries(campaign_id,state);
create index announcement_deliveries_due on private.announcement_deliveries(available_at,id) where state='pending';
create index announcement_deliveries_leases on private.announcement_deliveries(leased_until) where state='sending';
create table private.announcement_runtime (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 mode text not null default 'capture' check(mode in ('capture','apns')), api_url text,
 check(api_url is null or api_url in ('https://qvkucvcjmojjbphlzlks.supabase.co','https://srv1073968.hstgr.cloud')),
 check(mode<>'capture' or api_url is null or api_url='https://qvkucvcjmojjbphlzlks.supabase.co')
);
insert into private.announcement_runtime(singleton) values(true);
do $$declare t text;begin
 foreach t in array array['announcement_preferences','announcement_devices','announcement_campaigns','announcement_targets','announcement_deliveries','announcement_runtime']loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on private.%I to service_role',t);
 end loop;
end $$;

create function private.require_announcement_admin(p_user uuid,p_session uuid)returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
  where u.id=p_user and s.id=p_session and u.raw_app_meta_data->>'role'='admin'
   and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())and(s.not_after is null or s.not_after>now()))then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
  where s.id=p_session and s.user_id=p_user and s.aal='aal2'and f.status='verified'and f.factor_type='totp')then raise exception 'ADMIN_MFA_REQUIRED';end if;
end $$;

create function private.announcement_device_allowed(p_device uuid,p_account uuid)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.customer_push_devices d
  join private.announcement_devices cap on cap.device_id=d.id and cap.account_id=d.account_id and cap.session_id=d.session_id and cap.registration_version=d.registration_version
  join private.announcement_preferences ap on ap.account_id=d.account_id and ap.enabled
  join private.customer_accounts ca on ca.user_id=d.account_id join public.customers c on c.id=ca.customer_id and c.status='active'
  left join private.customer_push_preferences pref on pref.account_id=d.account_id
  join private.customer_push_runtime runtime on runtime.singleton
  where d.id=p_device and d.account_id=p_account and d.enabled and d.permission and d.notifications_enabled
   and coalesce(pref.notifications_enabled,true)and public.customer_session_is_live(d.account_id,d.session_id)
   and d.topic=runtime.topic and d.environment=any(runtime.environments)
   and d.token ~ '^[0-9a-f]{32,512}$'and length(d.token)%2=0);
$$;

create function private.customer_announcement_api(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare account uuid:=(p_data->>'user_id')::uuid;sid uuid:=(p_data->>'session_id')::uuid;d private.customer_push_devices;
begin
 if not public.customer_session_is_live(account,sid)then raise exception 'AUTH_REQUIRED';end if;
 if p_action not in ('status','register','preference')or p_action is null then raise exception 'INVALID_REQUEST';end if;
 if p_action in ('register','preference')then
  if p_data->>'deviceSecret' !~ '^[0-9a-f]{64}$'or p_data->>'deviceSecret'is null or p_data->>'version'<>'1'then raise exception 'INVALID_REQUEST';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_data->>'deviceId',714));
  select * into d from private.customer_push_devices where id=(p_data->>'deviceId')::uuid for update;
  if not found or d.account_id is distinct from account or d.session_id is distinct from sid
   or d.secret_hash is distinct from extensions.digest(p_data->>'deviceSecret','sha256')then raise exception 'FORBIDDEN';end if;
  insert into private.announcement_devices(device_id,account_id,session_id,registration_version)values(d.id,account,sid,d.registration_version)
   on conflict(device_id)do update set account_id=excluded.account_id,session_id=excluded.session_id,registration_version=excluded.registration_version,registered_at=clock_timestamp();
  if p_action='preference'then
   if jsonb_typeof(p_data->'enabled')is distinct from 'boolean'then raise exception 'INVALID_REQUEST';end if;
   insert into private.announcement_preferences as saved(account_id,enabled)values(account,(p_data->>'enabled')::boolean)
    on conflict(account_id)do update set enabled=excluded.enabled,enabled_since=case when excluded.enabled and not saved.enabled then clock_timestamp()else saved.enabled_since end;
  end if;
 end if;
 return jsonb_build_object('enabled',coalesce((select enabled from private.announcement_preferences where account_id=account),false),'version',1);
end $$;
create function public.customer_announcement_api(p_action text,p_data jsonb)returns jsonb language sql set search_path='' as $$select private.customer_announcement_api(p_action,p_data);$$;

create function private.announcement_audience(p_filters jsonb)returns table(account_id uuid,name text,email text,role text,device_count bigint,exclusion text)
language sql stable security definer set search_path='' as $$
 with accounts as(
  select ca.user_id id,c.name,coalesce(u.email,'')email,u.raw_app_meta_data->>'role'role,c.status,
   u.deleted_at,u.banned_until,coalesce((select ap.enabled from private.announcement_preferences ap where ap.account_id=ca.user_id),false) opted_in
  from private.customer_accounts ca join public.customers c on c.id=ca.customer_id join auth.users u on u.id=ca.user_id
  where u.raw_app_meta_data->>'role'in('customer','manager','barber')
   and(coalesce(jsonb_array_length(p_filters->'roles'),0)=0 or (u.raw_app_meta_data->>'role')in(select jsonb_array_elements_text(p_filters->'roles')))
   and(coalesce(jsonb_array_length(p_filters->'userIds'),0)=0 or ca.user_id in(select value::uuid from jsonb_array_elements_text(p_filters->'userIds')))
   and not ca.user_id in(select value::uuid from jsonb_array_elements_text(coalesce(p_filters->'excludeIds','[]')))
   and(coalesce(p_filters->>'query','')=''or position(lower(p_filters->>'query')in lower(c.name||' '||coalesce(u.email,'')||' '||coalesce(c.phone,'')))>0)
   and(not(coalesce(p_filters->>'upcoming','false')='true'or coalesce(p_filters->>'dateFrom','')<>''or coalesce(p_filters->>'dateTo','')<>''
     or coalesce(jsonb_array_length(p_filters->'shopIds'),0)>0 or coalesce(p_filters->>'governorateId','')<>''or coalesce(p_filters->>'city','')<>'')
    or exists(select 1 from private.customer_booking_owners o join public.bookings b on b.id=o.booking_id join public.branches s on s.id=b.branch_id
     where o.account_user_id=ca.user_id and b.status in('pending','confirmed','completed')
      and(coalesce(p_filters->>'upcoming','false')<>'true'or(b.status in('pending','confirmed')and(b.date+b.time)at time zone'Asia/Kuwait'>now()))
      and(coalesce(p_filters->>'dateFrom','')=''or b.date>=(p_filters->>'dateFrom')::date)
      and(coalesce(p_filters->>'dateTo','')=''or b.date<=(p_filters->>'dateTo')::date)
      and(coalesce(jsonb_array_length(p_filters->'shopIds'),0)=0 or s.id in(select value::uuid from jsonb_array_elements_text(p_filters->'shopIds')))
      and(coalesce(p_filters->>'governorateId','')=''or s.governorate_id=(p_filters->>'governorateId')::integer)
      and(coalesce(p_filters->>'city','')=''or s.city=p_filters->>'city')))
 ),counts as(select a.*,(select count(*)from private.customer_push_devices d where d.account_id=a.id and private.announcement_device_allowed(d.id,a.id))devices from accounts a)
 select id,name,email,role,devices,case when deleted_at is not null or(banned_until is not null and banned_until>now())or status<>'active'then'account_inactive'
  when not opted_in then'opted_out'when devices=0 then'no_eligible_device'else null end from counts;
$$;

create function private.announcement_summary(p_campaign uuid)returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'titleEn',c.title_en,'bodyEn',c.body_en,'titleAr',c.title_ar,'bodyAr',c.body_ar,'destination',c.destination,
  'state',c.state,'createdAt',c.created_at,'queuedAt',c.queued_at,'previewExpiresAt',c.preview_expires_at,'expiresAt',c.expires_at,
  'matchedUsers',(select count(*)from private.announcement_targets t where t.campaign_id=c.id),
  'eligibleUsers',(select count(*)from private.announcement_targets t where t.campaign_id=c.id and t.exclusion is null),
  'excludedUsers',(select count(*)from private.announcement_targets t where t.campaign_id=c.id and t.exclusion is not null),
  'devices',(select count(*)from private.announcement_deliveries d where d.campaign_id=c.id),
  'results',(select coalesce(jsonb_object_agg(state,n),'{}')from(select state,count(*)n from private.announcement_deliveries d where d.campaign_id=c.id group by state)x))
 from private.announcement_campaigns c where c.id=p_campaign;
$$;

create function private.kick_admin_push()returns void language plpgsql security definer set search_path='' as $$
declare runtime private.announcement_runtime;secret text;
begin
 select * into runtime from private.announcement_runtime where singleton;
 if not runtime.enabled or runtime.api_url is null then return;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='customer_push_dispatch_secret';
 if secret is null then return;end if;
 perform net.http_post(url:=runtime.api_url||'/functions/v1/admin-push-dispatch',headers:=jsonb_build_object('Content-Type','application/json','x-push-secret',secret),body:='{}',timeout_milliseconds:=10000);
exception when others then raise log 'Announcement dispatch deferred';end $$;

create function private.admin_push_api(p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(p_data->>'user_id')::uuid;sid uuid:=(p_data->>'session_id')::uuid;campaign private.announcement_campaigns;filters jsonb;
 page integer:=coalesce((p_data->>'page')::integer,1);rows jsonb;total bigint;runtime private.announcement_runtime;
begin
 perform private.require_announcement_admin(actor,sid);
 if page not between 1 and 10000 then raise exception 'INVALID_REQUEST';end if;
 select * into runtime from private.announcement_runtime where singleton;
 if p_action='options'then
  return jsonb_build_object('governorates',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'nameEn',name_en,'nameAr',name_ar)order by id),'[]')from public.governorates),
   'cities',(select coalesce(jsonb_agg(jsonb_build_object('city',city,'governorateId',governorate_id)order by city),'[]')from(select distinct city,governorate_id from public.branches where city is not null)x),
   'shops',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'nameAr',name_ar,'city',city,'governorateId',governorate_id)order by name),'[]')from public.branches),
   'delivery',jsonb_build_object('enabled',runtime.enabled,'mode',runtime.mode));
 elsif p_action in('users','preview')then
  filters:=coalesce(p_data->'filters','{}');
  if jsonb_typeof(filters)<>'object'or filters-array['roles','userIds','excludeIds','shopIds','governorateId','city','query','upcoming','dateFrom','dateTo']<>'{}'
   or length(coalesce(filters->>'query',''))>120 or length(coalesce(filters->>'city',''))>120 then raise exception 'INVALID_REQUEST';end if;
  if filters?'upcoming'and jsonb_typeof(filters->'upcoming')<>'boolean'then raise exception 'INVALID_REQUEST';end if;
  for rows in select filters->key from unnest(array['roles','userIds','excludeIds','shopIds'])key where filters?key loop
   if jsonb_typeof(rows)<>'array'or jsonb_array_length(rows)>500 then raise exception 'INVALID_REQUEST';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements_text(coalesce(filters->'roles','[]'))x where x not in('customer','manager','barber'))then raise exception 'INVALID_REQUEST';end if;
  if coalesce(filters->>'dateFrom','')<>''and coalesce(filters->>'dateTo','')<>''and(filters->>'dateFrom')::date>(filters->>'dateTo')::date then raise exception 'INVALID_REQUEST';end if;
  if p_action='users'then
   select count(*)into total from private.announcement_audience(filters);
   select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select account_id as id,name,email,role,device_count as devices,exclusion from private.announcement_audience(filters)order by name,account_id limit 25 offset(page-1)*25)x;
   return jsonb_build_object('users',rows,'total',total,'page',page,'pageSize',25);
  end if;
  if not runtime.enabled then raise exception 'DELIVERY_DISABLED';end if;
  if length(btrim(coalesce(p_data->>'titleEn','')))not between 1 and 80 or length(btrim(coalesce(p_data->>'bodyEn','')))not between 1 and 500
   or length(coalesce(p_data->>'titleAr',''))>80 or length(coalesce(p_data->>'bodyAr',''))>500
   or coalesce(p_data->>'destination','none')not in('none','book','account','favourites')
   or((btrim(coalesce(p_data->>'titleAr',''))='')is distinct from(btrim(coalesce(p_data->>'bodyAr',''))=''))then raise exception 'INVALID_REQUEST';end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,718));
  if(select count(*)from private.announcement_campaigns where created_by=actor and created_at>now()-interval '1 hour')>=60 then raise exception 'RATE_LIMITED';end if;
  if(select count(*)from private.announcement_audience(filters))>50000 then raise exception 'AUDIENCE_TOO_LARGE';end if;
  insert into private.announcement_campaigns(created_by,created_session,title_en,body_en,title_ar,body_ar,destination,filters)
   values(actor,sid,btrim(p_data->>'titleEn'),btrim(p_data->>'bodyEn'),btrim(coalesce(p_data->>'titleAr','')),btrim(coalesce(p_data->>'bodyAr','')),coalesce(p_data->>'destination','none'),filters)returning * into campaign;
  insert into private.announcement_targets(campaign_id,account_id,exclusion)select campaign.id,a.account_id,a.exclusion from private.announcement_audience(filters)a;
  insert into private.announcement_deliveries(campaign_id,target_id,device_id,registration_version,token_hash)
   select campaign.id,t.id,d.id,d.registration_version,extensions.digest(d.token,'sha256')from private.announcement_targets t
   join private.customer_push_devices d on d.account_id=t.account_id where t.campaign_id=campaign.id and t.exclusion is null and private.announcement_device_allowed(d.id,t.account_id);
  return jsonb_build_object('campaign',private.announcement_summary(campaign.id),'delivery',jsonb_build_object('enabled',runtime.enabled,'mode',runtime.mode));
 elsif p_action='send'then
  select * into campaign from private.announcement_campaigns where id=(p_data->>'campaignId')::uuid for update;
  if not found or campaign.created_by is distinct from actor or campaign.created_session is distinct from sid then raise exception 'FORBIDDEN';end if;
  if campaign.state='queued'then return jsonb_build_object('campaign',private.announcement_summary(campaign.id));end if;
  if not runtime.enabled then raise exception 'DELIVERY_DISABLED';end if;
  if campaign.preview_expires_at<=clock_timestamp()then raise exception 'PREVIEW_EXPIRED';end if;
  if not exists(select 1 from private.announcement_deliveries where campaign_id=campaign.id)then raise exception 'NO_RECIPIENTS';end if;
  if p_data->'confirmed'is distinct from 'true'::jsonb then raise exception 'CONFIRMATION_REQUIRED';end if;
  update private.announcement_campaigns set state='queued',queued_at=clock_timestamp()where id=campaign.id;
  perform private.kick_admin_push();return jsonb_build_object('campaign',private.announcement_summary(campaign.id));
 elsif p_action='history'then
  select count(*)into total from private.announcement_campaigns where state='queued';
  select coalesce(jsonb_agg(private.announcement_summary(x.id)),'[]')into rows from(select id from private.announcement_campaigns where state='queued'order by created_at desc,id desc limit 25 offset(page-1)*25)x;
  return jsonb_build_object('campaigns',rows,'total',total,'page',page,'pageSize',25);
 elsif p_action in('details','recipients')then
  select * into campaign from private.announcement_campaigns where id=(p_data->>'campaignId')::uuid;
  if not found then raise exception 'NOT_FOUND';end if;
  if p_action='details'then return jsonb_build_object('campaign',private.announcement_summary(campaign.id));end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select t.account_id id,coalesce(c.name,'')name,coalesce(u.email,'')email,u.raw_app_meta_data->>'role'role,t.exclusion,
   (select count(*)from private.announcement_deliveries j where j.target_id=t.id)devices
   from private.announcement_targets t left join auth.users u on u.id=t.account_id left join private.customer_accounts ca on ca.user_id=t.account_id left join public.customers c on c.id=ca.customer_id
   where t.campaign_id=campaign.id order by t.id limit 25 offset(page-1)*25)x;
  return jsonb_build_object('users',rows,'campaign',private.announcement_summary(campaign.id),'page',page,'pageSize',25);
 end if;
 raise exception 'INVALID_REQUEST';
end $$;
create function public.admin_push_api(p_action text,p_data jsonb)returns jsonb language sql set search_path='' as $$select private.admin_push_api(p_action,p_data);$$;

create function private.announcement_delivery_allowed(p_id uuid)returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.announcement_deliveries j join private.announcement_targets t on t.id=j.target_id
  join private.announcement_campaigns c on c.id=j.campaign_id join private.customer_push_devices d on d.id=j.device_id
  join private.announcement_preferences pref on pref.account_id=t.account_id
  where j.id=p_id and c.state='queued'and c.expires_at>now()and t.account_id=d.account_id
   and d.registration_version=j.registration_version and extensions.digest(d.token,'sha256')=j.token_hash
   and pref.enabled_since<=c.created_at and private.announcement_device_allowed(d.id,t.account_id));
$$;

create function private.admin_push_worker(p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare runtime private.announcement_runtime;result jsonb;j private.announcement_deliveries;status integer;reason text;
begin
 select * into runtime from private.announcement_runtime where singleton;
 if p_action='configuration'then return private.customer_push_configuration()||jsonb_build_object('announcementEnabled',runtime.enabled,'deliveryMode',runtime.mode,'announcementApiUrl',runtime.api_url);end if;
 if p_action='configure'then
  if jsonb_typeof(p_data->'enabled')is distinct from'boolean'or p_data->>'mode'not in('capture','apns')or p_data->>'apiUrl'is distinct from(select api_url from private.customer_push_runtime where singleton)then raise exception 'INVALID_REQUEST';end if;
  update private.announcement_runtime set enabled=(p_data->>'enabled')::boolean,mode=p_data->>'mode',api_url=p_data->>'apiUrl'where singleton;return jsonb_build_object('configured',true);
 end if;
 if not runtime.enabled and p_action<>'finish'then raise exception 'DELIVERY_DISABLED';end if;
 if p_action='claim'then
  -- An expired lease may have reached Apple. Never resend an uncertain delivery.
  update private.announcement_deliveries set state='unknown',last_error='LeaseExpired',finished_at=clock_timestamp()where state='sending'and leased_until<now();
  update private.announcement_deliveries j set state='skipped',last_error='NoLongerEligible',finished_at=clock_timestamp()
   from private.announcement_campaigns c where j.campaign_id=c.id and c.state='queued'and j.state='pending'and not private.announcement_delivery_allowed(j.id);
  with candidates as(select d.id from private.announcement_deliveries d join private.announcement_campaigns c on c.id=d.campaign_id
   where c.state='queued'and d.state='pending'and d.available_at<=now()order by d.available_at,d.id for update of d skip locked limit greatest(1,least(coalesce((p_data->>'limit')::integer,20),20))),
  leased as(update private.announcement_deliveries d set state='sending',delivery_mode=runtime.mode,attempts=attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '2 minutes'from candidates c where d.id=c.id returning d.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'lease',l.lease_id,'campaignId',c.id,'deliveryMode',l.delivery_mode,'token',d.token,'environment',d.environment,'topic',d.topic,'language',d.language,
   'titleEn',c.title_en,'bodyEn',c.body_en,'titleAr',c.title_ar,'bodyAr',c.body_ar,'destination',c.destination,'expiresAt',extract(epoch from c.expires_at)::bigint)),'[]')into result
   from leased l join private.announcement_campaigns c on c.id=l.campaign_id join private.customer_push_devices d on d.id=l.device_id;
  return result;
 elsif p_action='validate'then
  return to_jsonb(exists(select 1 from private.announcement_deliveries d where d.id=(p_data->>'id')::uuid and d.lease_id=(p_data->>'lease')::uuid and d.state='sending'and d.leased_until>now()and runtime.enabled and d.delivery_mode=runtime.mode and private.announcement_delivery_allowed(d.id)));
 elsif p_action='finish'then
  select * into j from private.announcement_deliveries where id=(p_data->>'id')::uuid and lease_id=(p_data->>'lease')::uuid and state='sending'for update;
  if not found then return 'false'::jsonb;end if;
  status:=(p_data->>'status')::integer;reason:=left(coalesce(p_data->>'reason',''),80);
  if reason='NoLongerEligible'then update private.announcement_deliveries set state='skipped',last_error=reason,finished_at=clock_timestamp(),leased_until=null where id=j.id;
  elsif status=200 then update private.announcement_deliveries set state=case when j.delivery_mode='capture'then'captured'else'accepted'end,provider_status=status,provider_id=left(p_data->>'providerId',100),finished_at=clock_timestamp(),leased_until=null where id=j.id;
  elsif status in(429,500,503)and j.attempts<3 then update private.announcement_deliveries set state='pending',available_at=now()+make_interval(secs=>30*power(2,j.attempts)::integer),last_error=reason,provider_status=status,leased_until=null where id=j.id;
  else
   update private.announcement_deliveries set state=case when status=0 then'unknown'else'failed'end,provider_status=status,last_error=reason,finished_at=clock_timestamp(),leased_until=null where id=j.id;
   if status=410 or reason in('BadDeviceToken','Unregistered','DeviceTokenNotForTopic')then
    update private.customer_push_devices set permission=false,token=null where id=j.device_id and extensions.digest(token,'sha256')=j.token_hash;
   end if;
  end if;
  return 'true'::jsonb;
 end if;
 raise exception 'INVALID_REQUEST';
end $$;
create function public.admin_push_worker(p_action text,p_data jsonb)returns jsonb language sql set search_path='' as $$select private.admin_push_worker(p_action,p_data);$$;

do $$declare signature text;begin
 foreach signature in array array['private.require_announcement_admin(uuid,uuid)','private.announcement_device_allowed(uuid,uuid)','private.customer_announcement_api(text,jsonb)','private.announcement_audience(jsonb)','private.announcement_summary(uuid)','private.kick_admin_push()','private.admin_push_api(text,jsonb)','private.announcement_delivery_allowed(uuid)','private.admin_push_worker(text,jsonb)','public.customer_announcement_api(text,jsonb)','public.admin_push_api(text,jsonb)','public.admin_push_worker(text,jsonb)']loop
  execute 'revoke all on function '||signature||' from public,anon,authenticated';
  execute 'grant execute on function '||signature||' to service_role';
 end loop;
end $$;
select cron.schedule('admin-push-dispatch','* * * * *','select private.kick_admin_push();');
notify pgrst,'reload schema';
commit;
