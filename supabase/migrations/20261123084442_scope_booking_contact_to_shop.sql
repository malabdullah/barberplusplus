begin;
set local lock_timeout='5s';

create function public.staff_customer_lookup(p_country_code text,p_phone text,p_branch_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text:=private.live_staff_role(); e164 text; contact public.customers%rowtype;
begin
  if role_name is null or p_branch_id is null or not (
    role_name in ('admin','agent')
    or (role_name='manager' and exists(select 1 from public.branches where id=p_branch_id and manager_id=auth.uid()))
    or (role_name='barber' and exists(select 1 from public.barbers where branch_id=p_branch_id and user_id=auth.uid() and not manager_chair))
  ) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-contact-rate:'||auth.uid(),0));
  if (select count(*) from public.logs where user_id=auth.uid() and action='customer_lookup' and created_at>now()-interval '1 minute')>=30
  then raise exception 'RATE_LIMITED'; end if;
  e164:=private.canonical_phone(p_phone,p_country_code);
  if e164 is null or e164 !~ '^\+(965[569][0-9]{7}|9665[0-9]{8}|9715[0-9]{8}|973[0-9]{8}|974[3567][0-9]{7}|968[79][0-9]{7})$'
  then raise exception 'INVALID_PHONE'; end if;
  insert into public.logs(user_id,user_role,level,log_type,action,entity_type,message)
    values(auth.uid(),role_name,'info','action','customer_lookup','customer','Exact contact lookup');
  select c.* into contact from public.customers c
  where c.country_code=p_country_code and c.phone=substring(e164 from length(p_country_code)+1)
    and (role_name in ('admin','agent') or exists(
      select 1 from public.bookings b where b.customer_id=c.id and b.branch_id=p_branch_id
      and (role_name='manager' or exists(select 1 from public.barbers r where r.id=b.barber_id and r.user_id=auth.uid() and not r.manager_chair))
    ));
  if contact.id is null then return null; end if;
  if contact.status<>'active' then raise exception 'CUSTOMER_UNAVAILABLE'; end if;
  return jsonb_build_object('id',contact.id,'name',contact.name,'country_code',contact.country_code,'phone',contact.phone);
end
$$;
revoke all on function public.staff_customer_lookup(text,text,uuid) from public,anon;
grant execute on function public.staff_customer_lookup(text,text,uuid) to authenticated,service_role;

-- Older forms have no shop parameter. Infer it only when unambiguous.
create or replace function public.staff_customer_lookup(p_country_code text,p_phone text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text:=private.live_staff_role(); shop_ids uuid[];
begin
  if role_name is null then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if role_name='manager' then
    shop_ids:=array(select distinct id from public.branches where manager_id=auth.uid() limit 2);
  elsif role_name='barber' then
    shop_ids:=array(select distinct branch_id from public.barbers where user_id=auth.uid() and not manager_chair limit 2);
  else
    shop_ids:=array(select id from public.branches order by id limit 1);
  end if;
  if cardinality(shop_ids)=1 then
    return public.staff_customer_lookup(p_country_code,p_phone,shop_ids[1]);
  end if;
  return null;
end
$$;
-- Staff can edit the appointment without promoting its unverified guest
-- contact into the canonical phone registry or changing its customer.
do $migration$
declare definition text:=pg_get_functiondef('private.staff_save_booking(uuid,jsonb)'::regprocedure); updated text;
begin
  updated:=replace(definition,
    $old$ contact:=private.staff_contact(p_data->>'customer_country_code',p_data->>'customer_phone',p_data->>'customer_name');$old$,
    $new$ if p_id is not null and exists(select 1 from private.customer_booking_email_context x where x.booking_id=p_id and x.guest) then
   select jsonb_build_object('id',c.id,'name',c.name,'country_code',c.country_code,
     'phone',coalesce(c.booking_contact_phone,c.phone)) into contact
   from public.customers c where c.id=result.customer_id and c.status='active';
 else
   contact:=private.staff_contact(p_data->>'customer_country_code',p_data->>'customer_phone',p_data->>'customer_name');
 end if;$new$);
  if definition=updated then raise exception 'Staff booking contact function changed'; end if;
  execute updated;
end $migration$;
notify pgrst,'reload schema';
commit;
