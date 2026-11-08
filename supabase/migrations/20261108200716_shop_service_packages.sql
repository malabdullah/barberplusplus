begin;

create table private.service_packages (
 id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id),
 name text not null check(length(trim(name)) between 1 and 120), name_ar text not null default '' check(length(name_ar)<=120),
 archived boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index service_packages_shop on private.service_packages(branch_id,archived,name,id);
create table private.package_services (
 package_id uuid not null references private.service_packages(id), service_id uuid not null references public.services(id),
 primary key(package_id,service_id)
);
create index package_services_service on private.package_services(service_id,package_id);
create table private.package_offers (
 id uuid primary key default gen_random_uuid(), package_id uuid not null references private.service_packages(id),
 name text not null, name_ar text not null default '', service_ids uuid[] not null check(cardinality(service_ids) between 2 and 10),
 price numeric(12,3) not null check(price>0 and price<=10000), starts_on date not null, ends_on date not null check(ends_on>=starts_on),
 paused boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index package_offers_period on private.package_offers(package_id,starts_on,ends_on);
alter table private.service_packages enable row level security;
alter table private.package_services enable row level security;
alter table private.package_offers enable row level security;
revoke all on private.service_packages,private.package_services,private.package_offers from public,anon,authenticated,service_role;
alter table public.bookings add column package_offer_id uuid references private.package_offers(id),add column package_snapshot jsonb;
create index bookings_package_offer on public.bookings(package_offer_id) where package_offer_id is not null;

create function private.package_window(p_offer uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o private.package_offers%rowtype;
begin
 select * into o from private.package_offers where id=p_offer;
 if o.id is null or p_date is null or p_date not between o.starts_on and o.ends_on then raise exception 'PACKAGE_DATE_UNAVAILABLE';end if;
 return jsonb_build_object('starts_on',o.starts_on,'ends_on',o.ends_on);
end $$;
revoke all on function private.package_window(uuid,date) from public,anon,authenticated,service_role;

create function private.package_quote(p_shop uuid,p_barber uuid,p_offer uuid,p_services uuid[],p_date date default null,p_existing uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.package_offers%rowtype;p private.service_packages%rowtype;r public.barbers%rowtype;minutes integer;amount numeric;lines jsonb;extras uuid[];prior public.bookings%rowtype;included uuid[];base_price numeric;today date:=(clock_timestamp() at time zone 'Asia/Kuwait')::date;
begin
 select * into o from private.package_offers where id=p_offer;
 select * into p from private.service_packages where id=o.package_id for share;
 select * into o from private.package_offers where id=p_offer for share;
 select * into r from public.barbers where id=p_barber and branch_id=p_shop and status='active' for share;
 if p_existing is not null then
  select * into prior from public.bookings where id=p_existing and branch_id=p_shop and package_offer_id=p_offer;
  if prior.id is null then raise exception 'INVALID_PACKAGE_SELECTION';end if;
 end if;
 if o.id is null or p.id is null or p.branch_id<>p_shop or (prior.id is null and (p.archived or o.paused or today not between o.starts_on and o.ends_on)) then raise exception 'PACKAGE_UNAVAILABLE';end if;
 included:=case when prior.id is null then o.service_ids else array(select jsonb_array_elements_text(prior.package_snapshot->'service_ids')::uuid) end;
 base_price:=case when prior.id is null then o.price else (prior.package_snapshot->>'price')::numeric end;
 if p_date is not null then perform private.package_window(o.id,p_date);end if;
 if r.id is null or coalesce(cardinality(p_services),0) not between 2 and 10 or not included<@p_services
  or not p_services<@coalesce(r.service_ids,'{}'::uuid[]) or cardinality(p_services)<>(select count(distinct x) from unnest(p_services) x) then raise exception 'INVALID_PACKAGE_SELECTION';end if;
 perform id from public.services where id=any(p_services) order by id for share;
 if (select count(*) from public.services where id=any(p_services) and branch_id=p_shop and status='active')<>cardinality(p_services) then raise exception 'PACKAGE_UNAVAILABLE';end if;
 extras:=array(select x from unnest(p_services) x where not x=any(included));
 select sum((line->>'duration')::integer),base_price+coalesce(sum((line->>'price')::numeric) filter(where id=any(extras)),0),jsonb_agg(line order by ord)
 into minutes,amount,lines from (select s.id,x.ord,coalesce((select j from jsonb_array_elements(coalesce(prior.service_snapshot,'[]')) j where j->>'id'=s.id::text limit 1),
 jsonb_build_object('id',s.id,'name',s.name,'name_ar',s.name_ar,'duration',s.duration,'price',s.price)) line
 from unnest(p_services) with ordinality x(id,ord) join public.services s on s.id=x.id) selected;
 if minutes not between 5 and 480 or amount>10000 then raise exception 'INVALID_PACKAGE_SELECTION';end if;
 return jsonb_build_object('duration',minutes,'price',amount,'services',lines,'package',jsonb_build_object('id',p.id,'offer_id',o.id,'name',coalesce(prior.package_snapshot->>'name',o.name),'name_ar',coalesce(prior.package_snapshot->>'name_ar',o.name_ar),'price',base_price,'service_ids',included,'extra_ids',extras,'starts_on',o.starts_on,'ends_on',o.ends_on));
end $$;
revoke all on function private.package_quote(uuid,uuid,uuid,uuid[],date,uuid) from public,anon,authenticated,service_role;

create function private.package_catalog(p_shop uuid,p_barber uuid,p_date date default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'package_id',p.id,'name',o.name,'name_ar',o.name_ar,'price',o.price,'starts_on',o.starts_on,'ends_on',o.ends_on,'service_ids',o.service_ids,
  'duration',(select sum(duration) from public.services where id=any(o.service_ids)),
  'regular_price',(select sum(price) from public.services where id=any(o.service_ids))) order by p.name,p.id),'[]')
 from private.service_packages p join private.package_offers o on o.package_id=p.id
 join public.barbers r on r.id=p_barber and r.branch_id=p.branch_id and r.status='active'
 where p.branch_id=p_shop and not p.archived and not o.paused
 and (clock_timestamp() at time zone 'Asia/Kuwait')::date between o.starts_on and o.ends_on
 and (p_date is null or p_date between o.starts_on and o.ends_on)
 and o.service_ids<@coalesce(r.service_ids,'{}'::uuid[])
 and (select count(*) from public.services where id=any(o.service_ids) and status='active' and branch_id=p_shop)=cardinality(o.service_ids)
 and (select sum(duration) from public.services where id=any(o.service_ids))<=480;
$$;
revoke all on function private.package_catalog(uuid,uuid,date) from public,anon,authenticated,service_role;
create function public.customer_package_catalog(p_shop uuid,p_barber uuid,p_date date default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.branches where id=p_shop and status='active' and publication_state='published') then private.package_catalog(p_shop,p_barber,p_date) else '[]'::jsonb end;
$$;
revoke all on function public.customer_package_catalog(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.customer_package_catalog(uuid,uuid,date) to service_role;
create function public.staff_package_catalog(p_shop uuid,p_barber uuid,p_date date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r text:=private.live_staff_role();
begin
 if r is null or not(r in('admin','agent') or r='manager' and exists(select 1 from public.branches where id=p_shop and manager_id=auth.uid())
 or r='barber' and exists(select 1 from public.barbers where id=p_barber and branch_id=p_shop and user_id=auth.uid() and not manager_chair)) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 return private.package_catalog(p_shop,p_barber,p_date);
end $$;
revoke all on function public.staff_package_catalog(uuid,uuid,date) from public,anon,service_role;
grant execute on function public.staff_package_catalog(uuid,uuid,date) to authenticated;

create function public.manage_service_packages(p_action text,p_shop uuid,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.live_staff_role(); p private.service_packages%rowtype;o private.package_offers%rowtype;ids uuid[];starts date;ends date;amount numeric;today date:=(clock_timestamp() at time zone 'Asia/Kuwait')::date;regular numeric;minutes integer;
begin
 if actor is null or not(actor='admin' or actor='manager' and exists(select 1 from public.branches where id=p_shop and manager_id=auth.uid())) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if p_action='list' then return jsonb_build_object('total',(select count(*) from private.service_packages where branch_id=p_shop and position(lower(trim(coalesce(p_data->>'search',''))) in lower(name||' '||name_ar))>0),
 'items',coalesce((select jsonb_agg(to_jsonb(x)) from(select p.*,
  array(select service_id from private.package_services where package_id=p.id order by service_id) service_ids,
  coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('duration',(select sum(duration) from public.services where id=any(o.service_ids)),
   'regular_price',(select sum(price) from public.services where id=any(o.service_ids)),
   'state',case when p.archived then 'archived' when o.paused then 'paused' when today<o.starts_on then 'scheduled' when today>o.ends_on then 'expired' else 'available' end) order by o.starts_on desc,o.id) from private.package_offers o where o.package_id=p.id),'[]') offers
 from private.service_packages p where p.branch_id=p_shop and position(lower(trim(coalesce(p_data->>'search',''))) in lower(p.name||' '||p.name_ar))>0
 order by p.name,p.id limit 20 offset greatest(0,least(coalesce((p_data->>'page')::integer,0),100000))*20)x),'[]'));
 end if;
 if p_action not in('save','republish','extend','pause','resume','archive') or p_action is null then raise exception 'INVALID_REQUEST';end if;
 if nullif(p_data->>'id','') is not null then
  perform pg_advisory_xact_lock(hashtextextended('service-package:'||(p_data->>'id'),0));
  select * into p from private.service_packages where id=(p_data->>'id')::uuid and branch_id=p_shop for update;
  if p.id is null then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 elsif p_action<>'save' then raise exception 'INVALID_REQUEST';end if;
 if p_action='archive' then update private.service_packages set archived=true,updated_at=now() where id=p.id;return jsonb_build_object('id',p.id);end if;
 if nullif(p_data->>'offer_id','') is not null then
  select * into o from private.package_offers where id=(p_data->>'offer_id')::uuid and package_id=p.id for update;
  if o.id is null then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 end if;
 if p_action in('pause','resume','extend') then
  if o.id is null then raise exception 'INVALID_REQUEST';end if;
  if p_action='extend' then
   ends:=(p_data->>'ends_on')::date;
   if ends is null or ends<=o.ends_on then raise exception 'PACKAGE_EXTENSION_INVALID';end if;
   if exists(select 1 from private.package_offers where package_id=p.id and id<>o.id and starts_on<=ends and ends_on>=o.starts_on) then raise exception 'PACKAGE_PERIOD_OVERLAP';end if;
   update private.package_offers set ends_on=ends,updated_at=now() where id=o.id;
  else update private.package_offers set paused=(p_action='pause'),updated_at=now() where id=o.id;end if;
  return jsonb_build_object('id',p.id,'offer_id',o.id);
 end if;
 starts:=(p_data->>'starts_on')::date;ends:=(p_data->>'ends_on')::date;amount:=(p_data->>'price')::numeric;
 ids:=array(select jsonb_array_elements_text(p_data->'service_ids')::uuid);
 if length(trim(coalesce(p_data->>'name',''))) not between 1 and 120 or length(coalesce(p_data->>'name_ar',''))>120
 or cardinality(ids) not between 2 and 10 or cardinality(ids)<>(select count(distinct x) from unnest(ids)x)
 or starts is null or ends is null or ends<starts or (o.id is null and starts<today) or amount is null or amount<=0 or amount>10000 or amount<>round(amount,3) then raise exception 'INVALID_PACKAGE';end if;
 perform id from public.services where id=any(ids) order by id for share;
 select sum(price),sum(duration) into regular,minutes from public.services where id=any(ids) and branch_id=p_shop and status='active';
 if (select count(*) from public.services where id=any(ids) and branch_id=p_shop and status='active')<>cardinality(ids) or minutes>480 or amount>regular then raise exception 'INVALID_PACKAGE';end if;
 if p.id is null then insert into private.service_packages(branch_id,name,name_ar) values(p_shop,trim(p_data->>'name'),coalesce(p_data->>'name_ar','')) returning * into p;
 else update private.service_packages set name=trim(p_data->>'name'),name_ar=coalesce(p_data->>'name_ar',''),archived=false,updated_at=now() where id=p.id;end if;
 if p_action='republish' then o.id:=null;end if;
 if exists(select 1 from private.package_offers where package_id=p.id and id is distinct from o.id and starts_on<=ends and ends_on>=starts) then raise exception 'PACKAGE_PERIOD_OVERLAP';end if;
 if o.id is not null and exists(select 1 from public.bookings where package_offer_id=o.id and date not between starts and ends) then raise exception 'PACKAGE_HAS_BOOKINGS';end if;
 delete from private.package_services where package_id=p.id;
 insert into private.package_services(package_id,service_id) select p.id,unnest(ids);
 if o.id is null then insert into private.package_offers(package_id,name,name_ar,service_ids,price,starts_on,ends_on)
  values(p.id,trim(p_data->>'name'),coalesce(p_data->>'name_ar',''),ids,amount,starts,ends) returning * into o;
 else update private.package_offers set name=trim(p_data->>'name'),name_ar=coalesce(p_data->>'name_ar',''),service_ids=ids,price=amount,starts_on=starts,ends_on=ends,updated_at=now() where id=o.id;end if;
 return jsonb_build_object('id',p.id,'offer_id',o.id);
end $$;
revoke all on function public.manage_service_packages(text,uuid,jsonb) from public,anon,service_role;
grant execute on function public.manage_service_packages(text,uuid,jsonb) to authenticated;

do $patch$
declare definition text:=pg_get_functiondef('private.guard_booking_integrity()'::regprocedure);updated text;
begin
 updated:=replace(definition,$old$kuwait_now timestamp:=$old$,$new$package_quote jsonb; kuwait_now timestamp:=$new$);
 if updated=definition then raise exception 'Package integration contract changed: private.guard_booking_integrity';end if;definition:=updated;
 updated:=replace(definition,$old$lines_changed:=tg_op='INSERT' or new.service_ids is distinct from old.service_ids;$old$,$new$lines_changed:=tg_op='INSERT' or new.service_ids is distinct from old.service_ids or new.package_offer_id is distinct from old.package_offer_id;$new$);
 if updated=definition then raise exception 'Package integration contract changed: private.guard_booking_integrity';end if;definition:=updated;
 updated:=replace(definition,$old$if tg_op='UPDATE' then new.service_snapshot:=old.service_snapshot; end if;$old$,$new$if tg_op='UPDATE' then new.service_snapshot:=old.service_snapshot;new.package_snapshot:=old.package_snapshot;end if;
 if new.package_offer_id is not null and (tg_op='INSERT' or new.date is distinct from old.date or new.package_offer_id is distinct from old.package_offer_id) then perform private.package_window(new.package_offer_id,new.date);end if;
 if not lines_changed then new.package_snapshot:=old.package_snapshot;end if;$new$);
 if updated=definition then raise exception 'Package integration contract changed: private.guard_booking_integrity';end if;definition:=updated;
 updated:=replace(definition,$old$  if auth.uid() is not null and coalesce(auth.jwt()->>'role','')='authenticated' and (new.duration is distinct from computed_duration or new.price is distinct from computed_price)$old$,$new$  if new.package_offer_id is not null then
   package_quote:=private.package_quote(new.branch_id,new.barber_id,new.package_offer_id,new.service_ids,new.date,case when tg_op='UPDATE' and new.package_offer_id=old.package_offer_id then old.id else null end);
   computed_duration:=(package_quote->>'duration')::integer;computed_price:=(package_quote->>'price')::numeric;snapshot:=package_quote->'services';new.package_snapshot:=package_quote->'package';
  else new.package_snapshot:=null;end if;
  if auth.uid() is not null and coalesce(auth.jwt()->>'role','')='authenticated' and (new.duration is distinct from computed_duration or new.price is distinct from computed_price)$new$);
 if updated=definition then raise exception 'Package integration contract changed: private.guard_booking_integrity';end if;definition:=updated;
 updated:=replace(definition,'new.customer_id,new.service_ids)','new.customer_id,new.service_ids,new.package_offer_id)');
 if updated=definition then raise exception 'Package booking change contract changed';end if;definition:=updated;
 updated:=replace(definition,'old.customer_id,old.service_ids)','old.customer_id,old.service_ids,old.package_offer_id)');
 if updated=definition then raise exception 'Package booking history contract changed';end if;definition:=updated;
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('private.staff_save_booking(uuid,jsonb)'::regprocedure);updated text;
begin
 updated:=replace(definition,$old$minutes integer; amount numeric;$old$,$new$minutes integer; amount numeric; offer uuid; quoted jsonb;$new$);
 if updated=definition then raise exception 'Package integration contract changed: private.staff_save_booking';end if;definition:=updated;
 updated:=replace(definition,$old$ if p_id is null then
  insert into public.bookings$old$,$new$ offer:=nullif(p_data->>'package_offer_id','')::uuid;
 if p_id is not null and not p_data?'package_offer_id' then offer:=result.package_offer_id;end if;
 if offer is not null then quoted:=private.package_quote(shop,(p_data->>'barber_id')::uuid,offer,ids,(p_data->>'date')::date,case when offer=result.package_offer_id then result.id else null end);minutes:=(quoted->>'duration')::integer;amount:=(quoted->>'price')::numeric;end if;
 if p_id is null then
  insert into public.bookings$new$);
 if updated=definition then raise exception 'Package integration contract changed: private.staff_save_booking';end if;definition:=updated;
 updated:=replace(definition,$old$insert into public.bookings(branch_id,barber_id,customer_id,service_ids,date,time,duration,price,status,notes,added_by_type,added_by_user_id)$old$,$new$insert into public.bookings(branch_id,barber_id,customer_id,service_ids,date,time,duration,price,status,notes,added_by_type,added_by_user_id,package_offer_id)$new$);
 if updated=definition then raise exception 'Package integration contract changed: private.staff_save_booking';end if;definition:=updated;
 updated:=replace(definition,$old$else role_name end,auth.uid()) returning * into result;$old$,$new$else role_name end,auth.uid(),offer) returning * into result;$new$);
 if updated=definition then raise exception 'Package integration contract changed: private.staff_save_booking';end if;definition:=updated;
 updated:=replace(definition,$old$if ids=result.service_ids then$old$,$new$if ids=result.service_ids and offer is not distinct from result.package_offer_id then$new$);
 if updated=definition then raise exception 'Package integration contract changed: private.staff_save_booking';end if;definition:=updated;
 updated:=replace(definition,$old$update public.bookings set barber_id=$old$,$new$update public.bookings set package_offer_id=offer,barber_id=$new$);
 if updated=definition then raise exception 'Package integration contract changed: private.staff_save_booking';end if;definition:=updated;
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure);updated text;
begin
 updated:=replace(definition,$old$  v_price numeric;$old$,$new$  v_price numeric;
  v_package jsonb;$new$);
 if updated=definition then raise exception 'Package integration contract changed: public.customer_booking';end if;definition:=updated;
 updated:=replace(definition,$old$    -- Only the authenticated appointment manager supplies this internal action.$old$,$new$    if nullif(p_data->>'package_offer_id','') is not null and p_action<>'appointment-slots' then
      v_package:=private.package_quote(v_branch.id,v_barber.id,(p_data->>'package_offer_id')::uuid,v_services,(p_data->>'date')::date);
      v_duration:=(v_package->>'duration')::integer;v_price:=(v_package->>'price')::numeric;
    end if;
    -- Only the authenticated appointment manager supplies this internal action.$new$);
 if updated=definition then raise exception 'Package integration contract changed: public.customer_booking';end if;definition:=updated;
 updated:=replace(definition,$old$      duration, price, status, notes, added_by_type)$old$,$new$      duration, price, status, notes, added_by_type,package_offer_id)$new$);
 if updated=definition then raise exception 'Package integration contract changed: public.customer_booking';end if;definition:=updated;
 updated:=replace(definition,$old$nullif(trim(p_data ->> 'notes'), ''), 'customer') returning$old$,$new$nullif(trim(p_data ->> 'notes'), ''), 'customer',nullif(p_data->>'package_offer_id','')::uuid) returning$new$);
 if updated=definition then raise exception 'Package integration contract changed: public.customer_booking';end if;definition:=updated;
 updated:=replace(definition,$old$'status', b.status, 'branch_name'$old$,$new$'package',b.package_snapshot,'status', b.status, 'branch_name'$new$);
 if updated=definition then raise exception 'Package integration contract changed: public.customer_booking';end if;definition:=updated;
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('private.customer_appointment_api(text,jsonb)'::regprocedure);updated text;
begin
 updated:=replace(definition,$old$    requested_time := (p_data->>'time')::time;$old$,$new$    requested_time := (p_data->>'time')::time;
    if target.package_offer_id is not null then perform private.package_window(target.package_offer_id,requested_date);end if;$new$);
 if updated=definition then raise exception 'Package integration contract changed: private.customer_appointment_api';end if;definition:=updated;
 execute definition;
end $patch$;

do $projection$
declare definition text:=pg_get_functiondef('public.customer_account_api(text,jsonb)'::regprocedure);updated text;
begin
 updated:=replace(definition,$old$'location_url',br.location_url,$old$,$new$'location_url', br.location_url,'package',case when b.package_offer_id is null then null else b.package_snapshot||coalesce((select jsonb_build_object('starts_on',starts_on,'ends_on',ends_on) from private.package_offers where id=b.package_offer_id),'{}') end,$new$);
 if updated=definition then raise exception 'Package history projection contract changed';end if;execute updated;
end $projection$;
notify pgrst,'reload schema';
commit;
