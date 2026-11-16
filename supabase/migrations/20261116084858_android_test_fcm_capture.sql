begin;
-- Additive, task-scoped Android Test transport. No APNs table, credential,
-- dispatcher, cron or existing registration is modified by this migration.
create table private.customer_android_push_runtime(
 singleton boolean primary key default true check(singleton),
 api_url text not null check(api_url='https://qvkucvcjmojjbphlzlks.supabase.co'),
 project_id text not null check(project_id='barber-plus-plus-phone-test'),
 package_name text not null check(package_name='com.barberplusplus.customer.test'),
 allowed jsonb not null check(jsonb_typeof(allowed)='array'and jsonb_array_length(allowed)between 1 and 2),
 mode text not null default'capture'check(mode in('capture','send')),
 registrations integer not null default 0 check(registrations between 0 and 2),
 rotations integer not null default 0 check(rotations between 0 and 1),
 rotation_hash_appends integer not null default 0 check(rotation_hash_appends between 0 and 1),
 preference_writes integer not null default 0 check(preference_writes between 0 and 2),
 detaches integer not null default 0 check(detaches between 0 and 2),
 reserved_attempts integer not null default 0 check(reserved_attempts between 0 and 3),
 real_job_ids uuid[] not null default'{}'check(cardinality(real_job_ids)<=3),
 real_activated_at timestamptz, real_expires_at timestamptz,
 created_at timestamptz not null default clock_timestamp()
);
create table private.customer_android_push_devices(
 id uuid primary key,secret_hash bytea not null,
 account_id uuid not null references auth.users(id)on delete cascade,
 session_id uuid not null references auth.sessions(id)on delete cascade,
 token text,token_hash bytea,registration_version bigint not null check(registration_version>0),
 permission boolean not null default false,language text not null check(language in('en','ar')),
 detached boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(token_hash)
);
create index customer_android_push_account on private.customer_android_push_devices(account_id);
create index customer_android_push_session on private.customer_android_push_devices(session_id);
create table private.customer_android_push_deliveries(
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references private.customer_android_push_devices(id)on delete cascade,
 event_id uuid references private.customer_push_events(id)on delete cascade,
 task_key uuid unique,
 state text not null default'pending'check(state in('pending','sending','captured','sent','failed','cancelled')),
 lease_id uuid,token_hash bytea,actual_attempt_reserved boolean not null default false,
 expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,provider_id text,last_error text,
 check((event_id is null)<>(task_key is null)),unique(event_id,device_id)
);
create index customer_android_push_pending on private.customer_android_push_deliveries(created_at)where state='pending';
do $$declare t text;begin
 foreach t in array array['customer_android_push_runtime','customer_android_push_devices','customer_android_push_deliveries']loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end$$;

create function private.customer_android_push_owner(p_user uuid,p_session uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select public.customer_session_is_live(p_user,p_session)
 and exists(select 1 from auth.users u join private.customer_accounts a on a.user_id=u.id
  join public.customers c on c.id=a.customer_id where u.id=p_user and u.raw_app_meta_data->>'role'='customer'
  and u.email_confirmed_at is not null and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
  and c.status='active'and c.account_deleted_at is null);
$$;
revoke all on function private.customer_android_push_owner(uuid,uuid)from public,anon,authenticated,service_role;

create function private.customer_android_push_allowed(p_job uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select exists(select 1 from private.customer_android_push_deliveries j
 join private.customer_android_push_devices d on d.id=j.device_id
 join private.customer_android_push_runtime runtime on runtime.singleton
 left join private.customer_push_preferences pref on pref.account_id=d.account_id
 left join private.customer_push_events e on e.id=j.event_id
 left join public.bookings b on b.id=e.booking_id
 left join private.customer_push_revisions revision on revision.booking_id=b.id
 where j.id=p_job and j.expires_at>now()and d.permission and not d.detached and d.token is not null
 and private.customer_android_push_owner(d.account_id,d.session_id)
 and exists(select 1 from jsonb_array_elements(runtime.allowed)x where(x->>'deviceId')::uuid=d.id
  and(x->>'accountId')::uuid=d.account_id and x->'tokenHashes'?encode(d.token_hash,'hex'))
 and coalesce(pref.notifications_enabled,true)
 and coalesce(pref.preferences->>case when e.kind='reminder24'then'reminder24'when e.kind='reminder2'then'reminder2'when e.kind='review'then'reviews'else'updates'end,'true')='true'
 and coalesce(e.occurred_at,j.created_at)>=coalesce((pref.preference_enabled_since->>'enabled')::timestamptz,'-infinity')
 and coalesce(e.occurred_at,j.created_at)>=coalesce((pref.preference_enabled_since->>case when e.kind='reminder24'then'reminder24'when e.kind='reminder2'then'reminder2'when e.kind='review'then'reviews'else'updates'end)::timestamptz,'-infinity')
 and(j.task_key is not null or(
  e.expires_at>now()and e.revision=revision.revision and e.created_at>=d.created_at and e.occurred_at>=runtime.created_at
  and exists(select 1 from private.customer_booking_owners o where o.booking_id=b.id and o.account_user_id=d.account_id)
  and(e.kind not in('reminder24','reminder2','confirmed')or(b.status='confirmed'and((b.date+b.time)at time zone'Asia/Kuwait')>now()))
  and(e.kind<>'cancelled'or b.status='cancelled')
  and(e.kind<>'review'or(b.status='completed'and not exists(select 1 from private.customer_booking_ratings rating where rating.booking_id=b.id)))
 )));
$$;
revoke all on function private.customer_android_push_allowed(uuid)from public,anon,authenticated,service_role;

create function public.customer_android_push_api(p_action text,p_data jsonb default'{}')returns jsonb
language plpgsql security definer set search_path=''as $$
declare runtime private.customer_android_push_runtime;d private.customer_android_push_devices;device uuid:=(p_data->>'deviceId')::uuid;
 account uuid:=nullif(p_data->>'user_id','')::uuid;sid uuid:=nullif(p_data->>'session_id','')::uuid;version bigint;entry jsonb;prefs jsonb;saved private.customer_push_preferences;enabled boolean;
begin
 select *into runtime from private.customer_android_push_runtime where singleton for update;
 if runtime.singleton is null then raise exception'PUSH_NOT_CONFIGURED';end if;
 if coalesce(p_data->>'deviceSecret','')!~'^[0-9a-f]{64}$'or device is null then raise exception'INVALID_REQUEST';end if;
 select *into d from private.customer_android_push_devices where id=device for update;
 if d.id is not null and d.secret_hash is distinct from extensions.digest(p_data->>'deviceSecret','sha256')then raise exception'FORBIDDEN';end if;
 if account is not null and not private.customer_android_push_owner(account,sid)then raise exception'AUTH_REQUIRED';end if;
 if p_action='push-register'then
  if account is null then raise exception'AUTH_REQUIRED';end if;
  select x into entry from jsonb_array_elements(runtime.allowed)x where(x->>'deviceId')::uuid=device and(x->>'accountId')::uuid=account;
  if entry is null or not(entry->'tokenHashes'?encode(extensions.digest(p_data->>'token','sha256'),'hex'))then raise exception'FORBIDDEN';end if;
  if p_data->>'projectId' is distinct from runtime.project_id or p_data->>'packageName' is distinct from runtime.package_name
   or coalesce(p_data->>'token','')!~'^[A-Za-z0-9_:-]{20,4096}$'or p_data->>'language'not in('en','ar')
   or jsonb_typeof(p_data->'permission')is distinct from'boolean'then raise exception'INVALID_REQUEST';end if;
  version:=(p_data->>'version')::bigint;if version is null or version<1 then raise exception'INVALID_REQUEST';end if;
  if d.id is not null then
   if d.account_id<>account then raise exception'FORBIDDEN';end if;
   if version<=d.registration_version then return jsonb_build_object('success',true);end if;
   if d.token_hash is distinct from extensions.digest(p_data->>'token','sha256')then
    if runtime.rotations>=1 then raise exception'TEST_BUDGET_EXHAUSTED';end if;
    update private.customer_android_push_runtime set rotations=rotations+1 where singleton;
   end if;
   update private.customer_android_push_devices set token=p_data->>'token',token_hash=extensions.digest(p_data->>'token','sha256'),session_id=sid,
    permission=(p_data->>'permission')::boolean,language=p_data->>'language',registration_version=version,detached=false,updated_at=clock_timestamp()where id=device returning*into d;
  else
   if runtime.registrations>=2 then raise exception'TEST_BUDGET_EXHAUSTED';end if;
   insert into private.customer_android_push_devices(id,secret_hash,account_id,session_id,token,token_hash,registration_version,permission,language)
    values(device,extensions.digest(p_data->>'deviceSecret','sha256'),account,sid,p_data->>'token',extensions.digest(p_data->>'token','sha256'),version,(p_data->>'permission')::boolean,p_data->>'language')returning*into d;
   update private.customer_android_push_runtime set registrations=registrations+1 where singleton;
  end if;
  insert into private.customer_push_preferences(account_id,preferences)values(account,'{"updates":true,"reminder24":true,"reminder2":true,"reviews":true}')on conflict(account_id)do nothing;
 elsif p_action='push-detach'then
  if d.id is null then return jsonb_build_object('success',true);end if;
  version:=(p_data->>'version')::bigint;if version is null or version<1 then raise exception'INVALID_REQUEST';end if;
  if version<=d.registration_version then return jsonb_build_object('success',true);end if;
  if runtime.detaches>=2 then raise exception'TEST_BUDGET_EXHAUSTED';end if;
  update private.customer_android_push_devices set token=null,token_hash=null,permission=false,detached=true,registration_version=version,updated_at=clock_timestamp()where id=device;
  update private.customer_android_push_deliveries set state='cancelled',finished_at=clock_timestamp()where device_id=device and state in('pending','sending');
  update private.customer_android_push_runtime set detaches=detaches+1 where singleton;
  return jsonb_build_object('success',true,'provider','fcm');
 elsif p_action in('push-status','push-preferences')then
  if d.id is null then raise exception'DEVICE_REQUIRED';end if;
  if account is null or account<>d.account_id or sid<>d.session_id then raise exception'AUTH_REQUIRED';end if;
  if p_action='push-preferences'then
   prefs:=p_data->'preferences';
   if jsonb_typeof(prefs)is distinct from'object'or prefs-array['updates','reminder24','reminder2','reviews']<>'{}'::jsonb
    or not(prefs?&array['updates','reminder24','reminder2','reviews'])or exists(select 1 from jsonb_each(prefs)x where jsonb_typeof(x.value)<>'boolean')
    or(p_data?'notificationsEnabled'and jsonb_typeof(p_data->'notificationsEnabled')is distinct from'boolean')then raise exception'INVALID_REQUEST';end if;
   if runtime.preference_writes>=2 then raise exception'TEST_BUDGET_EXHAUSTED';end if;
   select*into saved from private.customer_push_preferences where account_id=account for update;
   enabled:=coalesce((p_data->>'notificationsEnabled')::boolean,saved.notifications_enabled,true);
   update private.customer_push_preferences set preferences=prefs,notifications_enabled=enabled,
    preference_enabled_since=private.customer_push_enabled_since(saved.preferences||jsonb_build_object('enabled',saved.notifications_enabled),prefs||jsonb_build_object('enabled',enabled),saved.preference_enabled_since)
    where account_id=account;
   update private.customer_android_push_runtime set preference_writes=preference_writes+1 where singleton;
  end if;
 else raise exception'INVALID_REQUEST';end if;
 select*into saved from private.customer_push_preferences where account_id=coalesce(account,d.account_id);
 return jsonb_build_object('success',true,'provider','fcm','preferences',saved.preferences,'notificationsEnabled',saved.notifications_enabled);
end$$;
revoke all on function public.customer_android_push_api(text,jsonb)from public,anon,authenticated;
grant execute on function public.customer_android_push_api(text,jsonb)to service_role;

create function public.customer_android_push_dispatch(p_action text,p_data jsonb default'{}')returns jsonb
language plpgsql security definer set search_path=''as $$
declare runtime private.customer_android_push_runtime;j private.customer_android_push_deliveries;d private.customer_android_push_devices;
 candidate_allowed jsonb:=p_data->'allowed';entry jsonb;credential jsonb;existing uuid;ids uuid[];until_at timestamptz;result jsonb:='[]';item jsonb;job_id uuid;count_limit integer;
begin
 select*into runtime from private.customer_android_push_runtime where singleton for update;
 if p_action='configure'then
  if jsonb_typeof(candidate_allowed)is distinct from'array'or jsonb_array_length(candidate_allowed)not between 1 and 2 then raise exception'INVALID_REQUEST';end if;
  if(select count(distinct x->>'deviceId')from jsonb_array_elements(candidate_allowed)x)<>jsonb_array_length(candidate_allowed)
   or(select count(distinct x->>'accountId')from jsonb_array_elements(candidate_allowed)x)<>jsonb_array_length(candidate_allowed)
   or(select sum(jsonb_array_length(x->'tokenHashes'))from jsonb_array_elements(candidate_allowed)x)>3 then raise exception'INVALID_REQUEST';end if;
  for entry in select*from jsonb_array_elements(candidate_allowed)loop
   if entry-array['deviceId','accountId','tokenHashes']<>'{}'::jsonb or not(entry?&array['deviceId','accountId','tokenHashes'])
    or jsonb_typeof(entry->'tokenHashes')is distinct from'array'or jsonb_array_length(entry->'tokenHashes')<>1
    or exists(select 1 from jsonb_array_elements_text(entry->'tokenHashes')h where h!~'^[0-9a-f]{64}$')
    or not exists(select 1 from auth.users u join private.customer_accounts a on a.user_id=u.id join public.customers c on c.id=a.customer_id
     where u.id=(entry->>'accountId')::uuid and u.raw_app_meta_data->>'role'='customer'and u.email_confirmed_at is not null and u.deleted_at is null
     and(u.banned_until is null or u.banned_until<=now())and c.status='active'and c.account_deleted_at is null)
    or(entry->>'deviceId')::uuid is null then raise exception'INVALID_REQUEST';end if;
  end loop;
  if runtime.real_activated_at is not null or(runtime.singleton is not null and runtime.allowed is distinct from candidate_allowed and runtime.registrations>0)then raise exception'TEST_RUNTIME_LOCKED';end if;
  insert into private.customer_android_push_runtime(singleton,api_url,project_id,package_name,allowed)
   values(true,'https://qvkucvcjmojjbphlzlks.supabase.co','barber-plus-plus-phone-test','com.barberplusplus.customer.test',candidate_allowed)
   on conflict(singleton)do update set allowed=excluded.allowed;
  return jsonb_build_object('success',true,'mode',coalesce(runtime.mode,'capture'));
 end if;
 if p_action='credential'then
  credential:=p_data->'credential';
  if jsonb_typeof(credential)is distinct from'object'or credential->>'type'is distinct from'service_account'
   or credential->>'project_id'is distinct from'barber-plus-plus-phone-test'
   or credential->>'client_email'is distinct from'barber-android-test-sender@barber-plus-plus-phone-test.iam.gserviceaccount.com'
   or coalesce(credential->>'private_key_id','')!~'^[0-9a-f]{40}$'
   or coalesce(credential->>'private_key','')not like'-----BEGIN PRIVATE KEY-----%'
   or credential->>'token_uri'is distinct from'https://oauth2.googleapis.com/token'then raise exception'INVALID_REQUEST';end if;
  select id into existing from vault.secrets where name='customer_android_fcm';
  if existing is not null then
   if not exists(select 1 from vault.decrypted_secrets where id=existing and decrypted_secret::jsonb=credential)then raise exception'FCM_CREDENTIAL_ALREADY_CONFIGURED';end if;
  else perform vault.create_secret(credential::text,'customer_android_fcm','Android Test send-only FCM credential; manager owns rotation');end if;
  return jsonb_build_object('success',true);
 end if;
 if runtime.singleton is null then raise exception'PUSH_NOT_CONFIGURED';end if;
 if p_action='append-rotation-hash'then
  select*into d from private.customer_android_push_devices where id=(p_data->>'deviceId')::uuid for update;
  if d.id is null or d.account_id is distinct from nullif(p_data->>'accountId','')::uuid
   or d.registration_version is distinct from(p_data->>'expectedVersion')::bigint
   or d.token_hash is distinct from decode(p_data->>'expectedTokenHash','hex')
   or not private.customer_android_push_owner(d.account_id,d.session_id)then raise exception'INVALID_REQUEST';end if;
  if runtime.rotation_hash_appends>=1 or runtime.rotations>=1 then raise exception'TEST_BUDGET_EXHAUSTED';end if;
  if coalesce(p_data->>'newTokenHash','')!~'^[0-9a-f]{64}$'
   or exists(select 1 from jsonb_array_elements(runtime.allowed)x where x->'tokenHashes'?(p_data->>'newTokenHash'))
   or(select sum(jsonb_array_length(x->'tokenHashes'))from jsonb_array_elements(runtime.allowed)x)>=3 then raise exception'INVALID_REQUEST';end if;
  update private.customer_android_push_runtime set allowed=(select jsonb_agg(case when(x->>'deviceId')::uuid=d.id and(x->>'accountId')::uuid=d.account_id
   then jsonb_set(x,'{tokenHashes}',(x->'tokenHashes')||jsonb_build_array(p_data->>'newTokenHash'))else x end order by ord)
   from jsonb_array_elements(runtime.allowed)with ordinality x(x,ord)),rotation_hash_appends=rotation_hash_appends+1 where singleton;
  return jsonb_build_object('success',true);
 elsif p_action='configuration'then
  return jsonb_build_object('apiUrl',runtime.api_url,'projectId',runtime.project_id,'packageName',runtime.package_name,
   'mode',runtime.mode,'expiresAt',runtime.real_expires_at,'reservedAttempts',runtime.reserved_attempts,
   'credential',(select decrypted_secret::jsonb from vault.decrypted_secrets where name='customer_android_fcm'));
 elsif p_action='status'then
  return jsonb_build_object('mode',runtime.mode,'registrations',runtime.registrations,'rotations',runtime.rotations,
   'rotationHashAppends',runtime.rotation_hash_appends,'preferenceWrites',runtime.preference_writes,'detaches',runtime.detaches,'reservedAttempts',runtime.reserved_attempts,
   'realExpiresAt',runtime.real_expires_at,'states',(select coalesce(jsonb_object_agg(state,total),'{}')from(select state,count(*)total from private.customer_android_push_deliveries group by state)x));
 elsif p_action='enqueue-test'then
  select*into d from private.customer_android_push_devices where id=(p_data->>'deviceId')::uuid;
  if d.id is null or not private.customer_android_push_owner(d.account_id,d.session_id)then raise exception'AUTH_REQUIRED';end if;
  if nullif(p_data->>'taskKey','')::uuid is null then raise exception'INVALID_REQUEST';end if;
  insert into private.customer_android_push_deliveries(device_id,task_key,expires_at)
   values(d.id,(p_data->>'taskKey')::uuid,clock_timestamp()+interval'15 minutes')returning id into job_id;
  if not private.customer_android_push_allowed(job_id)then raise exception'FORBIDDEN';end if;
  return jsonb_build_object('id',job_id);
 elsif p_action='activate-real'then
  if runtime.real_activated_at is not null or runtime.reserved_attempts<>0 then raise exception'TEST_BUDGET_EXHAUSTED';end if;
  ids:=array(select jsonb_array_elements_text(p_data->'jobIds')::uuid);until_at:=(p_data->>'expiresAt')::timestamptz;
  if coalesce(cardinality(ids),0)not between 1 and 3 or cardinality(ids)<>(select count(distinct id)from unnest(ids)id)
   or until_at is null or until_at<=clock_timestamp()or until_at>clock_timestamp()+interval'30 minutes'
   or not exists(select 1 from vault.secrets where name='customer_android_fcm')
   or(select count(*)from private.customer_android_push_deliveries where id=any(ids)and state='pending'and private.customer_android_push_allowed(id))<>cardinality(ids)then raise exception'INVALID_REQUEST';end if;
  update private.customer_android_push_runtime set mode='send',real_job_ids=ids,real_activated_at=clock_timestamp(),real_expires_at=until_at where singleton;
  return jsonb_build_object('success',true,'maximumReservedAttempts',3,'expiresAt',until_at);
 elsif p_action='capture'then
  update private.customer_android_push_runtime set mode='capture'where singleton;
  return jsonb_build_object('success',true);
 elsif p_action='claim'then
  -- Only newly committed events after device registration. A captured event is
  -- terminal, never recreated merely to obtain a real test delivery.
  insert into private.customer_android_push_deliveries(device_id,event_id,expires_at)
   select d.id,e.id,e.expires_at from private.customer_push_events e
   join private.customer_booking_owners o on o.booking_id=e.booking_id
   join private.customer_android_push_devices d on d.account_id=o.account_user_id
   where e.expires_at>clock_timestamp()and e.created_at>=d.created_at and e.occurred_at>=runtime.created_at
   on conflict(event_id,device_id)do nothing;
  update private.customer_android_push_deliveries set state='cancelled',finished_at=clock_timestamp()
   where state='pending'and not private.customer_android_push_allowed(id);
  count_limit:=case when runtime.mode='capture'then 3 else greatest(0,3-runtime.reserved_attempts)end;
  if runtime.mode='send'and(runtime.real_expires_at is null or runtime.real_expires_at<=clock_timestamp())then count_limit:=0;end if;
  for j in select*from private.customer_android_push_deliveries where state='pending'and(runtime.mode='capture'or id=any(runtime.real_job_ids))
   order by created_at,id for update skip locked limit count_limit loop
   update private.customer_android_push_deliveries set state='sending',lease_id=gen_random_uuid(),
    actual_attempt_reserved=runtime.mode='send',token_hash=(select token_hash from private.customer_android_push_devices where id=j.device_id)
    where id=j.id returning*into j;
   if runtime.mode='send'then update private.customer_android_push_runtime set reserved_attempts=reserved_attempts+1 where singleton;end if;
   select*into d from private.customer_android_push_devices where id=j.device_id;
   item:=jsonb_build_object('id',j.id,'lease',j.lease_id,'mode',runtime.mode,'token',d.token,'packageName',runtime.package_name,
    'projectId',runtime.project_id,'language',d.language,'expiresAt',extract(epoch from j.expires_at)::bigint,'kind','test');
   if j.event_id is not null then
    item:=item||(select jsonb_build_object('kind',e.kind,'eventId',e.id,'actor',e.actor,'bookingId',b.id,'date',b.date,'time',to_char(b.time,'HH24:MI'),
     'cancellationReason',case when e.kind='cancelled'and e.actor<>'customer'then nullif(btrim(b.staff_cancellation->>'reason'),'')end,
     'shop',s.name,'shopAr',s.name_ar,'barber',r.name,'barberAr',r.name_ar)
     from private.customer_push_events e join public.bookings b on b.id=e.booking_id join public.branches s on s.id=b.branch_id join public.barbers r on r.id=b.barber_id where e.id=j.event_id);
   end if;
   result:=result||jsonb_build_array(item);
  end loop;
  return result;
 elsif p_action='validate'then
  select*into j from private.customer_android_push_deliveries where id=(p_data->>'id')::uuid;
  return to_jsonb(coalesce(j.state='sending'and j.lease_id=(p_data->>'lease')::uuid and j.created_at>clock_timestamp()-interval'30 minutes'
   and private.customer_android_push_allowed(j.id)and j.token_hash=(select token_hash from private.customer_android_push_devices where id=j.device_id)
   and(not j.actual_attempt_reserved or(runtime.mode='send'and runtime.real_expires_at>clock_timestamp()and j.id=any(runtime.real_job_ids))),false));
 elsif p_action='finish'then
  select*into j from private.customer_android_push_deliveries where id=(p_data->>'id')::uuid and lease_id=(p_data->>'lease')::uuid for update;
  if j.id is null or j.state<>'sending'then return'false';end if;
  if coalesce(p_data->>'outcome','')not in('captured','sent','invalid-token','uncertain','failed','cancelled')then raise exception'INVALID_REQUEST';end if;
  if p_data->>'outcome'='sent'and not j.actual_attempt_reserved then raise exception'INVALID_REQUEST';end if;
  if p_data->>'outcome'='invalid-token'then
   update private.customer_android_push_devices set token=null,token_hash=null,permission=false where id=j.device_id and token_hash=j.token_hash;
  end if;
  update private.customer_android_push_deliveries set state=case when p_data->>'outcome'='captured'then'captured'when p_data->>'outcome'='sent'then'sent'when p_data->>'outcome'='cancelled'then'cancelled'else'failed'end,
   finished_at=clock_timestamp(),provider_id=case when p_data->>'outcome'='captured'then'captured-'||j.id::text else left(p_data->>'providerId',150)end,
   last_error=case when p_data->>'outcome'in('sent','captured')then null else p_data->>'outcome'end where id=j.id;
  return'true';
 end if;
 raise exception'INVALID_REQUEST';
end$$;
revoke all on function public.customer_android_push_dispatch(text,jsonb)from public,anon,authenticated;
grant execute on function public.customer_android_push_dispatch(text,jsonb)to service_role;
commit;
