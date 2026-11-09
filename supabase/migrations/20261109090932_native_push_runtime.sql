begin;
-- Native iOS push: private capabilities, committed booking events and leased delivery.
-- Public wrappers are service-only; identity is supplied only after server verification.
create table if not exists private.customer_push_devices (
  id uuid primary key, secret_hash bytea not null,
  account_id uuid references auth.users(id) on delete cascade,
  session_id uuid references auth.sessions(id) on delete set null,
  token text, environment text not null check(environment in ('sandbox','production')),
  topic text not null, language text not null default 'en' check(language in ('en','ar')),
  permission boolean not null default false, enabled boolean not null default true,
  preferences jsonb not null default '{"updates":true,"reminder24":true,"reminder2":true,"reviews":false}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(token,environment,topic)
);
create table if not exists private.customer_push_preferences (
  account_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{"updates":true,"reminder24":true,"reminder2":true,"reviews":false}'
);
create index if not exists customer_push_account_devices on private.customer_push_devices(account_id) where permission and enabled;
create table if not exists private.customer_push_guests (
  device_id uuid references private.customer_push_devices(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  expires_at timestamptz not null, primary key(device_id,booking_id)
);
create table if not exists private.customer_push_revisions (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  revision bigint not null default 1
);
create index if not exists customer_push_guest_bookings on private.customer_push_guests(booking_id);
create table if not exists private.customer_push_events (
  id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade,
  revision bigint not null, kind text not null check(kind in ('confirmed','rescheduled','cancelled','updated','reminder24','reminder2','review')),
  actor text not null default 'shop', dedupe_key text not null unique,
  created_at timestamptz not null default now(), expires_at timestamptz not null
);
create table if not exists private.customer_push_schedules (
  id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade,
  revision bigint not null, kind text not null check(kind in ('reminder24','reminder2','review')),
  due_at timestamptz not null, expires_at timestamptz not null,
  consumed boolean not null default false, unique(booking_id,revision,kind)
);
create index if not exists customer_push_live_events on private.customer_push_events(expires_at,booking_id);
create index if not exists customer_push_due on private.customer_push_schedules(due_at) where not consumed;
create table if not exists private.customer_push_deliveries (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references private.customer_push_events(id) on delete cascade,
  device_id uuid not null references private.customer_push_devices(id) on delete cascade,
  state text not null default 'pending' check(state in ('pending','sending','sent','cancelled','failed')),
  attempts integer not null default 0, available_at timestamptz not null default now(), lease_id uuid, leased_until timestamptz,
  token_hash bytea, apns_id text, last_error text, sent_at timestamptz, unique(event_id,device_id)
);
create index if not exists customer_push_pending on private.customer_push_deliveries(available_at) where state in ('pending','sending');

do $$ declare t text; begin
  foreach t in array array['customer_push_devices','customer_push_preferences','customer_push_guests','customer_push_revisions','customer_push_events','customer_push_schedules','customer_push_deliveries'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on private.%I to service_role',t);
  end loop;
end $$;


alter table private.customer_push_devices add column if not exists registration_version bigint not null default 0;
alter table private.customer_push_devices add column if not exists preference_enabled_since jsonb not null default '{}';
alter table private.customer_push_devices add column if not exists notifications_enabled boolean not null default true;
alter table private.customer_push_preferences add column if not exists preference_enabled_since jsonb not null default '{}';
alter table private.customer_push_preferences add column if not exists notifications_enabled boolean not null default true;
alter table private.customer_push_events add column if not exists occurred_at timestamptz not null default clock_timestamp();
create index if not exists customer_push_delivery_device on private.customer_push_deliveries(device_id);
create index if not exists customer_push_device_session on private.customer_push_devices(session_id);
create index if not exists customer_push_event_booking on private.customer_push_events(booking_id);

-- No default deployment target, no keys and no copied Test settings. Operators
-- must separately provision the exact reviewed runtime before enabling delivery.
create table if not exists private.customer_push_runtime (
 singleton boolean primary key default true check(singleton),
 api_url text not null, topic text not null, environments text[] not null,
 check ((api_url='https://qvkucvcjmojjbphlzlks.supabase.co' and topic='com.barberplusplus.customer.test' and environments=array['sandbox']::text[])
   or (api_url='https://srv1073968.hstgr.cloud' and topic='com.barberplusplus.customer' and cardinality(environments)>0 and environments<@array['sandbox','production']::text[]))
);
alter table private.customer_push_runtime enable row level security;
revoke all on private.customer_push_runtime from public,anon,authenticated,service_role;
grant select on private.customer_push_runtime to service_role;
create or replace function public.configure_customer_push_runtime(p_api_url text,p_topic text,p_environments text[]) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 insert into private.customer_push_runtime(singleton,api_url,topic,environments) values(true,p_api_url,p_topic,p_environments)
 on conflict(singleton) do update set api_url=excluded.api_url,topic=excluded.topic,environments=excluded.environments;
 return true;
end $$;
revoke all on function public.configure_customer_push_runtime(text,text,text[]) from public,anon,authenticated;
grant execute on function public.configure_customer_push_runtime(text,text,text[]) to service_role;
CREATE OR REPLACE FUNCTION private.customer_push_enabled_since(p_before jsonb, p_after jsonb, p_since jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select coalesce(p_since,'{}'::jsonb)||coalesce(jsonb_object_agg(entry.key,to_jsonb(clock_timestamp())),'{}'::jsonb)
  from jsonb_each(p_after) entry where entry.value='true'::jsonb and coalesce(p_before->entry.key,'false'::jsonb)='false'::jsonb;
$function$
;
revoke all on function private.customer_push_enabled_since(jsonb, jsonb, jsonb) from public,anon,authenticated;
grant execute on function private.customer_push_enabled_since(jsonb, jsonb, jsonb) to service_role;
CREATE OR REPLACE FUNCTION private.configure_customer_push(p_config jsonb, p_dispatch_secret text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare existing_id uuid;
begin
  if jsonb_typeof(p_config->'enabled') is distinct from 'boolean'
    or p_config->>'keyId' !~ '^[A-Z0-9]{10}$' or p_config->>'teamId' !~ '^[A-Z0-9]{10}$'
    or coalesce(p_config->>'privateKey','') not like '-----BEGIN PRIVATE KEY-----%'
    or p_dispatch_secret !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REQUEST'; end if;
  select id into existing_id from vault.secrets where name='customer_push_apns';
  if found then perform vault.update_secret(existing_id,p_config::text);
  else perform vault.create_secret(p_config::text,'customer_push_apns','Barber++ private APNs configuration'); end if;
  select id into existing_id from vault.secrets where name='customer_push_dispatch_secret';
  if found then perform vault.update_secret(existing_id,p_dispatch_secret);
  else perform vault.create_secret(p_dispatch_secret,'customer_push_dispatch_secret','Server-only push dispatcher authentication'); end if;
  return true;
end $function$
;
revoke all on function private.configure_customer_push(jsonb, text) from public,anon,authenticated;
grant execute on function private.configure_customer_push(jsonb, text) to service_role;
CREATE OR REPLACE FUNCTION public.configure_customer_push(p_config jsonb, p_dispatch_secret text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.configure_customer_push(p_config,p_dispatch_secret);
$function$
;
revoke all on function public.configure_customer_push(jsonb, text) from public,anon,authenticated;
grant execute on function public.configure_customer_push(jsonb, text) to service_role;
CREATE OR REPLACE FUNCTION private.customer_push_configuration()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select decrypted_secret::jsonb from vault.decrypted_secrets where name='customer_push_apns'),'{}'::jsonb)
    || coalesce((select jsonb_build_object('apiUrl',api_url,'topic',topic,'environments',environments) from private.customer_push_runtime where singleton),'{}'::jsonb)
    || jsonb_build_object('dispatchSecret',(select decrypted_secret from vault.decrypted_secrets where name='customer_push_dispatch_secret'));
$function$
;
revoke all on function private.customer_push_configuration() from public,anon,authenticated;
grant execute on function private.customer_push_configuration() to service_role;
CREATE OR REPLACE FUNCTION public.customer_push_configuration()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.customer_push_configuration();
$function$
;
revoke all on function public.customer_push_configuration() from public,anon,authenticated;
grant execute on function public.customer_push_configuration() to service_role;
CREATE OR REPLACE FUNCTION private.kick_customer_push()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare secret text; endpoint text; enabled boolean;
begin
  -- No network call before commit. A minute cron also recovers missed wakes.
  select decrypted_secret into secret from vault.decrypted_secrets where name='customer_push_dispatch_secret';
  select api_url into endpoint from private.customer_push_runtime where singleton;
  select (decrypted_secret::jsonb->>'enabled')::boolean into enabled from vault.decrypted_secrets where name='customer_push_apns';
  if secret is null or endpoint is null or enabled is distinct from true then return; end if;
  perform net.http_post(url:=endpoint||'/functions/v1/customer-push-dispatch',
    headers:=jsonb_build_object('Content-Type','application/json','x-push-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=10000);
exception when others then
  raise log 'Customer push wake deferred to scheduler';
end $function$
;
revoke all on function private.kick_customer_push() from public,anon,authenticated;
grant execute on function private.kick_customer_push() to service_role;
CREATE OR REPLACE FUNCTION private.capture_customer_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rev bigint; event_kind text; starts timestamptz; review_due timestamptz; actor text;
begin
  if tg_op='UPDATE' and row(old.branch_id,old.barber_id,old.service_ids,old.date,old.time,old.duration,old.price,old.status)
    is not distinct from row(new.branch_id,new.barber_id,new.service_ids,new.date,new.time,new.duration,new.price,new.status) then return new; end if;
  insert into private.customer_push_revisions(booking_id) values(new.id)
    on conflict(booking_id) do update set revision=customer_push_revisions.revision+1 returning revision into rev;
  update private.customer_push_schedules set consumed=true where booking_id=new.id and not consumed;
  starts:=(new.date+new.time) at time zone 'Asia/Kuwait';
  update private.customer_push_guests set expires_at=greatest(expires_at,starts+interval '7 days')
    where booking_id=new.id and expires_at>now();
  actor:=case when new.modified_by_type='customer' then 'customer' else 'shop' end;
  if tg_op='INSERT' then
    if new.status='confirmed' then event_kind:='confirmed'; end if;
  elsif new.status='cancelled' and old.status is distinct from new.status then event_kind:='cancelled';
  elsif new.status='confirmed' and old.status='pending' then event_kind:='confirmed';
  elsif new.status in ('pending','confirmed') then
    if row(old.date,old.time) is distinct from row(new.date,new.time) then event_kind:='rescheduled';
    elsif row(old.branch_id,old.barber_id,old.service_ids,old.duration,old.price)
      is distinct from row(new.branch_id,new.barber_id,new.service_ids,new.duration,new.price) then event_kind:='updated'; end if;
  end if;
  if event_kind is not null then
    insert into private.customer_push_events(booking_id,revision,kind,actor,dedupe_key,expires_at)
      values(new.id,rev,event_kind,actor,new.id::text||':'||rev||':'||event_kind,
        case when event_kind='confirmed' then least(now()+interval '1 hour',starts) else now()+interval '24 hours' end);
  end if;
  if new.status='confirmed' and starts>now() then
    insert into private.customer_push_schedules(booking_id,revision,kind,due_at,expires_at)
      select new.id,rev,v.kind,v.due,least(starts,v.due+interval '1 hour')
      from (values('reminder24',starts-interval '24 hours'),('reminder2',starts-interval '2 hours')) v(kind,due)
      where v.due>now()+interval '1 minute';
  elsif new.status='completed' and (tg_op='INSERT' or old.status is distinct from 'completed') then
    review_due:=now()+interval '2 hours';
    if extract(hour from review_due at time zone 'Asia/Kuwait')<9 then
      review_due:=(date_trunc('day',review_due at time zone 'Asia/Kuwait')+interval '9 hours') at time zone 'Asia/Kuwait';
    elsif extract(hour from review_due at time zone 'Asia/Kuwait')>=21 then
      review_due:=(date_trunc('day',review_due at time zone 'Asia/Kuwait')+interval '1 day 9 hours') at time zone 'Asia/Kuwait';
    end if;
    insert into private.customer_push_schedules(booking_id,revision,kind,due_at,expires_at)
      values(new.id,rev,'review',review_due,review_due+interval '24 hours');
  end if;
  perform private.kick_customer_push();
  return new;
end $function$
;
revoke all on function private.capture_customer_push() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.customer_push_allowed(p_event uuid, p_device uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists(
    select 1 from private.customer_push_events e join public.bookings b on b.id=e.booking_id
    join private.customer_push_revisions r on r.booking_id=b.id and r.revision=e.revision
    join private.customer_push_devices d on d.id=p_device
    left join private.customer_push_preferences pref on pref.account_id=d.account_id
    where e.id=p_event and e.expires_at>now() and d.enabled and d.permission and d.token is not null
      and d.updated_at>now()-interval '90 days'
      and coalesce(pref.notifications_enabled,d.notifications_enabled)
      and e.occurred_at>=coalesce((coalesce(pref.preference_enabled_since,d.preference_enabled_since)->>'enabled')::timestamptz,'-infinity'::timestamptz)
      and (case e.kind when 'reminder24' then coalesce(pref.preferences,d.preferences)->>'reminder24'
        when 'reminder2' then coalesce(pref.preferences,d.preferences)->>'reminder2'
        when 'review' then coalesce(pref.preferences,d.preferences)->>'reviews'
        else coalesce(pref.preferences,d.preferences)->>'updates' end)='true'
      and e.occurred_at>=coalesce((coalesce(pref.preference_enabled_since,d.preference_enabled_since)->>
        (case e.kind when 'reminder24' then 'reminder24' when 'reminder2' then 'reminder2' when 'review' then 'reviews' else 'updates' end))::timestamptz,'-infinity'::timestamptz)
      and (e.kind not in ('reminder24','reminder2','confirmed') or (b.status='confirmed' and ((b.date+b.time) at time zone 'Asia/Kuwait')>now()))
      and (e.kind<>'review' or (d.account_id is not null and public.customer_session_is_live(d.account_id,d.session_id) and exists(select 1 from private.customer_booking_owners o where o.booking_id=b.id and o.account_user_id=d.account_id) and b.status='completed' and not exists(select 1 from private.customer_booking_ratings rating where rating.booking_id=b.id)))
      and (e.kind<>'cancelled' or b.status='cancelled')
      and ((d.account_id is not null and public.customer_session_is_live(d.account_id,d.session_id)
          and exists(select 1 from private.customer_booking_owners o where o.booking_id=b.id and o.account_user_id=d.account_id))
        or exists(select 1 from private.customer_push_guests g where g.device_id=d.id and g.booking_id=b.id and g.expires_at>now()
          and (not exists(select 1 from private.customer_booking_owners o where o.booking_id=b.id)
            or exists(select 1 from private.customer_booking_owners o where o.booking_id=b.id and o.account_user_id=d.account_id
              and public.customer_session_is_live(d.account_id,d.session_id)))))
  );
$function$
;
revoke all on function private.customer_push_allowed(uuid, uuid) from public,anon,authenticated;
grant execute on function private.customer_push_allowed(uuid, uuid) to service_role;
CREATE OR REPLACE FUNCTION public.customer_push_api(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d private.customer_push_devices; device uuid:=(p_data->>'deviceId')::uuid; account uuid; sid uuid;
  prefs jsonb; booking public.bookings; result jsonb; runtime private.customer_push_runtime;
begin
  select * into runtime from private.customer_push_runtime where singleton;
  if not found then raise exception 'PUSH_NOT_CONFIGURED';end if;
  if p_data->>'deviceSecret' is null or p_data->>'deviceSecret' !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REQUEST'; end if;
  if p_data ? 'user_id' then
    account:=(p_data->>'user_id')::uuid; sid:=(p_data->>'session_id')::uuid;
    if not public.customer_session_is_live(account,sid) then raise exception 'AUTH_REQUIRED'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(device::text,714));
  select * into d from private.customer_push_devices where id=device for update;
  if found and d.secret_hash is distinct from extensions.digest(p_data->>'deviceSecret','sha256') then raise exception 'FORBIDDEN'; end if;
  if not found then
    if p_action not in ('push-register','push-detach') then raise exception 'DEVICE_REQUIRED'; end if;
    insert into private.customer_push_devices(id,secret_hash,environment,topic)
      values(device,extensions.digest(p_data->>'deviceSecret','sha256'),coalesce(p_data->>'environment',runtime.environments[1]),runtime.topic) returning * into d;
  end if;
  if p_action in ('push-register','push-detach') then
    if jsonb_typeof(p_data->'version') is distinct from 'number' or (p_data->>'version')::bigint<1 then raise exception 'INVALID_REQUEST'; end if;
    if (p_data->>'version')::bigint<=d.registration_version then
      return jsonb_build_object('success',true,'preferences',coalesce((select preferences from private.customer_push_preferences where account_id=account),d.preferences),'notificationsEnabled',coalesce((select notifications_enabled from private.customer_push_preferences where account_id=account),d.notifications_enabled));
    end if;
    update private.customer_push_devices set registration_version=(p_data->>'version')::bigint where id=device;
  end if;
  if p_action='push-register' then
    if not coalesce((p_data->>'environment')=any(runtime.environments),false) or p_data->>'token' !~ '^[0-9a-f]+$' or length(p_data->>'token') not between 32 and 512 or length(p_data->>'token')%2<>0
      or p_data->>'language' not in ('en','ar') or jsonb_typeof(p_data->'permission')<>'boolean' then raise exception 'INVALID_REQUEST'; end if;
    if account is not null and d.account_id is not null and d.account_id is distinct from account then
      delete from private.customer_push_guests where device_id=device;
    end if;
    -- A reinstallation can receive the same APNs token. Retire its former binding.
    update private.customer_push_devices set token=null,permission=false,enabled=false
      where token=p_data->>'token' and environment=p_data->>'environment' and topic=runtime.topic and id<>device;
    update private.customer_push_devices set token=p_data->>'token',environment=p_data->>'environment',topic=runtime.topic,language=p_data->>'language',
      permission=(p_data->>'permission')::boolean,enabled=true,updated_at=now(),
      account_id=case when account is not null then account else account_id end,
      session_id=case when account is not null then sid else session_id end
      where id=device returning * into d;
  elsif p_action='push-detach' then
    update private.customer_push_devices set account_id=null,session_id=null,token=null,permission=false,updated_at=now() where id=device returning * into d;
    delete from private.customer_push_guests where device_id=device;
    update private.customer_push_deliveries set state='cancelled' where device_id=device and state in ('pending','sending');
  elsif p_action='push-preferences' then
    prefs:=p_data->'preferences';
    if p_data ? 'notificationsEnabled' and jsonb_typeof(p_data->'notificationsEnabled') is distinct from 'boolean' then raise exception 'INVALID_REQUEST'; end if;
    if jsonb_typeof(prefs)<>'object' or prefs-array['updates','reminder24','reminder2','reviews']<>'{}'::jsonb
      or not(prefs ?& array['updates','reminder24','reminder2','reviews'])
      or exists(select 1 from jsonb_each(prefs) x where jsonb_typeof(x.value)<>'boolean') then raise exception 'INVALID_REQUEST'; end if;
    if account is not null then
      insert into private.customer_push_preferences as saved(account_id,preferences,notifications_enabled,preference_enabled_since)
        values(account,prefs,coalesce((p_data->>'notificationsEnabled')::boolean,d.notifications_enabled),
          private.customer_push_enabled_since(d.preferences||jsonb_build_object('enabled',d.notifications_enabled),
            prefs||jsonb_build_object('enabled',coalesce((p_data->>'notificationsEnabled')::boolean,d.notifications_enabled)),'{}'::jsonb))
        on conflict(account_id) do update set
          preference_enabled_since=private.customer_push_enabled_since(saved.preferences||jsonb_build_object('enabled',saved.notifications_enabled),
            excluded.preferences||jsonb_build_object('enabled',coalesce((p_data->>'notificationsEnabled')::boolean,saved.notifications_enabled)),saved.preference_enabled_since),
          preferences=excluded.preferences,notifications_enabled=coalesce((p_data->>'notificationsEnabled')::boolean,saved.notifications_enabled);
    else
      update private.customer_push_devices set
        preference_enabled_since=private.customer_push_enabled_since(preferences||jsonb_build_object('enabled',notifications_enabled),
          prefs||jsonb_build_object('enabled',coalesce((p_data->>'notificationsEnabled')::boolean,notifications_enabled)),preference_enabled_since),
        preferences=prefs,notifications_enabled=coalesce((p_data->>'notificationsEnabled')::boolean,notifications_enabled)
        where id=device;
    end if;
  elsif p_action in ('push-guest-subscribe','push-guest-receipt') then
    select * into booking from public.bookings where id=(p_data->>'bookingId')::uuid;
    if not found then raise exception 'FORBIDDEN'; end if;
    if p_action='push-guest-subscribe' then
      -- The handler supplied these fields only from a valid signed receipt.
      if not exists(select 1 from public.customers c where c.id=booking.customer_id and c.phone=p_data->>'receiptPhone'
          and c.country_code=p_data->>'receiptCountry') then raise exception 'FORBIDDEN'; end if;
      if exists(select 1 from private.customer_booking_owners o where o.booking_id=booking.id and o.account_user_id is distinct from account)
        then raise exception 'FORBIDDEN'; end if;
      if (select count(*) from private.customer_push_guests where device_id=device and expires_at>now())>=100
        and not exists(select 1 from private.customer_push_guests where device_id=device and booking_id=booking.id) then raise exception 'SUBSCRIPTION_LIMIT'; end if;
      insert into private.customer_push_guests values(device,booking.id,greatest(now()+interval '1 day',((booking.date+booking.time) at time zone 'Asia/Kuwait')+interval '7 days'))
        on conflict(device_id,booking_id) do nothing;
    else
      if not exists(select 1 from private.customer_push_guests g where g.device_id=device and g.booking_id=booking.id and g.expires_at>now())
        or exists(select 1 from private.customer_booking_owners o where o.booking_id=booking.id and (o.account_user_id is distinct from account
          or not public.customer_session_is_live(account,sid))) then raise exception 'FORBIDDEN'; end if;
      select jsonb_build_object('id',booking.id,'reference',upper(left(replace(booking.id::text,'-',''),10)),
        'branch_name',s.name,'branch_name_ar',s.name_ar,'barber_name',barber.name,'barber_name_ar',barber.name_ar,
        'date',booking.date,'time',to_char(booking.time,'HH24:MI'),'price',booking.price,'duration',booking.duration,'status',booking.status,'cancelled_at',case when booking.status='cancelled' then coalesce(booking.cancelled_at,
          case when booking.staff_cancellation->>'at' ~ '^\d{4}-\d{2}-\d{2}T' then (booking.staff_cancellation->>'at')::timestamptz end,booking.updated_at,booking.created_at) end,
        'cancellationReason',case when booking.status='cancelled' then nullif(btrim(booking.staff_cancellation->>'reason'),'') end,
        'location_url',s.location_url,'service_names',case when jsonb_array_length(coalesce(booking.service_snapshot,'[]'))>0 then (select jsonb_agg(jsonb_build_object('name',line->>'name','name_ar',line->>'name_ar')) from jsonb_array_elements(booking.service_snapshot) line) else (select coalesce(jsonb_agg(jsonb_build_object('name',sv.name,'name_ar',sv.name_ar)),'[]') from public.services sv where sv.id=any(booking.service_ids)) end)
        into result from public.branches s join public.barbers barber on barber.id=booking.barber_id where s.id=booking.branch_id;
      return jsonb_build_object('receipt',result);
    end if;
  elsif p_action<>'push-status' then raise exception 'INVALID_REQUEST'; end if;
  perform private.kick_customer_push();
  select coalesce((select preferences from private.customer_push_preferences where account_id=account),
    (select preferences from private.customer_push_devices where id=device)) into prefs;
  return jsonb_build_object('success',true,'preferences',prefs,'notificationsEnabled',
    coalesce((select notifications_enabled from private.customer_push_preferences where account_id=account),
      (select notifications_enabled from private.customer_push_devices where id=device)));
end $function$
;
revoke all on function public.customer_push_api(text, jsonb) from public,anon,authenticated;
grant execute on function public.customer_push_api(text, jsonb) to service_role;
CREATE OR REPLACE FUNCTION public.customer_push_claim(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare scheduled private.customer_push_schedules; result jsonb;
begin
  for scheduled in select * from private.customer_push_schedules where not consumed and due_at<=now() order by due_at for update skip locked limit 100 loop
    if scheduled.expires_at>now() then
      insert into private.customer_push_events(booking_id,revision,kind,dedupe_key,expires_at,occurred_at)
        values(scheduled.booking_id,scheduled.revision,scheduled.kind,'schedule:'||scheduled.id,scheduled.expires_at,scheduled.due_at) on conflict(dedupe_key) do nothing;
    end if;
    update private.customer_push_schedules set consumed=true where id=scheduled.id;
  end loop;
  insert into private.customer_push_deliveries(event_id,device_id)
    select recipient.event_id,recipient.device_id from (
      select e.id event_id,d.id device_id from private.customer_push_events e
        join private.customer_booking_owners o on o.booking_id=e.booking_id
        join private.customer_push_devices d on d.account_id=o.account_user_id
        where e.expires_at>now() and e.created_at>d.created_at-interval '15 minutes'
      union
      select e.id,g.device_id from private.customer_push_events e
        join private.customer_push_guests g on g.booking_id=e.booking_id and g.expires_at>now()
        where e.expires_at>now()
    ) recipient where private.customer_push_allowed(recipient.event_id,recipient.device_id)
    on conflict(event_id,device_id) do nothing;
  update private.customer_push_deliveries j set state='cancelled'
    where j.state in ('pending','sending') and not private.customer_push_allowed(j.event_id,j.device_id);
  update private.customer_push_deliveries set state='failed',last_error='LeaseExhausted'
    where state='sending' and attempts>=6 and leased_until<now();
  with candidates as (
    select j.id from private.customer_push_deliveries j where
      (j.state='pending' and j.available_at<=now() or j.state='sending' and j.leased_until<now()) and j.attempts<6
      order by j.available_at for update skip locked limit greatest(1,least(p_limit,20))
  ), leased as (
    update private.customer_push_deliveries j set state='sending',attempts=attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '2 minutes',
      token_hash=(select extensions.digest(d.token,'sha256') from private.customer_push_devices d where d.id=j.device_id)
      from candidates c where c.id=j.id returning j.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'lease',j.lease_id,'eventId',e.id,'bookingId',b.id,'kind',e.kind,'actor',e.actor,
    'cancellationReason',case when e.kind='cancelled' and e.actor<>'customer' then nullif(btrim(b.staff_cancellation->>'reason'),'') end,
    'token',d.token,'environment',d.environment,'topic',d.topic,'language',d.language,'date',b.date,'time',to_char(b.time,'HH24:MI'),
    'shop',s.name,'shopAr',s.name_ar,'barber',barber.name,'barberAr',barber.name_ar,'expiresAt',extract(epoch from e.expires_at)::bigint)), '[]')
    into result from leased j join private.customer_push_events e on e.id=j.event_id join private.customer_push_devices d on d.id=j.device_id
      join public.bookings b on b.id=e.booking_id join public.branches s on s.id=b.branch_id join public.barbers barber on barber.id=b.barber_id;
  return result;
end $function$
;
revoke all on function public.customer_push_claim(integer) from public,anon,authenticated;
grant execute on function public.customer_push_claim(integer) to service_role;
CREATE OR REPLACE FUNCTION public.customer_push_validate(p_id uuid, p_lease uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists(select 1 from private.customer_push_deliveries j join private.customer_push_devices d on d.id=j.device_id
    where j.id=p_id and j.lease_id=p_lease and j.state='sending' and j.leased_until>now()
      and j.token_hash=extensions.digest(d.token,'sha256') and private.customer_push_allowed(j.event_id,j.device_id));
$function$
;
revoke all on function public.customer_push_validate(uuid, uuid) from public,anon,authenticated;
grant execute on function public.customer_push_validate(uuid, uuid) to service_role;
CREATE OR REPLACE FUNCTION public.customer_push_finish(p_id uuid, p_lease uuid, p_status integer, p_reason text, p_apns_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j private.customer_push_deliveries;
begin
  select * into j from private.customer_push_deliveries where id=p_id and lease_id=p_lease and state='sending' for update;
  if not found then return false; end if;
  if p_reason='Cancelled' then
    update private.customer_push_deliveries set state=case when private.customer_push_allowed(j.event_id,j.device_id) then 'pending' else 'cancelled' end,
      available_at=now(),attempts=greatest(0,attempts-1),last_error=null,leased_until=null where id=j.id;
  elsif p_status=200 then
    update private.customer_push_deliveries set state='sent',sent_at=now(),apns_id=left(p_apns_id,100),last_error=null,leased_until=null where id=j.id;
  elsif p_status=410 or p_reason in ('BadDeviceToken','Unregistered','DeviceTokenNotForTopic') then
    update private.customer_push_devices set permission=false,token=null where id=j.device_id and extensions.digest(token,'sha256')=j.token_hash;
    update private.customer_push_deliveries set state='failed',last_error=left(p_reason,100),leased_until=null where id=j.id;
  else
    update private.customer_push_deliveries set state=case when j.attempts>=6 or p_status in (400,413) then 'failed' else 'pending' end,
      available_at=now()+make_interval(secs=>least(3600,15*power(2,j.attempts)::integer)),last_error=left(p_reason,100),leased_until=null where id=j.id;
  end if;
  return true;
end $function$
;
revoke all on function public.customer_push_finish(uuid, uuid, integer, text, text) from public,anon,authenticated;
grant execute on function public.customer_push_finish(uuid, uuid, integer, text, text) to service_role;
CREATE OR REPLACE FUNCTION private.detach_customer_session_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from private.customer_push_guests where device_id in(select id from private.customer_push_devices where session_id=old.id);
  update private.customer_push_devices set token=null,permission=false,account_id=null,session_id=null where session_id=old.id;
  return old;
end $function$
;
revoke all on function private.detach_customer_session_push() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.cleanup_customer_push()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from private.customer_push_events where expires_at<now()-interval '30 days';
  delete from private.customer_push_schedules where consumed and expires_at<now()-interval '30 days';
  delete from private.customer_push_guests where expires_at<now()-interval '7 days';
  delete from private.customer_push_devices where updated_at<now()-interval '180 days';
end $function$
;
revoke all on function private.cleanup_customer_push() from public,anon,authenticated;

do $trigger$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.bookings'::regclass and tgname='capture_customer_push') then
  create trigger capture_customer_push after insert or update on public.bookings for each row execute function private.capture_customer_push();
 end if;
end $trigger$;
do $trigger$ begin
 if not exists(select 1 from pg_trigger where tgrelid='auth.sessions'::regclass and tgname='detach_customer_session_push') then
  create trigger detach_customer_session_push before delete on auth.sessions for each row execute function private.detach_customer_session_push();
 end if;
end $trigger$;
-- Only future mutations create notifications. No history backfill or replay.
select cron.schedule('customer-native-push-dispatch','* * * * *','select private.kick_customer_push()');
select cron.schedule('customer-native-push-cleanup','0 1 * * *','select private.cleanup_customer_push()');

commit;
