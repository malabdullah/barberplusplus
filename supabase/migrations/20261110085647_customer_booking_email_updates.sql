begin;
-- Contact remains canonical in customers. An unverified email is contact data,
-- never an Auth identity, ownership proof or automatic profile merge.
create table private.customer_booking_email_context (
 booking_id uuid primary key references public.bookings(id) on delete cascade,
 customer_id uuid not null references public.customers(id),
 guest boolean not null, language text not null check(language in ('en','ar'))
);
create table private.customer_booking_email_runtime (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 api_url text not null check(api_url in ('https://qvkucvcjmojjbphlzlks.supabase.co','https://srv1073968.hstgr.cloud')),
 enabled_since timestamptz not null default clock_timestamp()
);
create table private.customer_booking_email_jobs (
 id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade,
 revision bigint not null, kind text not null check(kind in ('received','confirmed','rescheduled','cancelled','updated')),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 state text not null default 'pending' check(state in ('pending','sending','sent','cancelled','failed')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_id uuid, leased_until timestamptz, first_attempt_at timestamptz,
 message jsonb, provider_id text, last_error text, sent_at timestamptz,
 unique(booking_id,revision)
);
create index customer_booking_email_pending on private.customer_booking_email_jobs(available_at) where state in ('pending','sending');
create index customer_booking_email_customer on private.customer_booking_email_context(customer_id);
do $$declare t text;begin
 foreach t in array array['customer_booking_email_context','customer_booking_email_runtime','customer_booking_email_jobs']loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on private.%I to service_role',t);
 end loop;
end $$;
CREATE OR REPLACE FUNCTION "public"."customer_booking"("p_action" "text", "p_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  v_barber public.barbers%rowtype;
  v_branch public.branches%rowtype;
  v_booking public.bookings%rowtype;
  v_services uuid[];
  v_date date;
  v_time time;
  v_today date := (current_timestamp at time zone 'Asia/Kuwait')::date;
  v_day text;
  v_schedule jsonb;
  v_hours jsonb;
  v_start time;
  v_end time;
  v_duration integer;
  v_price numeric;
  v_package jsonb;
  v_count integer;
  v_slots jsonb := '[]'::jsonb;
  v_customer uuid;
  v_id uuid;
  v_phone text;
  v_code text;
  v_name text;
  v_email text;
  v_email_guest boolean;
begin
  if p_action not in ('slots', 'book', 'appointment-slots') or p_action is null then
    raise exception 'INVALID_REQUEST';
  end if;
  if p_action = 'book' then
    v_id := (p_data ->> 'id')::uuid;
    v_phone := nullif(p_data ->> 'phone','');
    v_email_guest := p_data->>'guest_contact'='email' and nullif(p_data->>'account_user_id','') is null;
    v_email := lower(btrim(p_data->>'email'));
    v_code := p_data ->> 'country_code';
    v_name := trim(p_data ->> 'name');
    if v_id is null or v_name is null or length(v_name) not between 2 and 120
       or v_code is null or v_code not in ('+965','+966','+971','+973','+974','+968')
       or (coalesce(v_email_guest,false) and (v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'))
       or (not coalesce(v_email_guest,false) and v_phone is null)
       or (v_phone is not null and v_phone !~ '^[0-9]{8,9}$')
       or length(coalesce(p_data ->> 'notes', '')) > 500 then
      raise exception 'INVALID_REQUEST';
    end if;
    -- Serializes retries of the same verified booking, even across barbers.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text, 0));
    select * into v_booking from public.bookings where id = v_id;
    if found then
      if not exists (select 1 from public.customers where id = v_booking.customer_id
        and phone is not distinct from v_phone and country_code = v_code
        and (not coalesce(v_email_guest,false) or lower(email)=v_email)) then
        raise exception 'INVALID_REQUEST';
      end if;
    end if;
  end if;
  if v_booking.id is null then
    select * into v_barber from public.barbers where id = (p_data ->> 'barber_id')::uuid
      and status = 'active' for share;
    select * into v_branch from public.branches where id = v_barber.branch_id and status = 'active' and publication_state = 'published' for share;
    if v_barber.id is null or v_branch.id is null
       or v_branch.id is distinct from (p_data ->> 'branch_id')::uuid then
      raise exception 'INVALID_SELECTION';
    end if;
    select array_agg(value::uuid) into v_services
      from jsonb_array_elements_text(p_data -> 'service_ids');
    if coalesce(cardinality(v_services), 0) not between 1 and 10
       or not v_services <@ coalesce(v_barber.service_ids, '{}'::uuid[])
       or cardinality(v_services) <> (select count(distinct x) from unnest(v_services) x) then
      raise exception 'INVALID_SELECTION';
    end if;
    select count(*), sum(duration), sum(price) into v_count, v_duration, v_price
      from public.services where id = any(v_services) and branch_id = v_branch.id and status = 'active';
    if v_count <> cardinality(v_services) or v_duration not between 5 and 480 or v_price < 0 then
      raise exception 'INVALID_SELECTION';
    end if;
    if nullif(p_data->>'package_offer_id','') is not null and p_action<>'appointment-slots' then
      v_package:=private.package_quote(v_branch.id,v_barber.id,(p_data->>'package_offer_id')::uuid,v_services,(p_data->>'date')::date);
      v_duration:=(v_package->>'duration')::integer;v_price:=(v_package->>'price')::numeric;
      if p_action='book' and ((p_data->'package_quote'->>'price')::numeric is distinct from v_price or (p_data->'package_quote'->>'duration')::integer is distinct from v_duration) then raise exception 'PACKAGE_CHANGED';end if;
    end if;
    -- Only the authenticated appointment manager supplies this internal action.
    if p_action='appointment-slots' then
      v_duration := (p_data->>'booked_duration')::integer;
      v_price := (p_data->>'booked_price')::numeric;
      if v_duration is null or v_duration not between 5 and 480 then
        raise exception 'INVALID_SELECTION';
      end if;
    end if;
    v_date := (p_data ->> 'date')::date;
    if v_date is null or v_date < v_today or v_date > v_today + v_barber.max_booking_days then
      raise exception 'INVALID_DATE';
    end if;
    v_day := lower(trim(to_char(v_date, 'Day')));
    v_schedule := v_barber.availability -> v_day;
    v_hours := v_branch.working_hours -> v_day;
    if coalesce((v_schedule ->> 'enabled')::boolean, (v_schedule ->> 'available')::boolean, false)
       and not coalesce((v_hours ->> 'closed')::boolean, false)
       and not exists (
         select 1 from jsonb_array_elements(coalesce(v_barber.vacations, '[]')) x
         where v_date between (x ->> 'startDate')::date and (x ->> 'endDate')::date
       ) then
      v_start := greatest((v_schedule ->> 'start')::time, (v_hours ->> 'open')::time);
      v_end := least((v_schedule ->> 'end')::time, (v_hours ->> 'close')::time);
      if v_start is not null and v_end is not null and v_end > v_start
         and v_hours ->> 'open' is not null and v_hours ->> 'close' is not null then
        select coalesce(jsonb_agg(to_char(v_date + w.start_time, 'HH24:MI') order by w.start_time), '[]'::jsonb) into v_slots
        from private.booking_start_windows(v_barber.id, v_date, '00:00'::time, '23:59'::time,
          case when p_action='appointment-slots' then (p_data->>'exclude_booking_id')::uuid else null end) w
        where w.free_minutes >= v_duration;
      end if;
    end if;
    if p_action in ('slots','appointment-slots') then
      return jsonb_build_object('slots', v_slots, 'duration', v_duration, 'price', v_price,
        'package',v_package->'package','package_quote',case when v_package is null then null else jsonb_build_object('price',v_price,'duration',v_duration) end,'today', v_today, 'last_date', v_today + v_barber.max_booking_days,
        'confirmation_required',not v_barber.auto_confirm_bookings,'booking_policy',public.shop_booking_policy(v_branch.id));
    end if;
    v_time := (p_data ->> 'time')::time;
    if v_time is null or not v_slots ? to_char(v_date + v_time, 'HH24:MI') then
      raise exception 'SLOT_UNAVAILABLE';
    end if;
    if nullif(p_data->>'account_user_id','') is not null then
      v_customer:=private.resolve_booking_customer((p_data->>'account_user_id')::uuid,(p_data->>'session_id')::uuid);
      if not exists(select 1 from public.customers where id=v_customer and phone=v_phone and country_code=v_code) then raise exception 'INVALID_REQUEST'; end if;
    elsif coalesce(v_email_guest,false) then
      -- Unverified contact details never select or edit an existing person.
      insert into public.customers(name,country_code,phone,email,preferred_branch_id,preferred_barber_id,created_by_type)
        values(v_name,v_code,v_phone,v_email,v_branch.id,v_barber.id,'customer') returning id into v_customer;
    else
      -- Guests reuse a contact without editing it or acquiring its history.
      insert into public.customers(name,country_code,phone,preferred_branch_id,preferred_barber_id,created_by_type)
        values(v_name,v_code,v_phone,v_branch.id,v_barber.id,'customer') on conflict(country_code,phone) do nothing;
      select id into v_customer from public.customers where country_code=v_code and phone=v_phone and status='active';
      if v_customer is null then raise exception 'BOOKING_UNAVAILABLE'; end if;
    end if;
    insert into public.bookings (id, branch_id, barber_id, service_ids, customer_id, date, time,
      duration, price, status, notes, added_by_type,package_offer_id)
    values (v_id, v_branch.id, v_barber.id, v_services, v_customer, v_date, v_time,
      v_duration, v_price, case when v_barber.auto_confirm_bookings then 'confirmed' else 'pending' end, nullif(trim(p_data ->> 'notes'), ''), 'customer',nullif(p_data->>'package_offer_id','')::uuid) returning * into v_booking;
    if p_data ? 'booking_policy' and p_data->'booking_policy' is distinct from jsonb_build_object(
      'cancel_minutes',v_booking.cancel_notice_minutes,'reschedule_minutes',v_booking.reschedule_notice_minutes
    ) then raise exception 'BOOKING_POLICY_CHANGED'; end if;
  end if;
  if p_action='book' and (coalesce(v_email_guest,false) or nullif(p_data->>'account_user_id','') is not null) then
    insert into private.customer_booking_email_context(booking_id,customer_id,guest,language)
      values(v_booking.id,v_booking.customer_id,coalesce(v_email_guest,false),case when p_data->>'language'='ar' then 'ar' else 'en' end) on conflict(booking_id) do nothing;
  end if;
  if p_action = 'book' and nullif(p_data->>'account_user_id','') is not null then
    perform private.record_customer_booking_owner(v_booking.id, (p_data->>'account_user_id')::uuid, (p_data->>'session_id')::uuid);
  end if;
  return (
    select jsonb_build_object('id', b.id, 'reference', upper(left(replace(b.id::text, '-', ''), 10)),
      'date', b.date, 'time', to_char(b.date + b.time, 'HH24:MI'), 'duration', b.duration, 'price', b.price,
      'package',b.package_snapshot,'status', b.status, 'branch_name', br.name, 'branch_name_ar', br.name_ar,
      'barber_name', ba.name, 'barber_name_ar', ba.name_ar, 'address', br.address,
      'location_url', br.location_url, 'service_names', (select jsonb_agg(jsonb_build_object('name', x->>'name', 'name_ar', x->>'name_ar'))
        from jsonb_array_elements(b.service_snapshot) x))
    from public.bookings b join public.branches br on br.id = b.branch_id
      join public.barbers ba on ba.id = b.barber_id where b.id = v_booking.id
  );
end;
$_$;
revoke all on function public.customer_booking(text,jsonb) from public,anon,authenticated;
grant execute on function public.customer_booking(text,jsonb) to service_role;

-- This receipt-bound call is made only after gateway session and receipt checks.
create or replace function public.customer_claim_booking(p_booking uuid,p_account uuid,p_session uuid) returns jsonb
language plpgsql set search_path='' as $$
declare profile uuid; old_profile uuid;
begin
 select customer_id into old_profile from public.bookings where id=p_booking for update;
 if not found then raise exception 'INVALID_REQUEST';end if;
 if exists(select 1 from private.customer_booking_email_context where booking_id=p_booking and guest) then
  profile:=private.resolve_booking_customer(p_account,p_session);
  if not exists(select 1 from auth.users u join public.customers c on c.id=old_profile
    where u.id=p_account and u.email_confirmed_at is not null and lower(u.email)=lower(c.email))
    or exists(select 1 from private.customer_booking_owners where booking_id=p_booking and account_user_id<>p_account)
    then raise exception 'INVALID_REQUEST';end if;
  update public.bookings set customer_id=profile where id=p_booking and customer_id is distinct from profile;
 end if;
 perform private.record_customer_booking_owner(p_booking,p_account,p_session);
 return jsonb_build_object('saved',true);
end $$;
revoke all on function public.customer_claim_booking(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.customer_claim_booking(uuid,uuid,uuid) to service_role;

create function public.configure_customer_booking_email(p_enabled boolean,p_api_url text,p_secret text) returns boolean
language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
 if p_enabled is null or p_api_url not in ('https://qvkucvcjmojjbphlzlks.supabase.co','https://srv1073968.hstgr.cloud')
   or p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REQUEST';end if;
 select id into secret_id from vault.secrets where name='customer_booking_email_dispatch';
 if found then perform vault.update_secret(secret_id,p_secret);else perform vault.create_secret(p_secret,'customer_booking_email_dispatch');end if;
 insert into private.customer_booking_email_runtime(singleton,enabled,api_url)values(true,p_enabled,p_api_url)
 on conflict(singleton)do update set enabled=excluded.enabled,api_url=excluded.api_url,
 enabled_since=case when not customer_booking_email_runtime.enabled and excluded.enabled then clock_timestamp()else customer_booking_email_runtime.enabled_since end;
 return true;
end $$;
revoke all on function public.configure_customer_booking_email(boolean,text,text) from public,anon,authenticated;
grant execute on function public.configure_customer_booking_email(boolean,text,text) to service_role;
create function public.customer_booking_email_configuration()returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',r.enabled,'apiUrl',r.api_url,'secret',
  (select decrypted_secret from vault.decrypted_secrets where name='customer_booking_email_dispatch'))
 from private.customer_booking_email_runtime r where singleton;
$$;
revoke all on function public.customer_booking_email_configuration() from public,anon,authenticated;
grant execute on function public.customer_booking_email_configuration() to service_role;

create function private.capture_customer_booking_email()returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;rev bigint;
begin
 if not exists(select 1 from private.customer_booking_email_runtime where singleton and enabled)then return new;end if;
 if tg_op='INSERT' then kind:=case new.status when 'pending' then 'received' when 'confirmed' then 'confirmed' end;
 elsif new.status='cancelled' and old.status is distinct from new.status then kind:='cancelled';
 elsif new.status='confirmed' and old.status='pending' then kind:='confirmed';
 elsif new.status in ('pending','confirmed')then
  if row(old.date,old.time)is distinct from row(new.date,new.time)then kind:='rescheduled';
  elsif row(old.branch_id,old.barber_id,old.service_ids,old.duration,old.price)is distinct from row(new.branch_id,new.barber_id,new.service_ids,new.duration,new.price)then kind:='updated';end if;
 end if;
 if kind is null then return new;end if;
 select revision into rev from private.customer_push_revisions where booking_id=new.id;
 insert into private.customer_booking_email_jobs(booking_id,revision,kind,expires_at)
 values(new.id,rev,kind,clock_timestamp()+interval '23 hours')on conflict(booking_id,revision)do nothing;
 return new;
end $$;
revoke all on function private.capture_customer_booking_email() from public,anon,authenticated;
-- Runs after the existing booking revision and staff ownership triggers.
create trigger z_capture_customer_booking_email after insert or update on public.bookings
for each row execute function private.capture_customer_booking_email();

create function private.customer_booking_email_message(p_booking uuid)returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',coalesce(u.email,case when ctx.guest and ctx.customer_id=b.customer_id then c.email end),
  'guest',o.account_user_id is null,'language',coalesce(ctx.language,'en'),'reference',upper(left(replace(b.id::text,'-',''),10)),
  'date',b.date,'time',to_char(b.time,'HH24:MI'),'duration',b.duration,'price',b.price,'status',b.status,
  'shop',s.name,'shopAr',s.name_ar,'barber',bar.name,'barberAr',bar.name_ar,
  'services',b.service_snapshot,'package',b.package_snapshot,
  'cancellationReason',case when b.modified_by_type is distinct from 'customer' then b.staff_cancellation->>'reason' end)
 from public.bookings b join public.customers c on c.id=b.customer_id and c.status='active'
 join public.branches s on s.id=b.branch_id join public.barbers bar on bar.id=b.barber_id
 left join private.customer_booking_email_context ctx on ctx.booking_id=b.id
 left join private.customer_booking_owners o on o.booking_id=b.id
 left join auth.users u on u.id=o.account_user_id and u.email_confirmed_at is not null and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=now())
 where b.id=p_booking and (u.id is not null or(o.account_user_id is null and ctx.guest and ctx.customer_id=b.customer_id));
$$;
revoke all on function private.customer_booking_email_message(uuid) from public,anon,authenticated;

create function private.customer_booking_email_allowed(p_id uuid)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.customer_booking_email_jobs j join public.bookings b on b.id=j.booking_id
 join private.customer_push_revisions r on r.booking_id=b.id and r.revision=j.revision
 cross join private.customer_booking_email_runtime cfg
 where j.id=p_id and cfg.singleton and cfg.enabled and j.created_at>=cfg.enabled_since
  and j.expires_at>now() and (j.first_attempt_at is null or j.first_attempt_at>now()-interval '23 hours')
  and (j.kind='cancelled' and b.status='cancelled' or j.kind<>'cancelled' and b.status in ('pending','confirmed')and(b.date+b.time)at time zone 'Asia/Kuwait'>now())
  and private.customer_booking_email_message(b.id)->>'email' ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  and (j.message is null or lower(j.message->>'email')=lower(private.customer_booking_email_message(b.id)->>'email')));
$$;
revoke all on function private.customer_booking_email_allowed(uuid) from public,anon,authenticated;

create function public.customer_booking_email_claim(p_limit integer default 10)returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update private.customer_booking_email_jobs set state='cancelled',leased_until=null where state in('pending','sending')and not private.customer_booking_email_allowed(id);
 update private.customer_booking_email_jobs set state='failed',last_error='AttemptsExhausted',leased_until=null where state='sending'and attempts>=6 and leased_until<now();
 with candidates as(
  select id from private.customer_booking_email_jobs where
   (state='pending'and available_at<=now()or state='sending'and leased_until<now())and attempts<6
   order by available_at for update skip locked limit greatest(1,least(p_limit,10))
 ),leased as(
  update private.customer_booking_email_jobs j set state='sending',attempts=attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '2 minutes',
   first_attempt_at=coalesce(first_attempt_at,now()),message=coalesce(message,private.customer_booking_email_message(booking_id))
   from candidates c where c.id=j.id returning j.*
 )select coalesce(jsonb_agg(jsonb_build_object('id',id,'lease',lease_id,'kind',kind,'message',message)),'[]')into result from leased;
 return result;
end $$;
revoke all on function public.customer_booking_email_claim(integer) from public,anon,authenticated;
grant execute on function public.customer_booking_email_claim(integer) to service_role;
create function public.customer_booking_email_validate(p_id uuid,p_lease uuid)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.customer_booking_email_jobs where id=p_id and lease_id=p_lease and state='sending'and leased_until>now()
  and private.customer_booking_email_allowed(id));
$$;
revoke all on function public.customer_booking_email_validate(uuid,uuid) from public,anon,authenticated;
grant execute on function public.customer_booking_email_validate(uuid,uuid) to service_role;
create function public.customer_booking_email_finish(p_id uuid,p_lease uuid,p_status integer,p_provider_id text default '')returns boolean
language plpgsql security definer set search_path='' as $$
declare job private.customer_booking_email_jobs;
begin
 select * into job from private.customer_booking_email_jobs where id=p_id and lease_id=p_lease and state='sending'for update;
 if not found then return false;end if;
 if p_status=200 then
  update private.customer_booking_email_jobs set state='sent',sent_at=now(),provider_id=left(p_provider_id,100),last_error=null,leased_until=null where id=p_id;
 elsif p_status=410 then
  update private.customer_booking_email_jobs set state='cancelled',leased_until=null where id=p_id;
 else
  update private.customer_booking_email_jobs set state=case when job.attempts>=6 or p_status in(400,401,403,409,422)then 'failed'else 'pending'end,
   available_at=now()+make_interval(secs=>least(3600,30*power(2,job.attempts)::integer)),last_error='HTTP_'||p_status,leased_until=null where id=p_id;
 end if;
 return true;
end $$;
revoke all on function public.customer_booking_email_finish(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.customer_booking_email_finish(uuid,uuid,integer,text) to service_role;

create function private.kick_customer_booking_email()returns void
language plpgsql security definer set search_path='' as $$
declare config jsonb;
begin
 config:=public.customer_booking_email_configuration();
 if coalesce((config->>'enabled')::boolean,false)is not true or config->>'secret' is null then return;end if;
 perform net.http_post(url:=(config->>'apiUrl')||'/functions/v1/customer-booking-email',
 headers:=jsonb_build_object('Content-Type','application/json','x-booking-email-secret',config->>'secret'),body:='{}'::jsonb,timeout_milliseconds:=20000);
exception when others then raise log 'Booking email wake deferred';
end $$;
revoke all on function private.kick_customer_booking_email() from public,anon,authenticated;
select cron.schedule('customer-booking-email-dispatch','* * * * *','select private.kick_customer_booking_email()');
-- Disabled until separately configured for this exact environment. No backfill.
commit;
