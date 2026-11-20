-- General signed-in Android transport. Independent of APNs and the bounded
-- two-device Test experiment. All activation defaults OFF; no key/cron/backfill.
begin;
create table private.android_live_push_runtime(
 singleton boolean primary key default true check(singleton),
 environment text not null default 'production',api_url text not null default 'https://srv1073968.hstgr.cloud',
 project_id text not null default 'barber-plus-plus-phone-prod',package_name text not null default 'com.barberplusplus.customer',
 sender_email text,registration_enabled boolean not null default false,delivery_enabled boolean not null default false,
 mode text not null default 'capture'check(mode in('capture','send')),
 activated_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((environment='production'and api_url='https://srv1073968.hstgr.cloud'and project_id='barber-plus-plus-phone-prod'and package_name='com.barberplusplus.customer')
 or(environment='cloud-test'and api_url='https://qvkucvcjmojjbphlzlks.supabase.co'and project_id='barber-plus-plus-phone-test'and package_name='com.barberplusplus.customer.test')),
 check(sender_email is null or sender_email~'^[a-z0-9][a-z0-9-]{4,62}@'and split_part(sender_email,'@',2)=project_id||'.iam.gserviceaccount.com')
);
insert into private.android_live_push_runtime(singleton)values(true);
create table private.android_live_push_devices(
 id uuid primary key,secret_hash bytea not null,account_id uuid not null references auth.users(id)on delete cascade,
 session_id uuid references auth.sessions(id)on delete set null,
 token text check(length(token)<=4096),token_hash bytea unique,registration_version bigint not null check(registration_version between 1 and 9007199254740991),
 registration_hash bytea not null,permission boolean not null default false,language text not null check(language in('en','ar')),
 detached boolean not null default false,registered_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create index android_live_push_owner on private.android_live_push_devices(account_id);
create index android_live_push_session on private.android_live_push_devices(session_id);
-- Minimal closed installation marker: no user/session identity or raw token.
create table private.android_live_push_closed(
 device_hash bytea primary key,secret_hash bytea not null,last_version bigint not null,closed_at timestamptz not null default clock_timestamp()
);
create table private.android_live_push_deliveries(
 id uuid primary key default gen_random_uuid(),event_id uuid not null references private.customer_push_events(id)on delete cascade,
 device_id uuid not null references private.android_live_push_devices(id)on delete cascade,
 state text not null default'pending'check(state in('pending','sending','sent','failed','cancelled','captured','uncertain')),
 attempts integer not null default 0 check(attempts between 0 and 6),available_at timestamptz not null default clock_timestamp(),
 lease_id uuid,leased_until timestamptz,token_hash bytea,registration_version bigint,
 provider_id text,last_error text,finished_at timestamptz,created_at timestamptz not null default clock_timestamp(),unique(event_id,device_id)
);
create index android_live_push_due on private.android_live_push_deliveries(available_at,id)where state in('pending','sending');
create index android_live_push_delivery_device on private.android_live_push_deliveries(device_id);
do $$declare t text;begin
 foreach t in array array['android_live_push_runtime','android_live_push_devices','android_live_push_closed','android_live_push_deliveries']loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end$$;
create function private.android_live_push_bound(r private.android_live_push_runtime)returns boolean language sql stable set search_path=''as $$
 select exists(select 1 from private.customer_push_runtime trusted where trusted.singleton and trusted.api_url=r.api_url)
$$;
create function private.android_live_push_owner(person uuid,session uuid)returns boolean language sql stable set search_path=''as $$
 select public.customer_session_is_live(person,session)and exists(select 1 from auth.users u
 join private.customer_accounts a on a.user_id=u.id join public.customers c on c.id=a.customer_id
 where u.id=person and u.raw_app_meta_data->>'role'in('customer','manager','barber')and u.email_confirmed_at is not null
 and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())and c.status='active'and c.account_deleted_at is null)
$$;
create function private.android_live_push_retire()returns trigger language plpgsql security definer set search_path=''as $$
declare affected uuid[];
begin
 if tg_table_name='android_live_push_devices'then
  insert into private.android_live_push_closed(device_hash,secret_hash,last_version)values(extensions.digest(old.id::text,'sha256'),old.secret_hash,old.registration_version)
   on conflict(device_hash)do update set last_version=greatest(android_live_push_closed.last_version,excluded.last_version);
 else
  with retired as(update private.android_live_push_devices set session_id=null,token=null,token_hash=null,permission=false,detached=true,updated_at=clock_timestamp()where session_id=old.id returning id)select array_agg(id)into affected from retired;
  update private.android_live_push_deliveries j set state='cancelled',finished_at=clock_timestamp()
   where j.state in('pending','sending')and j.device_id=any(affected);
 end if;
 return old;
end$$;
create trigger android_live_push_retire before delete on private.android_live_push_devices for each row execute function private.android_live_push_retire();
create trigger android_live_push_session_retire before delete on auth.sessions for each row execute function private.android_live_push_retire();

create function private.android_live_push_allowed(p_job uuid)returns boolean language sql stable set search_path=''as $$
 select exists(select 1 from private.android_live_push_deliveries j join private.android_live_push_devices d on d.id=j.device_id
 join private.customer_push_events e on e.id=j.event_id join public.bookings b on b.id=e.booking_id
 join private.customer_push_revisions revision on revision.booking_id=b.id and revision.revision=e.revision
 join private.android_live_push_runtime r on r.singleton
 join private.customer_booking_owners o on o.booking_id=b.id and o.account_user_id=d.account_id
 left join private.customer_push_preferences pref on pref.account_id=d.account_id
 where j.id=p_job and private.android_live_push_bound(r)and r.delivery_enabled and e.expires_at>now()
 and d.permission and not d.detached and d.token is not null and d.updated_at>now()-interval'90 days'
 and private.android_live_push_owner(d.account_id,d.session_id)
 and e.created_at>=d.registered_at and e.occurred_at>=greatest(d.registered_at,r.activated_at)
 and coalesce(pref.notifications_enabled,true)
 and coalesce(pref.preferences->>case e.kind when'reminder24'then'reminder24'when'reminder2'then'reminder2'when'review'then'reviews'else'updates'end,'true')='true'
 and e.occurred_at>=coalesce((pref.preference_enabled_since->>'enabled')::timestamptz,'-infinity')
 and e.occurred_at>=coalesce((pref.preference_enabled_since->>case e.kind when'reminder24'then'reminder24'when'reminder2'then'reminder2'when'review'then'reviews'else'updates'end)::timestamptz,'-infinity')
 and(e.kind not in('confirmed','reminder24','reminder2')or(b.status='confirmed'and((b.date+b.time)at time zone'Asia/Kuwait')>now()))
 and(e.kind<>'cancelled'or b.status='cancelled')
 and(e.kind<>'review'or(b.status='completed'and not exists(select 1 from private.customer_booking_ratings rating where rating.booking_id=b.id))))
$$;

create function private.android_live_push_api(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path=''set statement_timeout='15s'as $$
#variable_conflict use_variable
declare r private.android_live_push_runtime;d private.android_live_push_devices;closed private.android_live_push_closed;
 device uuid:=(p_data->>'deviceId')::uuid;person uuid:=nullif(p_data->>'user_id','')::uuid;sid uuid:=nullif(p_data->>'session_id','')::uuid;
 version bigint;intent bytea;prefs jsonb;enabled boolean;saved private.customer_push_preferences;next_token bytea;
begin
 if auth.role()is distinct from'service_role'then raise exception'FORBIDDEN';end if;
 if jsonb_typeof(p_data)is distinct from'object'or octet_length(p_data::text)>16384 or device is null or coalesce(p_data->>'deviceSecret','')!~'^[0-9a-f]{64}$'then raise exception'INVALID_REQUEST';end if;
 if p_action is null or p_action not in('push-register','push-detach','push-status','push-preferences')then raise exception'INVALID_REQUEST';end if;
 select*into r from private.android_live_push_runtime where singleton;
 if r.singleton is null or not private.android_live_push_bound(r)then raise exception'PUSH_NOT_CONFIGURED';end if;
 if person is not null and not private.android_live_push_owner(person,sid)then raise exception'AUTH_REQUIRED';end if;
 if p_action in('push-register','push-detach')then
  if jsonb_typeof(p_data->'version')is distinct from'number'or coalesce(p_data->>'version','')!~'^[0-9]{1,16}$'then raise exception'INVALID_REQUEST';end if;
  version:=(p_data->>'version')::bigint;
  if version not between 1 and 9007199254740991 then raise exception'INVALID_REQUEST';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(device::text,821));
 select*into closed from private.android_live_push_closed where device_hash=extensions.digest(device::text,'sha256');
 if closed.device_hash is not null then
  if closed.secret_hash is distinct from extensions.digest(p_data->>'deviceSecret','sha256')then raise exception'FORBIDDEN';end if;
  if p_action='push-detach'then return jsonb_build_object('success',true,'provider','fcm');end if;
  raise exception'DEVICE_REQUIRED';
 end if;
 select*into d from private.android_live_push_devices where id=device for update;
 if d.id is not null and d.secret_hash is distinct from extensions.digest(p_data->>'deviceSecret','sha256')then raise exception'FORBIDDEN';end if;
 if person is not null and d.id is not null and person<>d.account_id then raise exception'FORBIDDEN';end if;
 if p_action='push-register'then
  if not r.registration_enabled then raise exception'PUSH_NOT_CONFIGURED';end if;
  if person is null then raise exception'AUTH_REQUIRED';end if;
  if p_data->>'projectId'is distinct from r.project_id or p_data->>'packageName'is distinct from r.package_name
   or coalesce(p_data->>'token','')!~'^[A-Za-z0-9_:-]{20,4096}$'or coalesce(p_data->>'language','')not in('en','ar')
   or jsonb_typeof(p_data->'permission')is distinct from'boolean'then raise exception'INVALID_REQUEST';end if;
 end if;
 if p_action in('push-register','push-detach')then
  intent:=extensions.digest((p_data-array['user_id','session_id'])::text||p_action,'sha256');
  if d.id is not null and version=d.registration_version and intent is distinct from d.registration_hash then raise exception'INVALID_REQUEST';end if;
  if d.id is not null and version<=d.registration_version then
   return jsonb_build_object('success',true,'provider','fcm','preferences',coalesce((select preferences from private.customer_push_preferences where account_id=d.account_id),'{}'),'notificationsEnabled',coalesce((select notifications_enabled from private.customer_push_preferences where account_id=d.account_id),true));
  end if;
 end if;
 if p_action='push-register'then
  next_token:=extensions.digest(p_data->>'token','sha256');
  perform pg_advisory_xact_lock(hashtextextended(encode(next_token,'hex'),822));
  -- A reinstallation/new account receiving the same FCM token retires its old
  -- binding without transferring that account's installation capability.
  update private.android_live_push_devices set token=null,token_hash=null,permission=false,detached=true,updated_at=clock_timestamp()where token_hash=next_token and id<>device;
  if d.id is null then
   insert into private.android_live_push_devices(id,secret_hash,account_id,session_id,token,token_hash,registration_version,registration_hash,permission,language)
   values(device,extensions.digest(p_data->>'deviceSecret','sha256'),person,sid,p_data->>'token',next_token,version,intent,(p_data->>'permission')::boolean,p_data->>'language')returning*into d;
  else
   update private.android_live_push_devices set session_id=sid,token=p_data->>'token',token_hash=next_token,registration_version=version,registration_hash=intent,
    registered_at=case when detached or not permission and(p_data->>'permission')::boolean or session_id is distinct from sid then clock_timestamp()else registered_at end,
    permission=(p_data->>'permission')::boolean,language=p_data->>'language',detached=false,updated_at=clock_timestamp()where id=device returning*into d;
  end if;
  insert into private.customer_push_preferences(account_id)values(person)on conflict(account_id)do nothing;
 elsif p_action='push-detach'then
  if d.id is null then
   insert into private.android_live_push_closed(device_hash,secret_hash,last_version)values(extensions.digest(device::text,'sha256'),extensions.digest(p_data->>'deviceSecret','sha256'),version);
  else
   update private.android_live_push_devices set session_id=null,token=null,token_hash=null,permission=false,detached=true,registration_version=version,registration_hash=intent,updated_at=clock_timestamp()where id=device;
   update private.android_live_push_deliveries set state='cancelled',finished_at=clock_timestamp()where device_id=device and state in('pending','sending');
  end if;
  return jsonb_build_object('success',true,'provider','fcm');
 else
  if d.id is null then raise exception'DEVICE_REQUIRED';end if;
  if person is null or person<>d.account_id or sid is distinct from d.session_id then raise exception'AUTH_REQUIRED';end if;
  if p_action='push-preferences'then
   prefs:=p_data->'preferences';
   if jsonb_typeof(prefs)is distinct from'object'or prefs-array['updates','reminder24','reminder2','reviews']<>'{}'
    or not(prefs?&array['updates','reminder24','reminder2','reviews'])or exists(select 1 from jsonb_each(prefs)x where jsonb_typeof(x.value)<>'boolean')
    or jsonb_typeof(p_data->'notificationsEnabled')is distinct from'boolean'then raise exception'INVALID_REQUEST';end if;
   select*into saved from private.customer_push_preferences where account_id=person for update;
   enabled:=(p_data->>'notificationsEnabled')::boolean;
   insert into private.customer_push_preferences(account_id,preferences,notifications_enabled,preference_enabled_since)
   values(person,prefs,enabled,private.customer_push_enabled_since(coalesce(saved.preferences,'{}')||jsonb_build_object('enabled',coalesce(saved.notifications_enabled,true)),prefs||jsonb_build_object('enabled',enabled),coalesce(saved.preference_enabled_since,'{}')))
   on conflict(account_id)do update set preferences=excluded.preferences,notifications_enabled=excluded.notifications_enabled,preference_enabled_since=excluded.preference_enabled_since;
  end if;
 end if;
 return jsonb_build_object('success',true,'provider','fcm','preferences',(select preferences from private.customer_push_preferences where account_id=d.account_id),
  'notificationsEnabled',(select notifications_enabled from private.customer_push_preferences where account_id=d.account_id));
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then raise exception'INVALID_REQUEST';
end$$;

create function private.android_live_push_configure(p_data jsonb)returns boolean
language plpgsql security definer set search_path=''as $$
declare r private.android_live_push_runtime;credential jsonb;
begin
 if auth.role()is distinct from'service_role'then raise exception'FORBIDDEN';end if;
 select*into r from private.android_live_push_runtime where singleton for update;
 if p_data->>'apiUrl'is distinct from r.api_url or p_data->>'projectId'is distinct from r.project_id or p_data->>'packageName'is distinct from r.package_name
  or not private.android_live_push_bound(r)or jsonb_typeof(p_data->'registrationEnabled')is distinct from'boolean'
  or jsonb_typeof(p_data->'deliveryEnabled')is distinct from'boolean'or coalesce(p_data->>'mode','')not in('capture','send')then raise exception'INVALID_REQUEST';end if;
 if(p_data->>'deliveryEnabled')::boolean and p_data->>'mode'='send'then
  select decrypted_secret::jsonb into credential from vault.decrypted_secrets where name='customer_android_live_fcm';
  if credential is null or credential->>'type'is distinct from'service_account'or credential->>'project_id'is distinct from r.project_id
   or credential->>'client_email'is distinct from p_data->>'senderEmail'or coalesce(credential->>'private_key_id','')!~'^[0-9a-f]{40}$'
   or coalesce(credential->>'private_key','')not like'-----BEGIN PRIVATE KEY-----%'or credential->>'token_uri'is distinct from'https://oauth2.googleapis.com/token'then raise exception'PUSH_NOT_CONFIGURED';end if;
 end if;
 update private.android_live_push_runtime set registration_enabled=(p_data->>'registrationEnabled')::boolean,delivery_enabled=(p_data->>'deliveryEnabled')::boolean,
  sender_email=nullif(p_data->>'senderEmail',''),mode=p_data->>'mode',updated_at=clock_timestamp(),
  activated_at=case when not delivery_enabled and(p_data->>'deliveryEnabled')::boolean or mode is distinct from p_data->>'mode'then clock_timestamp()else activated_at end where singleton;
 return true;
end$$;

create function private.android_live_push_dispatch(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path=''set statement_timeout='20s'as $$
#variable_conflict use_variable
declare r private.android_live_push_runtime;j private.android_live_push_deliveries;d private.android_live_push_devices;
 scheduled private.customer_push_schedules;result jsonb:='[]';item jsonb;outcome text:=p_data->>'outcome';delay integer;
begin
 if auth.role()is distinct from'service_role'then raise exception'FORBIDDEN';end if;
 if p_action='authorize'then return'true';end if;
 select*into r from private.android_live_push_runtime where singleton;
 if r.singleton is null or not private.android_live_push_bound(r)then raise exception'PUSH_NOT_CONFIGURED';end if;
 if p_action='configuration'then return jsonb_build_object('apiUrl',r.api_url,'projectId',r.project_id,'packageName',r.package_name,
  'senderEmail',r.sender_email,'enabled',r.delivery_enabled,'mode',r.mode,
  'credential',case when r.delivery_enabled and r.mode='send'then(select decrypted_secret::jsonb from vault.decrypted_secrets where name='customer_android_live_fcm')else null end);end if;
 if p_action='claim'then
  if not r.delivery_enabled then return'[]';end if;
  -- Same already-approved due/expiry/revision/dedupe semantics as the existing
  -- iOS materializer. Only schedules with a registered Android recipient are
  -- considered; shared row locks/dedupe ensure either provider can materialize
  -- the event once, without claiming or modifying any APNs delivery.
  for scheduled in select s.*from private.customer_push_schedules s where not s.consumed and s.due_at<=now()
   and exists(select 1 from private.customer_booking_owners o join private.android_live_push_devices d on d.account_id=o.account_user_id
    where o.booking_id=s.booking_id and d.permission and not d.detached and d.token is not null and s.due_at>=greatest(d.registered_at,r.activated_at)
    and private.android_live_push_owner(d.account_id,d.session_id))order by s.due_at for update of s skip locked limit 100 loop
   if scheduled.expires_at>now()then insert into private.customer_push_events(booking_id,revision,kind,dedupe_key,expires_at,occurred_at)
    values(scheduled.booking_id,scheduled.revision,scheduled.kind,'schedule:'||scheduled.id,scheduled.expires_at,scheduled.due_at)on conflict(dedupe_key)do nothing;end if;
   update private.customer_push_schedules set consumed=true where id=scheduled.id;
  end loop;
  update private.android_live_push_devices set token=null,token_hash=null,permission=false,detached=true where not detached and updated_at<now()-interval'90 days';
  delete from private.android_live_push_deliveries where finished_at<now()-interval'7 days';
  insert into private.android_live_push_deliveries(event_id,device_id)
   select e.id,d.id from private.customer_push_events e join private.customer_booking_owners o on o.booking_id=e.booking_id
   join private.android_live_push_devices d on d.account_id=o.account_user_id
   where e.expires_at>now()and e.created_at>=d.registered_at and e.occurred_at>=greatest(d.registered_at,r.activated_at)
   on conflict(event_id,device_id)do nothing;
  update private.android_live_push_deliveries set state='cancelled',finished_at=clock_timestamp()where state in('pending','sending')and not private.android_live_push_allowed(id);
  -- A lost acknowledgment/expired lease may already have reached Google. Never
  -- automatically replay that uncertain send as if it were rejected.
  update private.android_live_push_deliveries set state='uncertain',last_error='LeaseExpired',finished_at=clock_timestamp()where state='sending'and leased_until<now();
  for j in select*from private.android_live_push_deliveries where state='pending'and available_at<=now()and attempts<6
   order by available_at,id for update skip locked limit 20 loop
   select*into d from private.android_live_push_devices where id=j.device_id;
   update private.android_live_push_deliveries set state='sending',attempts=attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval'2 minutes',token_hash=d.token_hash,registration_version=d.registration_version where id=j.id returning*into j;
   item:=(select jsonb_build_object('id',j.id,'lease',j.lease_id,'mode',r.mode,'token',d.token,'projectId',r.project_id,'packageName',r.package_name,
    'environment',r.environment,'language',d.language,'expiresAt',extract(epoch from e.expires_at)::bigint,'kind',e.kind,'eventId',e.id,'actor',e.actor,'bookingId',b.id,'date',b.date,'time',to_char(b.time,'HH24:MI'),
    'cancellationReason',case when e.kind='cancelled'and e.actor<>'customer'then nullif(btrim(b.staff_cancellation->>'reason'),'')end,
    'shop',s.name,'shopAr',s.name_ar,'barber',barber.name,'barberAr',barber.name_ar)
    from private.customer_push_events e join public.bookings b on b.id=e.booking_id join public.branches s on s.id=b.branch_id join public.barbers barber on barber.id=b.barber_id where e.id=j.event_id);
   result:=result||jsonb_build_array(item);
  end loop;
  return result;
 elsif p_action='validate'then
  select*into j from private.android_live_push_deliveries where id=(p_data->>'id')::uuid;
  return to_jsonb(coalesce(j.state='sending'and j.lease_id=(p_data->>'lease')::uuid and j.leased_until>now()and private.android_live_push_allowed(j.id)
   and exists(select 1 from private.android_live_push_devices where id=j.device_id and token_hash=j.token_hash and registration_version=j.registration_version),false));
 elsif p_action='finish'then
  select*into j from private.android_live_push_deliveries where id=(p_data->>'id')::uuid and lease_id=(p_data->>'lease')::uuid for update;
  if j.id is null or j.state<>'sending'then return'false';end if;
  if outcome is null or outcome not in('sent','captured','cancelled','invalid-token','failed','uncertain','retryable')then raise exception'INVALID_REQUEST';end if;
  if outcome='invalid-token'then update private.android_live_push_devices set token=null,token_hash=null,permission=false,detached=true
   where id=j.device_id and token_hash=j.token_hash and registration_version=j.registration_version;end if;
  if outcome='retryable'and j.attempts<6 and private.android_live_push_allowed(j.id)then
   -- Match the existing delivery retry schedule; honor a later provider retry
   -- instruction without manufacturing another notification/event.
   delay:=greatest(least(3600,15*power(2,j.attempts)::integer),greatest(0,least(86400,coalesce((p_data->>'retryAfterSeconds')::integer,0))));
   update private.android_live_push_deliveries set state='pending',available_at=now()+make_interval(secs=>delay),lease_id=null,leased_until=null,last_error='ProviderRetryable'where id=j.id;
  else
   update private.android_live_push_deliveries set state=case when outcome in('sent','captured','cancelled','uncertain')then outcome else'failed'end,
    finished_at=clock_timestamp(),leased_until=null,provider_id=case when outcome='sent'then left(p_data->>'providerId',150)end,last_error=case when outcome in('sent','captured')then null else outcome end where id=j.id;
  end if;
  return'true';
 end if;
 raise exception'INVALID_REQUEST';
end$$;

revoke all on function private.android_live_push_bound(private.android_live_push_runtime),private.android_live_push_owner(uuid,uuid),private.android_live_push_retire(),private.android_live_push_allowed(uuid),private.android_live_push_api(text,jsonb),private.android_live_push_dispatch(text,jsonb),private.android_live_push_configure(jsonb)from public,anon,authenticated,service_role;
grant execute on function private.android_live_push_api(text,jsonb),private.android_live_push_dispatch(text,jsonb),private.android_live_push_configure(jsonb)to service_role;
create function public.customer_android_live_push_api(p_action text,p_data jsonb default'{}')returns jsonb language sql set search_path=''as $$select private.android_live_push_api(p_action,p_data);$$;
create function public.customer_android_live_push_dispatch(p_action text,p_data jsonb default'{}')returns jsonb language sql set search_path=''as $$select private.android_live_push_dispatch(p_action,p_data);$$;
create function public.configure_android_live_push(p_data jsonb)returns boolean language sql set search_path=''as $$select private.android_live_push_configure(p_data);$$;
revoke all on function public.customer_android_live_push_api(text,jsonb),public.customer_android_live_push_dispatch(text,jsonb),public.configure_android_live_push(jsonb)from public,anon,authenticated;
grant execute on function public.customer_android_live_push_api(text,jsonb),public.customer_android_live_push_dispatch(text,jsonb),public.configure_android_live_push(jsonb)to service_role;
notify pgrst,'reload schema';
commit;
