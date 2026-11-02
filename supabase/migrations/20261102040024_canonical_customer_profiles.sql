-- One stored customer profile. Auth and account rows retain identity links only.
begin;
lock table auth.users,public.customers,private.customer_accounts,public.bookings,private.customer_booking_owners in share row exclusive mode;

-- Keep all existing identities, including admin, unchanged. Existing account IDs
-- remain stable for the web and iOS clients; customerId identifies the profile.
drop trigger enforce_global_phone on private.customer_accounts;
drop trigger normalize_contact_phone on private.customer_accounts;
drop trigger enforce_global_phone on public.customers;
alter table public.customers alter column phone drop not null;

-- Internal staff annotations are separate from reusable contact details.
create table public.customer_staff_details (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  notes text,
  tags text[] not null default '{}'
);
alter table public.customer_staff_details enable row level security;
revoke all on public.customer_staff_details from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.customer_staff_details to authenticated,service_role;
create policy staff_read_customer_details on public.customer_staff_details for select to authenticated
  using (public.is_manager() or public.is_barber() or public.is_agent() or public.is_admin());
create policy agents_admins_manage_customer_details on public.customer_staff_details for all to authenticated
  using (public.is_agent() or public.is_admin()) with check (public.is_agent() or public.is_admin());
create policy service_manage_customer_details on public.customer_staff_details for all to service_role using(true) with check(true);
insert into public.customer_staff_details(customer_id,notes,tags)
select id,notes,coalesce(tags,'{}') from public.customers where notes is not null or cardinality(tags)>0;
alter table public.customers drop column notes,drop column tags;

-- A migration-time map consolidates existing profile copies without deleting
-- people, Auth identities, appointments, or internal notes. Phone matches never
-- create appointment ownership: the separate explicit ownership map is retained.
create temporary table customer_profile_map on commit drop as
select a.user_id,coalesce(a.customer_id,c.id,gen_random_uuid()) customer_id,
  a.name,a.country_code,a.phone,a.email
from private.customer_accounts a left join public.customers c
  on a.customer_id is null and a.phone is not null and c.country_code=a.country_code and c.phone=a.phone;
insert into public.customers(id,name,country_code,phone,email,created_by_type)
select customer_id,name,coalesce(country_code,'+965'),phone,email,'customer' from customer_profile_map
on conflict(id) do update set name=excluded.name,country_code=excluded.country_code,phone=excluded.phone,email=excluded.email;
update private.customer_accounts a set customer_id=m.customer_id from customer_profile_map m where m.user_id=a.user_id;
update public.bookings b set customer_id=m.customer_id
from private.customer_booking_owners o join customer_profile_map m on m.user_id=o.account_user_id
where b.id=o.booking_id and b.customer_id is distinct from m.customer_id;
alter table private.customer_accounts alter column customer_id set not null;
alter table private.customer_accounts drop column name,drop column country_code,drop column phone,drop column phone_e164,drop column email;

-- Read-only projection; no repeated name, phone or email values are stored here.
create view private.customer_account_profiles with(security_invoker=true) as
select a.user_id,a.customer_id,c.name,
  case when c.phone is null then null else c.country_code end as country_code,c.phone,
  private.canonical_phone(c.phone,c.country_code) phone_e164,c.email,a.created_at,c.status
from private.customer_accounts a join public.customers c on c.id=a.customer_id;
revoke all on private.customer_account_profiles from public,anon,authenticated,service_role;

-- Remove only obsolete customer claims, then rebuild them from the canonical
-- records. Staff, admin and shop claims remain in place throughout the migration.
do $$ declare r record; begin
  for r in delete from private.phone_sources where source in ('customers','customer_accounts') returning phone
  loop perform private.release_phone_source(r.phone); end loop;
end $$;


CREATE OR REPLACE FUNCTION private.sync_phone_record(p_source text, p_id uuid, p_row jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  entries jsonb := '[]'; entry jsonb; old_phone text; target_phone text;
  source_names text[]; owner_key text; customer_user uuid; customer_record uuid;
  claimed text; sources_owner uuid;
begin
  if p_source='auth.users' then
    source_names:=array['auth.profile','auth.phone'];
    if p_row is not null and p_row->>'deleted_at' is null then
      if p_row->'raw_app_meta_data'->>'role'='customer' then
        owner_key:='customer';customer_user:=p_id;
      else owner_key:='user:'||p_id::text;
      end if;
      target_phone:=private.canonical_phone(p_row->>'phone','',true);
      if target_phone is not null then entries:=entries||jsonb_build_array(jsonb_build_object('source','auth.phone','phone',target_phone)); end if;
      if owner_key<>'customer' then
        target_phone:=private.canonical_phone(p_row->'raw_user_meta_data'->>'phone',coalesce(p_row->'raw_user_meta_data'->>'countryCode',p_row->'raw_user_meta_data'->>'country_code','+965'));
        if target_phone is not null then entries:=entries||jsonb_build_array(jsonb_build_object('source','auth.profile','phone',target_phone)); end if;
      end if;
    end if;
  elsif p_source in ('customers','barbers','branches') then
    source_names:=array[p_source];
    if p_row is not null then
      target_phone:=private.canonical_phone(p_row->>'phone',p_row->>'country_code');
      if p_source='customers' then
        owner_key:='customer';customer_record:=p_id;
        select user_id into customer_user from private.customer_accounts where customer_id=p_id;
      elsif p_source='branches' then owner_key:='shop:'||p_id::text;
      else
        sources_owner:=nullif(p_row->>'user_id','')::uuid;
        if sources_owner is not null and not exists(select 1 from auth.users where id=sources_owner and raw_app_meta_data->>'role'='barber' and deleted_at is null) then
          raise exception 'INVALID_BARBER_ACCOUNT';
        end if;
        owner_key:=case when sources_owner is null then 'barber:'||p_id::text else 'user:'||sources_owner::text end;
      end if;
      if target_phone is not null then entries:=jsonb_build_array(jsonb_build_object('source',p_source,'phone',target_phone)); end if;
    end if;
  else raise exception 'INVALID_PHONE_SOURCE';
  end if;
  -- Stable advisory lock order avoids swaps deadlocking; the primary key and
  -- conditional UPSERT below also enforce ownership across MVCC snapshots.
  for target_phone in
    select phone from (
      select phone from private.phone_sources where source=any(source_names) and record_id=p_id
      union select value->>'phone' from jsonb_array_elements(entries)
    ) phones order by phone
  loop perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('barber-phone:'||target_phone,0)); end loop;

  for old_phone in delete from private.phone_sources where source=any(source_names) and record_id=p_id returning phone
  loop perform private.release_phone_source(old_phone); end loop;

  for entry in select value from jsonb_array_elements(entries) loop
    target_phone:=entry->>'phone';claimed:=null;
    insert into private.phone_numbers as numbers(phone,owner_key,customer_user_id,customer_record_id)
    values(target_phone,owner_key,customer_user,customer_record)
    on conflict(phone) do update set customer_user_id=coalesce(numbers.customer_user_id,excluded.customer_user_id),
      customer_record_id=coalesce(numbers.customer_record_id,excluded.customer_record_id)
    where numbers.owner_key=excluded.owner_key
      and (numbers.customer_user_id is null or excluded.customer_user_id is null or numbers.customer_user_id=excluded.customer_user_id)
      and (numbers.customer_record_id is null or excluded.customer_record_id is null or numbers.customer_record_id=excluded.customer_record_id)
    returning phone into claimed;
    if claimed is null then raise exception using errcode='23505',message='PHONE_IN_USE',constraint='global_phone_unique'; end if;
    insert into private.phone_sources(source,record_id,phone,customer_user_id,customer_record_id)
      values(entry->>'source',p_id,target_phone,customer_user,customer_record);
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION private.customer_account_api(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  challenge private.customer_auth_challenges%rowtype;
  account private.customer_account_profiles%rowtype;
  account_user auth.users%rowtype;
  customer_id uuid;
  counter integer;
  valid boolean;
  failed_constraint text;
begin
  -- Confirmed email/provider identities resolve an account link, then read and
  -- update the same customer row used by staff and every booking.
  if p_action in ('email-ensure','profile','update-profile','bookings','logout','social-status') then
    select u.* into account_user from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=nullif(p_data->>'user_id','')::uuid and s.id=nullif(p_data->>'session_id','')::uuid
      and u.raw_app_meta_data->>'role'='customer' and u.email_confirmed_at is not null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
    if account_user.id is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('customer-profile:'||account_user.id::text,0));
      select a.* into account from private.customer_account_profiles a
      where a.user_id=account_user.id or a.user_id=(select account_user_id from private.customer_social_identities where user_id=account_user.id);
      if p_action='email-ensure' and account.user_id is null then
        if length(trim(coalesce(p_data->>'name',''))) not between 2 and 120 then return jsonb_build_object('needsName',true); end if;
        insert into public.customers(name,email,created_by_type) values(trim(p_data->>'name'),account_user.email,'customer') returning id into customer_id;
        insert into private.customer_accounts(user_id,customer_id) values(account_user.id,customer_id);
        select * into account from private.customer_account_profiles where user_id=account_user.id;
      end if;
      if p_action='social-status' and account.user_id is null then return jsonb_build_object('profile',null); end if;
      if account.user_id is null or account.status<>'active' then raise exception 'AUTH_REQUIRED'; end if;
      if p_action='logout' then
        delete from auth.sessions where id=(p_data->>'session_id')::uuid and user_id=account_user.id;
        return jsonb_build_object('success',true);
      elsif p_action='update-profile' then
        if length(trim(coalesce(p_data->>'name',''))) not between 2 and 120 then raise exception 'INVALID_DETAILS'; end if;
        update public.customers set name=trim(p_data->>'name'),
          phone=case when p_data ? 'phone' then nullif(p_data->>'phone','') else phone end,
          country_code=case when p_data ? 'phone' then coalesce(nullif(p_data->>'country_code',''),'+965') else country_code end,
          email=case when account.user_id=account_user.id then account_user.email else email end,
          updated_at=now() where id=account.customer_id;
        select * into account from private.customer_account_profiles where user_id=account.user_id;
      elsif p_action='bookings' then
        return (select coalesce(jsonb_agg(row_to_json(b)),'[]'::jsonb) from (
          select b.id,b.branch_id,b.barber_id,b.service_ids,b.date,to_char(b.date+b.time,'HH24:MI') as time,b.duration,b.price,b.status,
            br.name as shop_name,br.name_ar as shop_name_ar,ba.name as barber_name,ba.name_ar as barber_name_ar,
            (select jsonb_agg(jsonb_build_object('name',s.name,'name_ar',s.name_ar)) from public.services s where s.id=any(b.service_ids)) as services
          from private.customer_booking_owners o join public.bookings b on b.id=o.booking_id
            join public.branches br on br.id=b.branch_id join public.barbers ba on ba.id=b.barber_id
          where o.account_user_id=account.user_id order by b.date desc,b.time desc limit 50
        ) b);
      end if;
      return jsonb_build_object('id',account.user_id,'customerId',account.customer_id,'name',account.name,'phone',account.phone,'countryCode',account.country_code,
        'email',case when account.user_id=account_user.id then account_user.email else account.email end);
    elsif p_action='email-ensure' then raise exception 'AUTH_REQUIRED';
    end if;
  end if;
  if p_action='email-lookup' then
    select * into account_user from auth.users where lower(email)=lower(trim(p_data->>'email'))
      and raw_app_meta_data->>'role'='customer' and deleted_at is null and (banned_until is null or banned_until<=now());
    if account_user.id is null then return 'null'::jsonb; end if;
    return jsonb_build_object('id',account_user.id,'confirmed',account_user.email_confirmed_at is not null);
  end if;
  if p_action='email-reset-guard' then
    select u.* into account_user from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=nullif(p_data->>'user_id','')::uuid and s.id=nullif(p_data->>'session_id','')::uuid
      and u.raw_app_meta_data->>'role'='customer' and u.email_confirmed_at is not null and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now()) for update of u;
    if account_user.id is null then raise exception 'AUTH_REQUIRED'; end if;
    insert into private.customer_password_reset_guards(id,user_id) values((p_data->>'guard_id')::uuid,account_user.id);
    return jsonb_build_object('success',true);
  end if;
  if p_action in ('social-status','social-link') then
    -- Both the live Auth session and provider identity must belong to this user.
    select u.* into account_user from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=(p_data->>'user_id')::uuid and s.id=(p_data->>'session_id')::uuid
      and u.raw_app_meta_data->>'role'='customer' and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
      and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider in ('google','apple'))
      for update of u;
    if account_user.id is null then raise exception 'AUTH_REQUIRED'; end if;
    select a.* into account from private.customer_account_profiles a where a.user_id=account_user.id
      or a.user_id=(select account_user_id from private.customer_social_identities where user_id=account_user.id);
    if p_action='social-status' then
      return jsonb_build_object('profile',case when account.user_id is null then null else private.customer_account_api('profile',p_data) end);
    end if;
    if account.user_id is not null then return private.customer_account_api('profile',p_data); end if;
    -- Only a consumed, session-bound phone challenge can attach an identity.
    if not exists(select 1 from private.customer_auth_challenges ch where ch.purpose='social'
      and ch.consumed_at is not null and ch.id=(p_data->>'challenge_id')::uuid
      and ch.payload->>'social_user_id'=account_user.id::text
      and ch.payload->>'social_session_id'=p_data->>'session_id'
      and ch.phone_e164=p_data->>'phone_e164' and ch.expires_at>now()) then raise exception 'INVALID_CODE'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_data->>'phone_e164',0));
    select * into account from private.customer_account_profiles where phone_e164=p_data->>'phone_e164';
    if account.user_id is null then
      if nullif(account_user.phone,'') is not null and '+'||ltrim(account_user.phone,'+')<>p_data->>'phone_e164' then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
      update auth.users set phone=ltrim(p_data->>'phone_e164','+'),phone_confirmed_at=now() where id=account_user.id;
      perform private.customer_account_api('link',p_data||jsonb_build_object('email',''));
    else
      if exists(select 1 from private.customer_password_reset_guards where user_id=account.user_id) then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
      insert into private.customer_social_identities(user_id,account_user_id) values(account_user.id,account.user_id);
    end if;
    return private.customer_account_api('profile',p_data);
  elsif p_action='limit' then
    if p_data->>'key' !~ '^[0-9a-f]{64}$' or (p_data->>'max')::integer not between 1 and 100 then raise exception 'INVALID_REQUEST'; end if;
    insert into private.customer_auth_limits as l(key) values(p_data->>'key')
    on conflict(key) do update set
      attempts=case when l.window_start < now()-interval '15 minutes' then 1 else l.attempts+1 end,
      window_start=case when l.window_start < now()-interval '15 minutes' then now() else l.window_start end
    returning attempts into counter;
    return to_jsonb(counter <= (p_data->>'max')::integer);
  elsif p_action='issue' then
    delete from private.customer_auth_challenges where expires_at < now()-interval '1 day';
    delete from private.customer_auth_limits where window_start < now()-interval '1 day';
    insert into private.customer_auth_challenges(id,purpose,phone_e164,code_hash,payload)
    values((p_data->>'id')::uuid,p_data->>'purpose',p_data->>'phone_e164',p_data->>'code_hash',p_data->'payload');
    return jsonb_build_object('id',p_data->>'id');
  elsif p_action='lookup' then
    select a.* into account from private.customer_account_profiles a join auth.users u on u.id=a.user_id
      join public.customers c on c.id=a.customer_id
      where a.phone_e164=p_data->>'phone_e164' and u.raw_app_meta_data->>'role'='customer'
        and u.phone_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) and u.deleted_at is null and '+'||ltrim(u.phone,'+')=a.phone_e164 and c.status='active';
    return case when account.user_id is null then 'null'::jsonb else to_jsonb(account) end;
  elsif p_action='consume' then
    select * into challenge from private.customer_auth_challenges where id=(p_data->>'id')::uuid
      and (purpose<>'social' or (payload->>'social_user_id'=p_data->>'user_id' and payload->>'social_session_id'=p_data->>'session_id')) for update;
    if not found or challenge.purpose is distinct from p_data->>'purpose' or challenge.consumed_at is not null
      or challenge.expires_at <= now() or challenge.attempts >= 5 then return 'null'::jsonb; end if;
    valid := challenge.code_hash is not distinct from p_data->>'code_hash';
    update private.customer_auth_challenges set attempts=attempts+1,consumed_at=case when valid then now() else null end where id=challenge.id;
    if not valid then return 'null'::jsonb; end if;
    if challenge.purpose='recovery' then
      select * into account from private.customer_account_profiles where phone_e164=challenge.phone_e164;
      select * into account_user from auth.users where id=account.user_id for update;
      if account.user_id is null or account_user.raw_app_meta_data->>'role' is distinct from 'customer'
        or account_user.phone_confirmed_at is null or account_user.banned_until>now() or account_user.deleted_at is not null or '+'||ltrim(account_user.phone,'+') is distinct from challenge.phone_e164
        or not exists(select 1 from public.customers where id=account.customer_id and status='active') then
        return jsonb_build_object('unavailable',true);
      end if;
      insert into private.customer_password_reset_guards(id,user_id) values(challenge.id,account.user_id);
      return challenge.payload||jsonb_build_object('user_id',account.user_id,'guard_id',challenge.id);
    end if;
    return challenge.payload||jsonb_build_object('challenge_id',challenge.id);
  elsif p_action='link' then
    select * into account_user from auth.users where id=(p_data->>'user_id')::uuid for update;
    if account_user.raw_app_meta_data->>'role' is distinct from 'customer' or account_user.phone_confirmed_at is null
      or '+'||ltrim(account_user.phone,'+') is distinct from p_data->>'phone_e164' then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
    if exists(select 1 from public.customers where country_code=p_data->>'country_code' and phone=p_data->>'phone' and status<>'active') then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
    insert into public.customers as c(name,country_code,phone,email,created_by_type)
      values(p_data->>'name',p_data->>'country_code',p_data->>'phone',nullif(p_data->>'email',''),'customer')
      on conflict(country_code,phone) do update set name=excluded.name,email=excluded.email,updated_at=now()
      returning c.id into customer_id;
    insert into private.customer_accounts(user_id,customer_id) values(account_user.id,customer_id);
    return jsonb_build_object('success',true);
  elsif p_action='finish-reset' then
    if not exists(select 1 from private.customer_password_reset_guards where id=(p_data->>'guard_id')::uuid and user_id=(p_data->>'user_id')::uuid) then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
    -- Refresh tokens cascade from sessions; old access tokens also fail the
    -- explicit live-session check below on every customer operation.
    delete from auth.sessions where user_id=(p_data->>'user_id')::uuid or user_id in (select user_id from private.customer_social_identities where account_user_id=(p_data->>'user_id')::uuid);
    delete from private.customer_password_reset_guards where id=(p_data->>'guard_id')::uuid;
    return jsonb_build_object('success',true);
  end if;
  if p_action not in ('profile','update-profile','bookings','logout') then raise exception 'INVALID_REQUEST'; end if;
  select a.* into account from private.customer_account_profiles a join auth.users u on u.id=a.user_id
    join auth.sessions s on (s.user_id=u.id or exists(select 1 from private.customer_social_identities si where si.user_id=s.user_id and si.account_user_id=u.id))
    join auth.users login_user on login_user.id=s.user_id join public.customers c on c.id=a.customer_id
    where s.user_id=(p_data->>'user_id')::uuid and login_user.raw_app_meta_data->>'role'='customer'
      and login_user.deleted_at is null and (login_user.banned_until is null or login_user.banned_until<=now()) and s.id=(p_data->>'session_id')::uuid
      and u.raw_app_meta_data->>'role'='customer' and u.phone_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) and u.deleted_at is null
      and '+'||ltrim(u.phone,'+')=a.phone_e164 and c.status='active';
  if account.user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action='logout' then
    delete from auth.sessions where id=(p_data->>'session_id')::uuid and user_id=(p_data->>'user_id')::uuid;
    return jsonb_build_object('success',true);
  elsif p_action='update-profile' then
    if length(trim(p_data->>'name')) not between 2 and 120 or length(coalesce(p_data->>'email',''))>254 then raise exception 'INVALID_DETAILS'; end if;
    update public.customers set name=trim(p_data->>'name'),email=nullif(p_data->>'email',''),updated_at=now() where id=account.customer_id;
    select * into account from private.customer_account_profiles where user_id=account.user_id;
  elsif p_action='bookings' then
    return (select coalesce(jsonb_agg(row_to_json(b)),'[]'::jsonb) from (
      select b.id,b.branch_id,b.barber_id,b.service_ids,b.date,to_char(b.date+b.time,'HH24:MI') as time,b.duration,b.price,b.status,
        br.name as shop_name,br.name_ar as shop_name_ar,ba.name as barber_name,ba.name_ar as barber_name_ar,
        (select jsonb_agg(jsonb_build_object('name',s.name,'name_ar',s.name_ar)) from public.services s where s.id=any(b.service_ids)) as services
      from public.bookings b join public.branches br on br.id=b.branch_id join public.barbers ba on ba.id=b.barber_id
      where (b.customer_id=account.customer_id and exists(select 1 from auth.users legacy where legacy.id=account.user_id and legacy.phone_confirmed_at is not null))
         or exists(select 1 from private.customer_booking_owners owner where owner.booking_id=b.id and owner.account_user_id=account.user_id)
      order by b.date desc,b.time desc limit 50
    ) b);
  end if;
  return jsonb_build_object('id',account.user_id,'customerId',account.customer_id,'name',account.name,'phone',account.phone,'countryCode',account.country_code,'email',account.email);
exception when unique_violation then
  get stacked diagnostics failed_constraint=CONSTRAINT_NAME;
  if failed_constraint in ('customers_phone_unique','global_phone_unique') then raise exception using errcode='23505',message='PHONE_IN_USE',constraint='global_phone_unique'; end if;
  raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.customer_booking(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  v_count integer;
  v_slots jsonb := '[]'::jsonb;
  v_customer uuid;
  v_id uuid;
  v_phone text;
  v_code text;
  v_name text;
begin
  if p_action not in ('slots', 'book') or p_action is null then
    raise exception 'INVALID_REQUEST';
  end if;
  if p_action = 'book' then
    v_id := (p_data ->> 'id')::uuid;
    v_phone := p_data ->> 'phone';
    v_code := p_data ->> 'country_code';
    v_name := trim(p_data ->> 'name');
    if v_id is null or v_name is null or length(v_name) not between 2 and 120
       or v_code is null or v_code not in ('+965','+966','+971','+973','+974','+968')
       or v_phone is null or v_phone !~ '^[0-9]{8,9}$'
       or length(coalesce(p_data ->> 'notes', '')) > 500 then
      raise exception 'INVALID_REQUEST';
    end if;
    -- Serializes retries of the same verified booking, even across barbers.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text, 0));
    select * into v_booking from public.bookings where id = v_id;
    if found then
      if not exists (select 1 from public.customers where id = v_booking.customer_id
        and phone = v_phone and country_code = v_code) then
        raise exception 'INVALID_REQUEST';
      end if;
    end if;
  end if;
  if v_booking.id is null then
    select * into v_barber from public.barbers where id = (p_data ->> 'barber_id')::uuid
      and status = 'active';
    select * into v_branch from public.branches where id = v_barber.branch_id and status = 'active';
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
        select coalesce(jsonb_agg(to_char(s, 'HH24:MI') order by s), '[]'::jsonb) into v_slots
        from generate_series(v_date + v_start, v_date + v_end - v_duration * interval '1 minute', interval '15 minutes') s
        where s at time zone 'Asia/Kuwait' > current_timestamp
          and not exists (
            select 1 from public.bookings b where b.barber_id = v_barber.id and b.date = v_date
              and b.status not in ('cancelled','no_show')
              and tsrange(b.date + b.time, b.date + b.time + b.duration * interval '1 minute', '[)')
                && tsrange(s, s + v_duration * interval '1 minute', '[)')
          )
          and not exists (
            select 1 from jsonb_array_elements(coalesce(v_barber.time_offs, '[]')) x
            where ((x ->> 'type' = 'one-time' and x ->> 'date' = v_date::text)
              or (x ->> 'type' = 'recurring' and x ->> 'day' = v_day))
              and tsrange(v_date + (x ->> 'start')::time, v_date + (x ->> 'end')::time, '[)')
                && tsrange(s, s + v_duration * interval '1 minute', '[)')
          );
      end if;
    end if;
    if p_action = 'slots' then
      return jsonb_build_object('slots', v_slots, 'duration', v_duration, 'price', v_price,
        'today', v_today, 'last_date', v_today + v_barber.max_booking_days);
    end if;
    v_time := (p_data ->> 'time')::time;
    if v_time is null or not v_slots ? to_char(v_date + v_time, 'HH24:MI') then
      raise exception 'SLOT_UNAVAILABLE';
    end if;
    if nullif(p_data->>'account_user_id','') is not null then
      v_customer:=private.resolve_booking_customer((p_data->>'account_user_id')::uuid,(p_data->>'session_id')::uuid);
      if not exists(select 1 from public.customers where id=v_customer and phone=v_phone and country_code=v_code) then raise exception 'INVALID_REQUEST'; end if;
    else
      -- Guests reuse a contact without editing it or acquiring its history.
      insert into public.customers(name,country_code,phone,preferred_branch_id,preferred_barber_id,created_by_type)
        values(v_name,v_code,v_phone,v_branch.id,v_barber.id,'customer') on conflict(country_code,phone) do nothing;
      select id into v_customer from public.customers where country_code=v_code and phone=v_phone and status='active';
      if v_customer is null then raise exception 'BOOKING_UNAVAILABLE'; end if;
    end if;
    insert into public.bookings (id, branch_id, barber_id, service_ids, customer_id, date, time,
      duration, price, status, notes, added_by_type)
    values (v_id, v_branch.id, v_barber.id, v_services, v_customer, v_date, v_time,
      v_duration, v_price, 'confirmed', nullif(trim(p_data ->> 'notes'), ''), 'system') returning * into v_booking;
  end if;
  if p_action = 'book' and nullif(p_data->>'account_user_id','') is not null then
    perform private.record_customer_booking_owner(v_booking.id, (p_data->>'account_user_id')::uuid, (p_data->>'session_id')::uuid);
  end if;
  return (
    select jsonb_build_object('id', b.id, 'reference', upper(left(replace(b.id::text, '-', ''), 10)),
      'date', b.date, 'time', to_char(b.date + b.time, 'HH24:MI'), 'duration', b.duration, 'price', b.price,
      'status', b.status, 'branch_name', br.name, 'branch_name_ar', br.name_ar,
      'barber_name', ba.name, 'barber_name_ar', ba.name_ar, 'address', br.address,
      'location_url', br.location_url, 'service_names', (select jsonb_agg(jsonb_build_object('name', s.name, 'name_ar', s.name_ar))
        from public.services s where s.id = any(b.service_ids)))
    from public.bookings b join public.branches br on br.id = b.branch_id
      join public.barbers ba on ba.id = b.barber_id where b.id = v_booking.id
  );
end;
$function$;

-- Resolve booking references through a verified session and account link, never
-- through a caller-selected customer ID or a phone-number ownership guess.
create function private.resolve_booking_customer(p_account uuid,p_session uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare profile_id uuid;
begin
  select a.customer_id into profile_id from private.customer_accounts a
    join auth.users u on u.id=a.user_id
    join auth.sessions s on s.id=p_session
    join auth.users login_user on login_user.id=s.user_id
    join public.customers c on c.id=a.customer_id
  where a.user_id=p_account and (s.user_id=a.user_id or exists(select 1 from private.customer_social_identities i where i.user_id=s.user_id and i.account_user_id=a.user_id))
    and u.raw_app_meta_data->>'role'='customer' and login_user.raw_app_meta_data->>'role'='customer'
    and u.deleted_at is null and login_user.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now()) and (login_user.banned_until is null or login_user.banned_until<=now())
    and (login_user.email_confirmed_at is not null or login_user.phone_confirmed_at is not null) and c.status='active';
  if profile_id is null then raise exception 'AUTH_REQUIRED'; end if;
  return profile_id;
end $$;
revoke all on function private.resolve_booking_customer(uuid,uuid) from public,anon,authenticated;
grant execute on function private.resolve_booking_customer(uuid,uuid) to service_role;

create or replace function private.record_customer_booking_owner(p_booking uuid,p_account uuid,p_session uuid) returns void
language plpgsql security definer set search_path='' as $$
declare profile_id uuid;
begin
  profile_id:=private.resolve_booking_customer(p_account,p_session);
  if not exists(select 1 from public.bookings where id=p_booking and customer_id=profile_id) then raise exception 'INVALID_REQUEST'; end if;
  insert into private.customer_booking_owners(booking_id,account_user_id) values(p_booking,p_account) on conflict(booking_id) do nothing;
  if not exists(select 1 from private.customer_booking_owners where booking_id=p_booking and account_user_id=p_account) then raise exception 'INVALID_REQUEST'; end if;
end $$;
revoke all on function private.record_customer_booking_owner(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.record_customer_booking_owner(uuid,uuid,uuid) to service_role;

-- The account-to-customer link supplies identity information to the number
-- registry without storing another copy of the contact number.
create function private.sync_customer_phone_link() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.customers%rowtype; profile_id uuid;
begin
  for profile_id in select distinct id from unnest(array[case when tg_op<>'INSERT' then old.customer_id end,case when tg_op<>'DELETE' then new.customer_id end]) id where id is not null order by id loop
    select * into c from public.customers where id=profile_id;
    if c.id is not null then perform private.sync_phone_record('customers',c.id,to_jsonb(c)); end if;
  end loop;
  return null;
end $$;
revoke all on function private.sync_customer_phone_link() from public,anon,authenticated,service_role;
create trigger sync_customer_phone_link after insert or update or delete on private.customer_accounts for each row execute function private.sync_customer_phone_link();
create trigger enforce_global_phone after insert or update or delete on public.customers for each row execute function private.guard_global_phone();
do $$ declare r record; begin
  for r in select * from public.customers order by id loop perform private.sync_phone_record('customers',r.id,to_jsonb(r)); end loop;
end $$;

-- Login-email confirmation updates the canonical contact. No staff identity,
-- role, password, email or other Auth value is written by this migration.
create function private.sync_customer_confirmed_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.raw_app_meta_data->>'role'='customer' and new.email_confirmed_at is not null and new.email is distinct from old.email then
    update public.customers set email=new.email,updated_at=now() where id=(select customer_id from private.customer_accounts where user_id=new.id);
  end if;
  return null;
end $$;
revoke all on function private.sync_customer_confirmed_email() from public,anon,authenticated,service_role;
create trigger sync_customer_confirmed_email after update of email,email_confirmed_at on auth.users for each row execute function private.sync_customer_confirmed_email();

-- Staff contact edits and annotations are one atomic operation, with the same
-- RLS restrictions as direct table writes. Customers cannot execute this RPC.
create function public.save_customer_profile(p_id uuid,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.customers%rowtype; details public.customer_staff_details%rowtype;
begin
  if not (public.is_agent() or public.is_admin()) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if p_id is null then
    insert into public.customers(name,name_ar,country_code,phone,email,preferred_barber_id,preferred_branch_id,status,created_by_type,created_by_user_id)
    values(p_data->>'name',p_data->>'name_ar',coalesce(p_data->>'country_code','+965'),p_data->>'phone',nullif(p_data->>'email',''),nullif(p_data->>'preferred_barber_id','')::uuid,nullif(p_data->>'preferred_branch_id','')::uuid,coalesce(p_data->>'status','active'),p_data->>'created_by_type',auth.uid()) returning * into c;
  else
    select * into c from public.customers where id=p_id for update;
    if c.id is null then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
    c:=jsonb_populate_record(c,p_data-array['id','notes','tags','created_at','updated_at','created_by_user_id','created_by_type','total_bookings','last_booking_date']);
    update public.customers set name=c.name,name_ar=c.name_ar,country_code=c.country_code,phone=c.phone,email=c.email,preferred_barber_id=c.preferred_barber_id,preferred_branch_id=c.preferred_branch_id,status=c.status,updated_at=now() where id=p_id returning * into c;
  end if;
  if p_data ? 'notes' or p_data ? 'tags' then
    insert into public.customer_staff_details as d(customer_id,notes,tags)
    values(c.id,p_data->>'notes',coalesce(array(select jsonb_array_elements_text(p_data->'tags')),'{}'))
    on conflict(customer_id) do update set notes=case when p_data ? 'notes' then excluded.notes else d.notes end,tags=case when p_data ? 'tags' then excluded.tags else d.tags end;
  end if;
  select * into details from public.customer_staff_details where customer_id=c.id;
  return to_jsonb(c)||jsonb_build_object('staff_details',to_jsonb(details));
end $$;
revoke all on function public.save_customer_profile(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_customer_profile(uuid,jsonb) to authenticated;

commit;
