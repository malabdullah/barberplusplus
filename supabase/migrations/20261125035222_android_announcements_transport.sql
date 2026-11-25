-- Local release candidate only. No activation or credentials are installed.
begin;
do $$ begin
 if to_regclass('private.android_live_push_devices') is null then raise exception 'ANDROID_ANNOUNCEMENT_DEPENDENCY_MISSING';end if;
end $$;

-- Keep APNs registrations and deliveries physically unchanged. Both transports
-- share the account's existing explicit announcement preference.
create table private.android_announcement_runtime(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 activated_at timestamptz not null default clock_timestamp(),
 mode text not null default 'capture' check(mode in('capture','send')),
 api_url text not null default 'https://srv1073968.hstgr.cloud' check(api_url='https://srv1073968.hstgr.cloud')
);
insert into private.android_announcement_runtime(singleton)values(true);
create table private.android_announcement_devices(
 device_id uuid primary key references private.android_live_push_devices(id)on delete cascade,
 account_id uuid not null references auth.users(id)on delete cascade,
 session_id uuid not null references auth.sessions(id)on delete cascade,
 registration_version bigint not null,
 registered_at timestamptz not null default clock_timestamp(),
 binding text not null default encode(extensions.gen_random_bytes(32),'hex')check(binding~'^[0-9a-f]{64}$'),
 eligibility_epoch bigint not null default 1
);
create index android_announcement_devices_account on private.android_announcement_devices(account_id,device_id);
create table private.android_announcement_deliveries(like private.announcement_deliveries including defaults including constraints including indexes);
alter table private.android_announcement_deliveries
 add foreign key(campaign_id)references private.announcement_campaigns(id)on delete cascade,
 add foreign key(target_id)references private.announcement_targets(id)on delete cascade,
 add foreign key(device_id)references private.android_live_push_devices(id)on delete set null;
do $$ declare t text;begin
 foreach t in array array['android_announcement_runtime','android_announcement_devices','android_announcement_deliveries']loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on private.%I to service_role',t);
 end loop;
end $$;

create function private.android_announcement_epoch()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.account_id,new.session_id,new.token,new.secret_hash,new.permission,new.detached)
  is distinct from row(old.account_id,old.session_id,old.token,old.secret_hash,old.permission,old.detached)then
  update private.android_announcement_devices set eligibility_epoch=eligibility_epoch+1 where device_id=new.id;
 end if;
 return new;
end $$;
create trigger android_announcement_epoch after update on private.android_live_push_devices for each row execute function private.android_announcement_epoch();

create function private.android_announcement_api(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare account uuid:=(p_data->>'user_id')::uuid;sid uuid:=(p_data->>'session_id')::uuid;d private.android_live_push_devices;
begin
 if not private.android_live_push_owner(account,sid)then raise exception 'AUTH_REQUIRED';end if;
 if p_action is null or p_action not in('status','register','preference')then raise exception 'INVALID_REQUEST';end if;
 if p_data?'initializeDefaults'and(p_action<>'register'or jsonb_typeof(p_data->'initializeDefaults')is distinct from'boolean')then raise exception 'INVALID_REQUEST';end if;
 if p_action<>'status'then
  if coalesce(p_data->>'deviceSecret','')!~'^[0-9a-f]{64}$'or p_data->>'version'is distinct from'1'then raise exception 'INVALID_REQUEST';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_data->>'deviceId',714));
  select * into d from private.android_live_push_devices where id=(p_data->>'deviceId')::uuid for update;
  if not found or d.account_id is distinct from account or d.session_id is distinct from sid or d.detached
   or d.secret_hash is distinct from extensions.digest(p_data->>'deviceSecret','sha256')then raise exception 'FORBIDDEN';end if;
  insert into private.android_announcement_devices as saved(device_id,account_id,session_id,registration_version)
   values(d.id,account,sid,d.registration_version)on conflict(device_id)do update
   set account_id=excluded.account_id,session_id=excluded.session_id,registration_version=excluded.registration_version,
    registered_at=clock_timestamp(),binding=case when saved.account_id=excluded.account_id and saved.session_id=excluded.session_id then saved.binding else excluded.binding end;
  if p_action='register'and coalesce((p_data->>'initializeDefaults')::boolean,false)then
   insert into private.announcement_preferences(account_id,enabled)values(account,true)on conflict(account_id)do nothing;
  end if;
  if p_action='preference'then
   if jsonb_typeof(p_data->'enabled')is distinct from'boolean'then raise exception 'INVALID_REQUEST';end if;
   insert into private.announcement_preferences as saved(account_id,enabled)values(account,(p_data->>'enabled')::boolean)
    on conflict(account_id)do update set enabled=excluded.enabled,enabled_since=case when excluded.enabled and not saved.enabled then clock_timestamp()else saved.enabled_since end;
  end if;
 end if;
 return jsonb_build_object('client','android','version',1,'enabled',coalesce((select enabled from private.announcement_preferences where account_id=account),false),
  'preferenceConfigured',exists(select 1 from private.announcement_preferences where account_id=account))
  ||case when p_action='status'then'{}'::jsonb else jsonb_build_object('recipientBinding',(select binding from private.android_announcement_devices where device_id=d.id and account_id=account and session_id=sid))end;
end $$;
-- Preserve the exact current iOS routine as an internal implementation.
do $$ declare source text:=pg_get_functiondef('private.customer_announcement_api(text,jsonb)'::regprocedure);begin
 execute replace(source,'FUNCTION private.customer_announcement_api(','FUNCTION private.customer_announcement_ios_api(');
end $$;
create or replace function private.customer_announcement_api(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 if p_data->>'client'='android'then return private.android_announcement_api(p_action,p_data);end if;
 if p_data?'client'and p_data->>'client'is distinct from'ios'then raise exception 'INVALID_REQUEST';end if;
 return private.customer_announcement_ios_api(p_action,p_data);
end $$;

create view private.android_announcement_eligible_devices as
 select d.id,d.account_id,d.session_id,d.registration_version,d.token,d.language,cap.binding,cap.eligibility_epoch
 from private.android_live_push_devices d
 join private.android_announcement_devices cap on cap.device_id=d.id and cap.account_id=d.account_id and cap.session_id=d.session_id
 join private.announcement_preferences pref on pref.account_id=d.account_id and pref.enabled
 left join private.customer_push_preferences master on master.account_id=d.account_id
 join private.android_live_push_runtime runtime on runtime.singleton
 join private.android_announcement_runtime ar on ar.singleton and ar.enabled
 join private.announcement_runtime campaign_runtime on campaign_runtime.singleton and campaign_runtime.mode='apns'
 where d.permission and not d.detached and coalesce(master.notifications_enabled,true)
 and private.android_live_push_owner(d.account_id,d.session_id)
 and cap.registration_version=d.registration_version
 and ar.mode='send'and runtime.environment='production'and runtime.registration_enabled and runtime.delivery_enabled and runtime.mode='send'and private.android_live_push_bound(runtime)
 and runtime.api_url=ar.api_url and runtime.project_id='barber-plus-plus-phone-prod'and runtime.package_name='com.barberplusplus.customer'
 and d.updated_at>now()-interval '90 days'
 and length(d.token)between 20 and 4096 and d.token~'^[A-Za-z0-9_:-]+$'and d.token_hash=extensions.digest(d.token,'sha256')
;
create view private.all_announcement_deliveries as select * from private.announcement_deliveries union all select * from private.android_announcement_deliveries;
revoke all on private.android_announcement_eligible_devices,private.all_announcement_deliveries from public,anon,authenticated;
grant select on private.android_announcement_eligible_devices,private.all_announcement_deliveries to service_role;

-- Extend existing audience filters and reporting rather than duplicating them.
do $$ declare source text;old_text text:='left join private.announcement_eligible_devices d on d.account_id=a.id';begin
 source:=pg_get_functiondef('private.announcement_audience(jsonb)'::regprocedure);
 if position(old_text in source)>0 then
  source:=replace(source,old_text,'left join(select id,account_id from private.announcement_eligible_devices union all select id,account_id from private.android_announcement_eligible_devices)d on d.account_id=a.id');
 elsif position('from private.announcement_eligible_devices group by account_id'in source)>0 then
  source:=replace(source,'from private.announcement_eligible_devices group by account_id','from(select account_id from private.announcement_eligible_devices union all select account_id from private.android_announcement_eligible_devices)registered group by account_id');
 else raise exception 'ANNOUNCEMENT_AUDIENCE_CHANGED';end if;
 execute source;
 source:=pg_get_functiondef('private.announcement_summary(uuid)'::regprocedure);
 execute replace(source,'from private.announcement_deliveries','from private.all_announcement_deliveries');
 source:=pg_get_functiondef('private.admin_push_api(text,jsonb)'::regprocedure);
 source:=replace(source,'FUNCTION private.admin_push_api(','FUNCTION private.admin_push_ios_api(');
 execute replace(source,'from private.announcement_deliveries','from private.all_announcement_deliveries');
end $$;
create or replace function private.admin_push_api(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;cid uuid;
begin
 result:=private.admin_push_ios_api(p_action,p_data);
 if p_action='preview'then
  cid:=(result->'campaign'->>'id')::uuid;
  insert into private.android_announcement_deliveries(campaign_id,target_id,device_id,registration_version,token_hash,recipient_binding,eligibility_epoch)
   select cid,t.id,d.id,d.registration_version,extensions.digest(d.token,'sha256'),d.binding,d.eligibility_epoch
   from private.announcement_targets t join private.android_announcement_eligible_devices d on d.account_id=t.account_id
   where t.campaign_id=cid and t.exclusion is null;
  result:=jsonb_set(result,'{campaign}',private.announcement_summary(cid));
 elsif p_action='cancel'then
  update private.android_announcement_deliveries set state='cancelled',finished_at=clock_timestamp(),last_error='CancelledByAdmin'
   where campaign_id=(p_data->>'campaignId')::uuid and state='pending';
  result:=jsonb_set(result,'{campaign}',private.announcement_summary((p_data->>'campaignId')::uuid));
 end if;
 return result;
end $$;

create function private.android_announcement_delivery_allowed(p_id uuid)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.android_announcement_deliveries j
 join private.announcement_targets t on t.id=j.target_id join private.announcement_campaigns c on c.id=j.campaign_id
 join private.android_announcement_eligible_devices d on d.id=j.device_id and d.account_id=t.account_id
 join private.announcement_preferences pref on pref.account_id=t.account_id
 left join private.customer_push_preferences master on master.account_id=t.account_id
 where j.id=p_id and c.state='queued'and c.expires_at>now()and c.delivery_mode='apns'
 and(select activated_at from private.android_announcement_runtime where singleton)<=c.created_at
 and(select activated_at from private.android_live_push_runtime where singleton)<=c.created_at
 and private.announcement_author_allowed(c.created_by)and j.eligibility_epoch=d.eligibility_epoch and j.registration_version=d.registration_version
 and j.recipient_binding=d.binding and j.token_hash=extensions.digest(d.token,'sha256')
 and pref.enabled_since<=c.created_at
 and coalesce((master.preference_enabled_since->>'enabled')::timestamptz,'-infinity')<=c.created_at);
$$;

do $$ declare source text:=pg_get_functiondef('private.admin_push_worker(text,jsonb)'::regprocedure);begin
 execute replace(source,'FUNCTION private.admin_push_worker(','FUNCTION private.admin_push_ios_worker(');
end $$;
create or replace function private.admin_push_worker(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;extra jsonb;android_config jsonb;j private.android_announcement_deliveries;status integer;reason text;n integer;
begin
 if p_action='configureAndroid'then
  if auth.role()is distinct from'service_role'or jsonb_typeof(p_data->'enabled')is distinct from'boolean'or p_data->>'mode'not in('capture','send')then raise exception 'FORBIDDEN';end if;
  if (p_data->>'enabled')::boolean then
   android_config:=private.android_live_push_dispatch('configuration','{}');
   if p_data->>'mode'<>'send'or android_config->>'apiUrl'<>'https://srv1073968.hstgr.cloud'or android_config->>'projectId'<>'barber-plus-plus-phone-prod'
    or android_config->>'packageName'<>'com.barberplusplus.customer'or android_config->'enabled'is distinct from'true'::jsonb or android_config->>'mode'<>'send'or android_config->'credential'is null then raise exception 'PUSH_NOT_CONFIGURED';end if;
  end if;
  update private.android_announcement_runtime set enabled=(p_data->>'enabled')::boolean,mode=p_data->>'mode',
   activated_at=case when not enabled and(p_data->>'enabled')::boolean or mode is distinct from p_data->>'mode'then clock_timestamp()else activated_at end where singleton;
  return jsonb_build_object('configured',true);
 end if;
 if p_action='configuration'then
  if exists(select 1 from private.android_announcement_runtime where singleton and enabled and mode='send')then
   android_config:=private.android_live_push_dispatch('configuration','{}');
  end if;
  return private.admin_push_ios_worker(p_action,p_data)||jsonb_build_object('androidAnnouncementsEnabled',coalesce((select enabled from private.android_announcement_runtime where singleton),false),'android',android_config);
 end if;
 if p_action='validate'and exists(select 1 from private.android_announcement_deliveries where id=(p_data->>'id')::uuid)then
  return to_jsonb(exists(select 1 from private.android_announcement_deliveries d where d.id=(p_data->>'id')::uuid
   and d.lease_id=(p_data->>'lease')::uuid and d.state='sending'and d.leased_until>now()
   and(select enabled from private.announcement_runtime where singleton)and private.android_announcement_delivery_allowed(d.id)));
 end if;
 if p_action='finish'and exists(select 1 from private.android_announcement_deliveries where id=(p_data->>'id')::uuid)then
  perform 1 from private.announcement_campaigns where id=(select campaign_id from private.android_announcement_deliveries where id=(p_data->>'id')::uuid)for update;
  select * into j from private.android_announcement_deliveries where id=(p_data->>'id')::uuid and lease_id=(p_data->>'lease')::uuid and state='sending'for update;
  if not found then return 'false';end if;
  status:=(p_data->>'status')::integer;reason:=left(coalesce(p_data->>'reason',''),80);
  if reason='NoLongerEligible'then
   update private.android_announcement_deliveries set state='skipped',last_error=reason,finished_at=clock_timestamp(),leased_until=null where id=j.id;
  elsif status=200 then
   update private.android_announcement_deliveries set state=case when j.delivery_mode='capture'then'captured'else'accepted'end,provider_status=status,provider_id=left(p_data->>'providerId',150),finished_at=clock_timestamp(),leased_until=null where id=j.id;
  elsif status in(429,500,503)and j.attempts<3 and not exists(select 1 from private.announcement_campaigns where id=j.campaign_id and state='cancelled')then
   update private.android_announcement_deliveries set state='pending',available_at=now()+make_interval(secs=>30*power(2,j.attempts)::integer),provider_status=status,last_error=reason,leased_until=null where id=j.id;
  else
   update private.android_announcement_deliveries set state=case when status=0 then'unknown'else'failed'end,provider_status=status,last_error=reason,finished_at=clock_timestamp(),leased_until=null where id=j.id;
   if status=410 and reason='Unregistered'then update private.android_live_push_devices set permission=false,token=null,token_hash=null where id=j.device_id and token_hash=j.token_hash;end if;
  end if;
  return 'true';
 end if;
 result:=private.admin_push_ios_worker(p_action,p_data);
 if p_action='claim'then
  update private.android_announcement_deliveries set state='unknown',last_error='LeaseExpired',finished_at=clock_timestamp()where state='sending'and leased_until<now();
  n:=greatest(0,least(coalesce((p_data->>'limit')::integer,20),20)-jsonb_array_length(result));
  with candidates as(select d.id from private.android_announcement_deliveries d join private.announcement_campaigns c on c.id=d.campaign_id
   where c.state='queued'and d.state='pending'and d.available_at<=now()order by d.available_at,d.id for update of d skip locked limit n),
  checked as materialized(select id,private.android_announcement_delivery_allowed(id)allowed from candidates),
  leased as(update private.android_announcement_deliveries d set state=case when c.allowed then'sending'else'skipped'end,
   delivery_mode=(select mode from private.announcement_runtime where singleton),attempts=attempts+case when c.allowed then 1 else 0 end,lease_id=case when c.allowed then gen_random_uuid()else null end,
   leased_until=case when c.allowed then now()+interval '2 minutes'else null end,finished_at=case when c.allowed then null else clock_timestamp()end,
   last_error=case when c.allowed then null else'NoLongerEligible'end from checked c where d.id=c.id returning d.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'lease',l.lease_id,'campaignId',c.id,'recipientBinding',l.recipient_binding,'deliveryMode',l.delivery_mode,
   'client','android','token',d.token,'environment','production','projectId','barber-plus-plus-phone-prod','packageName','com.barberplusplus.customer','language',d.language,
   'titleEn',c.title_en,'bodyEn',c.body_en,'titleAr',c.title_ar,'bodyAr',c.body_ar,'destination',c.destination,'expiresAt',extract(epoch from c.expires_at)::bigint)),'[]')into extra
   from leased l join private.announcement_campaigns c on c.id=l.campaign_id join private.android_live_push_devices d on d.id=l.device_id where l.state='sending';
  return result||extra;
 elsif p_action='continue'and exists(select 1 from private.android_announcement_deliveries d join private.announcement_campaigns c on c.id=d.campaign_id where c.state='queued'and d.state='pending'and d.available_at<=now())then
  perform private.kick_admin_push();
 end if;
 return result;
end $$;

do $$ declare signature text;begin
 foreach signature in array array['private.android_announcement_epoch()','private.android_announcement_api(text,jsonb)','private.customer_announcement_ios_api(text,jsonb)','private.customer_announcement_api(text,jsonb)',
 'private.admin_push_ios_api(text,jsonb)','private.admin_push_api(text,jsonb)','private.android_announcement_delivery_allowed(uuid)','private.admin_push_ios_worker(text,jsonb)','private.admin_push_worker(text,jsonb)']loop
 execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
grant execute on function private.customer_announcement_api(text,jsonb),private.admin_push_api(text,jsonb),private.admin_push_worker(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
