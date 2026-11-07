begin;
-- Explicit deny for missing staff role and original-assignment checks on staff edits.
create or replace function public.archive_service(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.services%rowtype;
begin
 select * into result from public.services where id=p_id for update;
 if result.id is null or not (coalesce(private.live_staff_role(),'')='admin' or coalesce(private.live_staff_role(),'')='manager' and result.branch_id in(select public.get_user_branch_ids())) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 update public.services set status='inactive' where id=p_id returning * into result;return to_jsonb(result);
end $$;

create or replace function private.staff_save_booking(p_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text:=private.live_staff_role(); shop uuid; result public.bookings%rowtype; contact jsonb; ids uuid[]; minutes integer; amount numeric;
begin
 if role_name is null then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or length(coalesce(p_data->>'notes',''))>500 then raise exception 'INVALID_BOOKING_DETAILS'; end if;
 shop:=nullif(p_data->>'branch_id','')::uuid;
 if not (role_name in ('admin','agent') or role_name='manager' and exists(select 1 from public.branches where id=shop and manager_id=auth.uid())
   or role_name='barber' and exists(select 1 from public.barbers where id=(p_data->>'barber_id')::uuid and branch_id=shop and user_id=auth.uid() and not manager_chair)) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_id is not null then
  select * into result from public.bookings where id=p_id and branch_id=shop for update;
  if role_name='barber' and not exists(select 1 from public.barbers where id=result.barber_id and user_id=auth.uid() and not manager_chair) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
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

create or replace function private.guard_booking_integrity() returns trigger
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
    where s.id is null or s.branch_id<>new.branch_id or ((lines_changed or new.barber_id is distinct from old.barber_id) and (s.status<>'active' or not x.id=any(r.service_ids)))) then raise exception 'INVALID_SERVICE_ASSIGNMENT'; end if;
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

create or replace function public.save_work_profile(p_name text,p_country_code text,p_phone text,p_avatar_url text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person auth.users%rowtype; e164 text; object_name text;
begin
 if private.live_staff_role() not in ('manager','barber') or private.live_staff_role() is null then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_name is null or length(trim(p_name)) not between 2 and 120 then raise exception 'INVALID_CUSTOMER_NAME'; end if;
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
commit;
