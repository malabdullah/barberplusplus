-- One Auth identity can work and book personally. Primary staff roles and RLS
-- stay unchanged. No accounts, existing data or protected admin are modified.
begin;

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
        if exists(select 1 from auth.users where id=customer_user and raw_app_meta_data->>'role' in ('manager','barber')) then
          owner_key:='user:'||customer_user::text;
        end if;
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

create or replace function private.resolve_booking_customer(p_account uuid,p_session uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare profile_id uuid;
begin
  select a.customer_id into profile_id from private.customer_accounts a
    join auth.users u on u.id=a.user_id
    join auth.sessions s on s.id=p_session
    join auth.users login_user on login_user.id=s.user_id
    join public.customers c on c.id=a.customer_id
  where a.user_id=p_account and (s.user_id=a.user_id or exists(select 1 from private.customer_social_identities i where i.user_id=s.user_id and i.account_user_id=a.user_id))
    and u.raw_app_meta_data->>'role' in ('customer','manager','barber') and login_user.raw_app_meta_data->>'role' in ('customer','manager','barber')
    and (s.not_after is null or s.not_after>now())
    and u.deleted_at is null and login_user.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now()) and (login_user.banned_until is null or login_user.banned_until<=now())
    and (login_user.email_confirmed_at is not null or login_user.phone_confirmed_at is not null) and c.status='active';
  if profile_id is null then raise exception 'AUTH_REQUIRED'; end if;
  return profile_id;
end $$;
revoke all on function private.resolve_booking_customer(uuid,uuid) from public,anon,authenticated;
grant execute on function private.resolve_booking_customer(uuid,uuid) to service_role;

-- Keep the existing customer implementation, including legacy social aliases.
do $$ begin
  if to_regprocedure('private.customer_account_api_customer(text,jsonb)') is null then
    alter function private.customer_account_api(text,jsonb) rename to customer_account_api_customer;
  end if;
end $$;
revoke all on function private.customer_account_api_customer(text,jsonb) from public,anon,authenticated,service_role;

create or replace function private.customer_account_api(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  person auth.users%rowtype;
  profile private.customer_account_profiles%rowtype;
  customer uuid;
  contact_name text;
  full_phone text;
  dial text;
begin
  -- Recovery remains the same credential for both modes. No role is rewritten.
  if p_action='email-lookup' then
    select * into person from auth.users where lower(email)=lower(trim(p_data->>'email'))
      and raw_app_meta_data->>'role' in ('manager','barber') and deleted_at is null
      and (banned_until is null or banned_until<=now());
    if person.id is not null then
      return jsonb_build_object('id',person.id,'confirmed',person.email_confirmed_at is not null);
    end if;
  end if;
  select * into person from auth.users where id=nullif(p_data->>'user_id','')::uuid;
  if person.raw_app_meta_data->>'role' not in ('manager','barber') or person.id is null then
    return private.customer_account_api_customer(p_action,p_data);
  end if;
  if p_action='finish-reset' then return private.customer_account_api_customer(p_action,p_data); end if;
  if person.deleted_at is not null or person.banned_until>now()
    or (person.email_confirmed_at is null and person.phone_confirmed_at is null)
    or not public.customer_session_is_live(person.id,nullif(p_data->>'session_id','')::uuid) then raise exception 'AUTH_REQUIRED'; end if;
  if p_action='email-reset-guard' then
    insert into private.customer_password_reset_guards(id,user_id) values((p_data->>'guard_id')::uuid,person.id);
    return jsonb_build_object('success',true);
  end if;
  if p_action not in ('profile','email-ensure','social-status','update-profile','bookings','logout') then raise exception 'INVALID_REQUEST'; end if;
  if p_action='logout' then
    delete from auth.sessions where id=(p_data->>'session_id')::uuid and user_id=person.id;
    return jsonb_build_object('success',true);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('customer-profile:'||person.id::text,0));
  select * into profile from private.customer_account_profiles where user_id=person.id;
  if profile.user_id is null then
    contact_name:=coalesce(nullif(trim(person.raw_user_meta_data->>'name'),''),
      nullif(trim(person.raw_user_meta_data->>'full_name'),''),
      (select name from public.barbers where user_id=person.id order by manager_chair,id limit 1));
    if length(coalesce(contact_name,'')) not between 2 and 120 then
      contact_name:=trim(p_data->>'name');
    end if;
    if length(coalesce(contact_name,'')) not between 2 and 120 then return jsonb_build_object('needsName',true); end if;
    -- Link first, then claim the staff member's existing phone as the SAME person.
    -- No phone/email match ever merges two existing Auth identities.
    insert into public.customers(name,email,created_by_type) values(contact_name,person.email,'customer') returning id into customer;
    insert into private.customer_accounts(user_id,customer_id) values(person.id,customer);
    full_phone:=coalesce(private.canonical_phone(person.raw_user_meta_data->>'phone',
      coalesce(person.raw_user_meta_data->>'countryCode',person.raw_user_meta_data->>'country_code','+965')),
      private.canonical_phone(person.phone,'',true),
      (select private.canonical_phone(phone,country_code) from public.barbers where user_id=person.id and not manager_chair order by id limit 1));
    if full_phone is not null then
      dial:='+'||substring(full_phone from 2 for 3);
      update public.customers set country_code=dial,phone=substring(full_phone from 5) where id=customer;
    end if;
    select * into profile from private.customer_account_profiles where user_id=person.id;
  end if;
  if profile.status<>'active' then raise exception 'AUTH_REQUIRED'; end if;
  if p_action='update-profile' then
    if length(trim(coalesce(p_data->>'name',''))) not between 2 and 120 then raise exception 'INVALID_DETAILS'; end if;
    update public.customers set name=trim(p_data->>'name'),
      phone=case when p_data ? 'phone' then nullif(p_data->>'phone','') else phone end,
      country_code=case when p_data ? 'phone' then coalesce(nullif(p_data->>'country_code',''),'+965') else country_code end,
      email=person.email,updated_at=now() where id=profile.customer_id;
    select * into profile from private.customer_account_profiles where user_id=person.id;
  elsif p_action='bookings' then
    return (select coalesce(jsonb_agg(row_to_json(b)),'[]'::jsonb) from (
      select b.id,b.branch_id,b.barber_id,b.service_ids,b.date,to_char(b.date+b.time,'HH24:MI') as time,b.duration,b.price,b.status,
        br.name as shop_name,br.name_ar as shop_name_ar,ba.name as barber_name,ba.name_ar as barber_name_ar,
        (select jsonb_agg(jsonb_build_object('name',s.name,'name_ar',s.name_ar)) from public.services s where s.id=any(b.service_ids)) as services
      from private.customer_booking_owners o join public.bookings b on b.id=o.booking_id
      join public.branches br on br.id=b.branch_id join public.barbers ba on ba.id=b.barber_id
      where o.account_user_id=person.id order by b.date desc,b.time desc limit 50
    ) b);
  end if;
  if p_action='social-status' then return jsonb_build_object('profile',private.customer_account_api('profile',p_data)); end if;
  return jsonb_build_object('id',person.id,'customerId',profile.customer_id,'name',profile.name,'phone',profile.phone,
    'countryCode',profile.country_code,'email',person.email,'workRole',person.raw_app_meta_data->>'role',
    'ownBarberIds',(select coalesce(jsonb_agg(id),'[]'::jsonb) from public.barbers where user_id=person.id));
end;
$$;
revoke all on function private.customer_account_api(text,jsonb) from public,anon,authenticated;
grant execute on function private.customer_account_api(text,jsonb) to service_role;

create or replace function public.customer_session_is_live(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=p_session and s.user_id=p_user and u.raw_app_meta_data->>'role' in ('customer','manager','barber')
      and (s.not_after is null or s.not_after>now()) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
  )
$$;

revoke all on function public.customer_session_is_live(uuid,uuid) from public,anon,authenticated;
grant execute on function public.customer_session_is_live(uuid,uuid) to service_role;

-- Existing work forms retain compatible contact fields. The canonical customer
-- row is shared by personal bookings; changes from either interface propagate
-- transactionally. Professional barber display names and chair history stay separate.
create or replace function private.sync_personal_work_contact() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  person_id uuid;
  customer uuid;
  full_phone text;
  dial text;
  person auth.users%rowtype;
begin
  if pg_trigger_depth()>1 then return null; end if;
  if tg_table_schema='auth' then person_id:=new.id;
  elsif tg_table_name='barbers' then
    if new.manager_chair or new.user_id is null then return null; end if;
    person_id:=new.user_id;
  else select user_id into person_id from private.customer_accounts where customer_id=new.id;
  end if;
  select * into person from auth.users where id=person_id and raw_app_meta_data->>'role' in ('manager','barber') and deleted_at is null;
  if person.id is null then return null; end if;
  select customer_id into customer from private.customer_accounts where user_id=person.id;
  if customer is null then return null; end if;
  if tg_table_name='customers' then
    full_phone:=private.canonical_phone(new.phone,new.country_code);
    update auth.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('name',new.name,'phone',coalesce(full_phone,''),'countryCode',new.country_code),
      phone=case when phone is null then null else ltrim(full_phone,'+') end
      where id=person.id;
    update public.barbers set phone=new.phone,country_code=new.country_code,email=person.email
      where user_id=person.id and not manager_chair
        and (phone,country_code,email) is distinct from (new.phone,new.country_code,person.email);
  else
    if tg_table_schema='auth' then
      full_phone:=case when new.phone is distinct from old.phone then private.canonical_phone(new.phone,'',true)
        else private.canonical_phone(new.raw_user_meta_data->>'phone',coalesce(new.raw_user_meta_data->>'countryCode',new.raw_user_meta_data->>'country_code','+965')) end;
    else full_phone:=private.canonical_phone(new.phone,new.country_code);
    end if;
    dial:=coalesce('+'||substring(full_phone from 2 for 3),'+965');
    update public.customers set name=coalesce(nullif(trim(person.raw_user_meta_data->>'name'),''),name),
      phone=substring(full_phone from 5),country_code=dial,
      email=case when person.email_confirmed_at is not null then person.email else email end
      where id=customer;
    -- The nested customer trigger deliberately skips recursion; update the other
    -- compatibility source here so changing a barber phone also changes Settings.
    update auth.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('phone',coalesce(full_phone,''),'countryCode',dial),
      phone=case when phone is null then null else ltrim(full_phone,'+') end where id=person.id
      and (raw_user_meta_data->>'phone' is distinct from coalesce(full_phone,'') or (phone is not null and phone is distinct from ltrim(full_phone,'+')));
    update public.barbers set phone=substring(full_phone from 5),country_code=dial,email=person.email
      where user_id=person.id and not manager_chair
        and (phone,country_code,email) is distinct from (substring(full_phone from 5),dial,person.email);
  end if;
  return null;
end;
$$;
revoke all on function private.sync_personal_work_contact() from public,anon,authenticated,service_role;
create or replace trigger sync_personal_work_contact after update of raw_user_meta_data,phone,email,email_confirmed_at on auth.users
for each row execute function private.sync_personal_work_contact();
create or replace trigger sync_personal_work_contact after update of phone,country_code,email on public.barbers
for each row execute function private.sync_personal_work_contact();
create or replace trigger sync_personal_work_contact after update of name,phone,country_code,email on public.customers
for each row execute function private.sync_personal_work_contact();

create or replace function private.prevent_personal_self_booking() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.customer_accounts a join public.barbers b on b.user_id=a.user_id
    where a.customer_id=new.customer_id and b.id=new.barber_id) then raise exception 'SELF_BOOKING_NOT_ALLOWED'; end if;
  return new;
end;
$$;
revoke all on function private.prevent_personal_self_booking() from public,anon,authenticated,service_role;
create or replace trigger prevent_personal_self_booking before insert or update of customer_id,barber_id on public.bookings
for each row execute function private.prevent_personal_self_booking();

create or replace function private.link_staff_customer_booking_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'authenticated'
    or coalesce(auth.jwt()->'app_metadata'->>'role','') not in ('admin','manager','barber','agent') then return null; end if;
  insert into private.customer_booking_owners(booking_id,account_user_id)
    select new.id,a.user_id from private.customer_accounts a join auth.users u on u.id=a.user_id
    join public.customers c on c.id=a.customer_id
    where a.customer_id=new.customer_id and c.status='active'
      and u.raw_app_meta_data->>'role' in ('customer','manager','barber') and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
    on conflict(booking_id) do nothing;
  return null;
end;
$$;

commit;
