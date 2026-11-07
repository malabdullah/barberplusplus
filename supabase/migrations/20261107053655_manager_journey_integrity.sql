begin;

-- Keep snapshots of the purchased services, never duplicate customer contacts.
alter table public.bookings add column service_snapshot jsonb not null default '[]';
alter table public.services alter column price type numeric(12,3);
alter table public.bookings alter column price type numeric(12,3);
alter table public.branches alter column country set default 'Kuwait';
update public.branches set country='Kuwait' where governorate_id is not null and country='Saudi Arabia';
update public.bookings b set service_snapshot=coalesce((select jsonb_agg(jsonb_build_object(
  'id',s.id,'name',s.name,'name_ar',s.name_ar,'duration',s.duration,'price',s.price) order by x.ord)
  from unnest(b.service_ids) with ordinality x(id,ord) join public.services s on s.id=x.id),'[]');

create function private.live_staff_role() returns text
language sql stable security definer set search_path='' as $$
  select u.raw_app_meta_data->>'role' from auth.users u
  where u.id=auth.uid() and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    and u.raw_app_meta_data->>'role' in ('admin','manager','barber','agent')
    and (auth.jwt()->>'session_id' is null or exists(select 1 from auth.sessions s
      where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=u.id and (s.not_after is null or s.not_after>now())));
$$;
revoke all on function private.live_staff_role() from public,anon,authenticated,service_role;

create or replace function public.get_user_branch_ids() returns setof uuid
language sql stable security definer set search_path='' as $$
  select b.id from public.branches b where b.manager_id=auth.uid() and private.live_staff_role()='manager';
$$;
drop policy "Users can insert own branches" on public.branches;
drop policy "Users can update own branches" on public.branches;
drop policy "Users can delete own branches" on public.branches;
-- A definer predicate avoids exposing auth.users to the Data API role.
create function public.manager_can_create_shop() returns boolean
language sql stable security definer set search_path='' as $$ select private.live_staff_role()='manager'; $$;
revoke all on function public.manager_can_create_shop() from public,anon;
grant execute on function public.manager_can_create_shop() to authenticated;
create policy "Managers create own shops" on public.branches for insert to authenticated
  with check((select public.manager_can_create_shop()) and manager_id=(select auth.uid()));
create policy "Managers update own shops" on public.branches for update to authenticated
  using(id in(select public.get_user_branch_ids())) with check(manager_id=(select auth.uid()) and (select public.manager_can_create_shop()));
create policy "Managers delete own shops" on public.branches for delete to authenticated using(id in(select public.get_user_branch_ids()));

create function public.staff_can_read_customer(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case when private.live_staff_role() in ('admin','agent') then true
    when private.live_staff_role()='manager' then exists(select 1 from public.bookings b
      join public.branches s on s.id=b.branch_id where b.customer_id=p_id and s.manager_id=auth.uid())
    when private.live_staff_role()='barber' then exists(select 1 from public.bookings b
      join public.barbers r on r.id=b.barber_id where b.customer_id=p_id and r.user_id=auth.uid() and not r.manager_chair)
    else false end;
$$;
revoke all on function public.staff_can_read_customer(uuid) from public,anon;
grant execute on function public.staff_can_read_customer(uuid) to authenticated;
drop policy managers_barbers_agents_admins_select_customers on public.customers;
create policy staff_related_customers on public.customers for select to authenticated using((select public.staff_can_read_customer(id)));
drop policy staff_read_customer_details on public.customer_staff_details;
create policy staff_read_customer_details on public.customer_staff_details for select to authenticated using((select public.staff_can_read_customer(customer_id)));

-- Exact-number lookup is bounded and returns only the minimum booking contact.
create function private.staff_contact(p_code text,p_phone text,p_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text:=private.live_staff_role(); e164 text; c public.customers%rowtype;
begin
  if role_name not in ('manager','barber','admin','agent') or role_name is null then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  e164:=private.canonical_phone(p_phone,p_code);
  if e164 is null or e164 !~ '^\+(965[569][0-9]{7}|9665[0-9]{8}|9715[0-9]{8}|973[0-9]{8}|974[3567][0-9]{7}|968[79][0-9]{7})$' then raise exception 'INVALID_PHONE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('manager-contact:'||e164,0));
  select * into c from public.customers where country_code=p_code and phone=substring(e164 from length(p_code)+1);
  if c.id is null and p_name is not null then
    if length(trim(p_name)) not between 2 and 120 then raise exception 'INVALID_CUSTOMER_NAME'; end if;
    insert into public.customers(name,country_code,phone,created_by_type,created_by_user_id)
      values(trim(p_name),p_code,substring(e164 from length(p_code)+1),case when role_name='agent' then 'whatsapp_agent' else role_name end,auth.uid()) returning * into c;
  end if;
  if c.id is null then return null; end if;
  if c.status<>'active' then raise exception 'CUSTOMER_UNAVAILABLE'; end if;
  return jsonb_build_object('id',c.id,'name',c.name,'country_code',c.country_code,'phone',c.phone);
end $$;
revoke all on function private.staff_contact(text,text,text) from public,anon,authenticated,service_role;
create function public.staff_customer_lookup(p_country_code text,p_phone text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  -- Audit/rate-limit the precise lookup without logging the supplied number.
  if (select count(*) from public.logs where user_id=auth.uid() and action='customer_lookup' and created_at>now()-interval '1 minute')>=30 then raise exception 'RATE_LIMITED'; end if;
  if private.live_staff_role() is null then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  insert into public.logs(user_id,action,entity_type,message) values(auth.uid(),'customer_lookup','customer','Exact contact lookup');
  return private.staff_contact(p_country_code,p_phone,null);
end $$;
revoke all on function public.staff_customer_lookup(text,text) from public,anon;
grant execute on function public.staff_customer_lookup(text,text) to authenticated;

create function private.valid_schedule(p_data jsonb,p_barber boolean default false) returns boolean
language plpgsql immutable set search_path='' as $$
declare d record; enabled boolean; first_time text; last_time text;
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' then return false; end if;
 for d in select * from jsonb_each(p_data) loop
  if d.key not in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday') or jsonb_typeof(d.value)<>'object' then return false; end if;
  enabled:=case when p_barber then coalesce(d.value->>'enabled',d.value->>'available','false')='true' else nullif(d.value->>'open','') is not null end;
  if not enabled then continue; end if;
  first_time:=d.value->>case when p_barber then 'start' else 'open' end;
  last_time:=d.value->>case when p_barber then 'end' else 'close' end;
  if first_time is null or last_time is null or first_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or last_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or first_time>=last_time then return false; end if;
 end loop; return true;
end $$;
revoke all on function private.valid_schedule(jsonb,boolean) from public,anon,authenticated,service_role;

create function private.guard_manager_catalogue() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='services' then
  if tg_op='DELETE' then
   if exists(select 1 from public.bookings where old.id=any(service_ids)) then raise exception 'SERVICE_HAS_HISTORY'; end if;
   return old;
  end if;
  if length(trim(new.name)) not between 1 and 120 or new.duration not between 5 and 480 or new.price<0 or new.price>10000 then raise exception 'INVALID_SERVICE'; end if;
  new.name:=trim(new.name);
 elsif tg_table_name='branches' then
  if length(trim(new.name)) not between 1 and 120 or not private.valid_schedule(new.working_hours,false) then raise exception 'INVALID_SHOP_HOURS'; end if;
  if new.area_id is not null and not exists(select 1 from public.areas where id=new.area_id and governorate_id=new.governorate_id) then raise exception 'INVALID_SHOP_LOCATION'; end if;
  new.name:=trim(new.name);if new.governorate_id is not null then new.country:='Kuwait'; end if;
 else
  if not private.valid_schedule(coalesce(new.availability,'{}'),true) then raise exception 'INVALID_BARBER_HOURS'; end if;
  if exists(select 1 from unnest(new.service_ids) x(id) left join public.services s on s.id=x.id where s.id is null or s.branch_id<>new.branch_id) then raise exception 'INVALID_SERVICE_ASSIGNMENT'; end if;
  if new.status='active' and not new.manager_chair and (tg_op='INSERT' or (new.status,new.service_ids,new.availability) is distinct from (old.status,old.service_ids,old.availability)) then
   if not exists(select 1 from public.services where id=any(new.service_ids) and branch_id=new.branch_id and status='active') then raise exception 'BARBER_SERVICES_REQUIRED'; end if;
   if not exists(select 1 from jsonb_each(new.availability) d where coalesce(d.value->>'enabled',d.value->>'available')='true') then raise exception 'BARBER_HOURS_REQUIRED'; end if;
  end if;
 end if; return new;
end $$;
revoke all on function private.guard_manager_catalogue() from public,anon,authenticated,service_role;
create trigger validate_service before insert or update or delete on public.services for each row execute function private.guard_manager_catalogue();
create trigger validate_shop before insert or update on public.branches for each row execute function private.guard_manager_catalogue();
create trigger validate_barber before insert or update on public.barbers for each row execute function private.guard_manager_catalogue();

create function private.guard_booking_integrity() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.barbers%rowtype; shop public.branches%rowtype; dow text; hours jsonb; shop_hours jsonb;
  computed_duration integer; computed_price numeric; snapshot jsonb; changed boolean; lines_changed boolean; kuwait_now timestamp:=clock_timestamp() at time zone 'Asia/Kuwait';
begin
 lines_changed:=tg_op='INSERT' or new.service_ids is distinct from old.service_ids;
 changed:=tg_op='INSERT' or (new.branch_id,new.barber_id,new.date,new.time,new.duration,new.price,new.customer_id,new.service_ids) is distinct from
   (old.branch_id,old.barber_id,old.date,old.time,old.duration,old.price,old.customer_id,old.service_ids) or (old.status in ('cancelled','no_show') and new.status in ('pending','confirmed'));
 if tg_op='UPDATE' then new.service_snapshot:=old.service_snapshot; end if;
 if auth.uid() is not null and new.status='completed' and (tg_op='INSERT' or old.status<>'completed') and new.date+new.time+new.duration*interval '1 minute'>kuwait_now then raise exception 'BOOKING_NOT_FINISHED'; end if;
 -- Imports/fixture setup use the service role. Normal staff writes must satisfy the contract.
 if auth.uid() is not null and coalesce(auth.jwt()->>'role','')='authenticated' and changed then
  if private.live_staff_role() is null then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if new.customer_id is null or not exists(select 1 from public.customers where id=new.customer_id and status='active') then raise exception 'CUSTOMER_REQUIRED'; end if;
  if new.duration not between 5 and 480 or new.price<0 or new.price>10000 or cardinality(new.service_ids) not between 1 and 30 then raise exception 'INVALID_BOOKING_DETAILS'; end if;
  select * into r from public.barbers where id=new.barber_id for share;
  select * into shop from public.branches where id=new.branch_id for share;
  if r.id is null or r.branch_id<>new.branch_id or r.status<>'active' or shop.status<>'active' then raise exception 'SLOT_UNAVAILABLE'; end if;
  if exists(select 1 from unnest(new.service_ids) x(id) left join public.services s on s.id=x.id
    where s.id is null or s.branch_id<>new.branch_id or (lines_changed and (s.status<>'active' or not x.id=any(r.service_ids)))) then raise exception 'INVALID_SERVICE_ASSIGNMENT'; end if;
  if new.date+new.time<=kuwait_now or new.date>kuwait_now::date+r.max_booking_days then raise exception 'BOOKING_DATE_UNAVAILABLE'; end if;
  dow:=lower(trim(to_char(new.date,'day')));hours:=r.availability->dow;shop_hours:=shop.working_hours->dow;
  if coalesce(hours->>'enabled',hours->>'available','false')<>'true' or shop_hours->>'open' is null
    or new.time<(hours->>'start')::time or new.time+new.duration*interval '1 minute'>(hours->>'end')::time
    or new.time<(shop_hours->>'open')::time or new.time+new.duration*interval '1 minute'>(shop_hours->>'close')::time
    or (new.date+new.time+new.duration*interval '1 minute')::date<>new.date then raise exception 'SLOT_UNAVAILABLE'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(r.vacations,'[]')) v where new.date between (v->>'startDate')::date and (v->>'endDate')::date)
    or exists(select 1 from jsonb_array_elements(coalesce(r.time_offs,'[]')) t
      where ((t->>'type'='one-time' and t->>'date'=new.date::text) or (t->>'type'='recurring' and t->>'day'=dow))
      and tsrange(new.date+(t->>'start')::time,new.date+(t->>'end')::time,'[)') && tsrange(new.date+new.time,new.date+new.time+new.duration*interval '1 minute','[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
 end if;
 if lines_changed then
  select sum(s.duration),sum(s.price),jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'name_ar',s.name_ar,'duration',s.duration,'price',s.price) order by x.ord)
   into computed_duration,computed_price,snapshot from unnest(new.service_ids) with ordinality x(id,ord) join public.services s on s.id=x.id;
  if auth.uid() is not null and coalesce(auth.jwt()->>'role','')='authenticated' and (new.duration is distinct from computed_duration or new.price is distinct from computed_price) then raise exception 'INVALID_BOOKING_TOTALS'; end if;
  new.service_snapshot:=coalesce(snapshot,'[]');
 elsif changed and auth.uid() is not null and coalesce(auth.jwt()->>'role','')='authenticated' and (new.duration,new.price) is distinct from (old.duration,old.price) then raise exception 'INVALID_BOOKING_TOTALS';
 end if;
 return new;
end $$;
revoke all on function private.guard_booking_integrity() from public,anon,authenticated,service_role;
create trigger validate_booking_integrity before insert or update on public.bookings for each row execute function private.guard_booking_integrity();

create function private.staff_save_booking(p_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text:=private.live_staff_role(); shop uuid; result public.bookings%rowtype; contact jsonb; ids uuid[]; minutes integer; amount numeric;
begin
 if role_name is null then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 shop:=nullif(p_data->>'branch_id','')::uuid;
 if not (role_name in ('admin','agent') or role_name='manager' and exists(select 1 from public.branches where id=shop and manager_id=auth.uid())
   or role_name='barber' and exists(select 1 from public.barbers where id=(p_data->>'barber_id')::uuid and branch_id=shop and user_id=auth.uid() and not manager_chair)) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_id is not null then
  select * into result from public.bookings where id=p_id and branch_id=shop for update;
  if result.id is null or result.status not in ('pending','confirmed') then raise exception 'BOOKING_NOT_MANAGEABLE'; end if;
 end if;
 contact:=private.staff_contact(p_data->>'customer_country_code',p_data->>'customer_phone',p_data->>'customer_name');
 if contact is null then raise exception 'CUSTOMER_REQUIRED'; end if;
 if p_data->>'customer_id' is not null and (p_data->>'customer_id')::uuid is distinct from (contact->>'id')::uuid then raise exception 'CUSTOMER_CHANGED'; end if;
 ids:=array(select jsonb_array_elements_text(p_data->'service_ids')::uuid);
 select sum(s.duration),sum(s.price) into minutes,amount from unnest(ids) x(id) join public.services s on s.id=x.id;
 if p_id is null then
  insert into public.bookings(branch_id,barber_id,customer_id,service_ids,date,time,duration,price,status,notes,added_by_type,added_by_user_id)
   values(shop,(p_data->>'barber_id')::uuid,(contact->>'id')::uuid,ids,(p_data->>'date')::date,(p_data->>'time')::time,minutes,amount,'confirmed',nullif(trim(p_data->>'notes'),''),case when role_name='agent' then 'whatsapp_agent' else role_name end,auth.uid()) returning * into result;
 else
  if ids=result.service_ids then minutes:=result.duration;amount:=result.price;end if;
  update public.bookings set barber_id=(p_data->>'barber_id')::uuid,customer_id=(contact->>'id')::uuid,service_ids=ids,date=(p_data->>'date')::date,time=(p_data->>'time')::time,
    duration=minutes,price=amount,notes=nullif(trim(p_data->>'notes'),''),modified_by_type=case when role_name='agent' then 'whatsapp_agent' else role_name end,modified_by_user_id=auth.uid()
    where id=p_id returning * into result;
 end if;
 return to_jsonb(result)||jsonb_build_object('customer',contact);
end $$;
revoke all on function private.staff_save_booking(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.staff_save_booking(p_id uuid,p_data jsonb) returns jsonb
language sql security definer set search_path='' as $$ select private.staff_save_booking(p_id,p_data); $$;
revoke all on function public.staff_save_booking(uuid,jsonb) from public,anon;
grant execute on function public.staff_save_booking(uuid,jsonb) to authenticated;

-- Used-service deletion remains protected even from an alternative client.
create function public.archive_service(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.services%rowtype;
begin
 select * into result from public.services where id=p_id for update;
 if result.id is null or not (private.live_staff_role()='admin' or private.live_staff_role()='manager' and result.branch_id in(select public.get_user_branch_ids())) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 update public.services set status='inactive' where id=p_id returning * into result;return to_jsonb(result);
end $$;
revoke all on function public.archive_service(uuid) from public,anon;
grant execute on function public.archive_service(uuid) to authenticated;

create function public.save_work_profile(p_name text,p_country_code text,p_phone text,p_avatar_url text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person auth.users%rowtype; e164 text; object_name text;
begin
 if private.live_staff_role() not in ('manager','barber') or private.live_staff_role() is null then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if length(trim(p_name)) not between 2 and 120 then raise exception 'INVALID_CUSTOMER_NAME'; end if;
 e164:=private.canonical_phone(p_phone,p_country_code);
 if e164 is null or e164 !~ '^\+(965[569][0-9]{7}|9665[0-9]{8}|9715[0-9]{8}|973[0-9]{8}|974[3567][0-9]{7}|968[79][0-9]{7})$' then raise exception 'INVALID_PHONE'; end if;
 if p_avatar_url is not null then
  object_name:=substring(p_avatar_url from '/storage/v1/object/public/avatars/(.*)$');
  if object_name is null or object_name !~ ('^profiles/'||auth.uid()::text||'-[0-9]+\.(jpg|jpeg|png|webp|gif)$')
    or not exists(select 1 from storage.objects where bucket_id='avatars' and name=object_name) then raise exception 'INVALID_PROFILE_IMAGE'; end if;
 end if;
 update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}')||jsonb_build_object('name',trim(p_name),'phone',e164,'countryCode',p_country_code)
  ||case when p_avatar_url is null then '{}'::jsonb else jsonb_build_object('avatar_url',p_avatar_url) end
  where id=auth.uid() returning * into person;
 return person.raw_user_meta_data;
end $$;
revoke all on function public.save_work_profile(text,text,text,text) from public,anon;
grant execute on function public.save_work_profile(text,text,text,text) to authenticated;

create or replace function public.can_write_avatar_object(object_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.live_staff_role() is not null
 and object_name ~ '^(branches|barbers|profiles)/[0-9a-f-]{36}-[0-9]+\.(jpg|jpeg|png|webp|gif)$'
 and (private.live_staff_role()='admin'
  or split_part(object_name,'/',1)='profiles' and left(split_part(object_name,'/',2),36)=auth.uid()::text and private.live_staff_role() in ('manager','barber')
  or private.live_staff_role()='manager' and (
    split_part(object_name,'/',1)='branches' and exists(select 1 from public.branches b where b.id::text=left(split_part(object_name,'/',2),36) and b.manager_id=auth.uid())
    or split_part(object_name,'/',1)='barbers' and exists(select 1 from public.barbers b join public.branches s on s.id=b.branch_id where b.id::text=left(split_part(object_name,'/',2),36) and s.manager_id=auth.uid()))
  or private.live_staff_role()='barber' and split_part(object_name,'/',1)='barbers' and exists(select 1 from public.barbers where id::text=left(split_part(object_name,'/',2),36) and user_id=auth.uid()));
$$;

CREATE OR REPLACE FUNCTION private.customer_account_api(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        (select jsonb_agg(jsonb_build_object('name',x->>'name','name_ar',x->>'name_ar')) from jsonb_array_elements(b.service_snapshot) x) as services
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
  if p_action not in ('slots', 'book', 'appointment-slots') or p_action is null then
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
        select coalesce(jsonb_agg(to_char(s, 'HH24:MI') order by s), '[]'::jsonb) into v_slots
        from generate_series(v_date + v_start, v_date + v_end - v_duration * interval '1 minute', interval '15 minutes') s
        where s at time zone 'Asia/Kuwait' > current_timestamp
          and not exists (
            select 1 from public.bookings b where b.barber_id = v_barber.id and b.date = v_date
              and b.status not in ('cancelled','no_show')
              and (p_action<>'appointment-slots' or b.id is distinct from (p_data->>'exclude_booking_id')::uuid)
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
    if p_action in ('slots','appointment-slots') then
      return jsonb_build_object('slots', v_slots, 'duration', v_duration, 'price', v_price,
        'today', v_today, 'last_date', v_today + v_barber.max_booking_days,
        'booking_policy',public.shop_booking_policy(v_branch.id));
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
      v_duration, v_price, 'confirmed', nullif(trim(p_data ->> 'notes'), ''), 'customer') returning * into v_booking;
    if p_data ? 'booking_policy' and p_data->'booking_policy' is distinct from jsonb_build_object(
      'cancel_minutes',v_booking.cancel_notice_minutes,'reschedule_minutes',v_booking.reschedule_notice_minutes
    ) then raise exception 'BOOKING_POLICY_CHANGED'; end if;
  end if;
  if p_action = 'book' and nullif(p_data->>'account_user_id','') is not null then
    perform private.record_customer_booking_owner(v_booking.id, (p_data->>'account_user_id')::uuid, (p_data->>'session_id')::uuid);
  end if;
  return (
    select jsonb_build_object('id', b.id, 'reference', upper(left(replace(b.id::text, '-', ''), 10)),
      'date', b.date, 'time', to_char(b.date + b.time, 'HH24:MI'), 'duration', b.duration, 'price', b.price,
      'status', b.status, 'branch_name', br.name, 'branch_name_ar', br.name_ar,
      'barber_name', ba.name, 'barber_name_ar', ba.name_ar, 'address', br.address,
      'location_url', br.location_url, 'service_names', (select jsonb_agg(jsonb_build_object('name', x->>'name', 'name_ar', x->>'name_ar'))
        from jsonb_array_elements(b.service_snapshot) x))
    from public.bookings b join public.branches br on br.id = b.branch_id
      join public.barbers ba on ba.id = b.barber_id where b.id = v_booking.id
  );
end;
$function$;

commit;
