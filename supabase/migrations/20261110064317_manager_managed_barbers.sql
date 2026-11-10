begin;

alter table public.barbers add column management_mode text not null default 'account'
 check(management_mode in('account','managed'));
alter table public.barbers add constraint managed_barber_has_no_account
 check(management_mode<>'managed' or (user_id is null and not manager_chair and email is null));
alter table private.shop_barber_invitations add column managed_barber_id uuid references public.barbers(id);
create unique index shop_barber_one_managed_invitation on private.shop_barber_invitations(managed_barber_id)
 where status='pending' and managed_barber_id is not null;

create function private.managed_barber_manager(p_shop uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.invitation_live(auth.uid(),nullif(auth.jwt()->>'session_id','')::uuid,'manager')
  and exists(select 1 from public.branches where id=p_shop and manager_id=auth.uid());
$$;
revoke all on function private.managed_barber_manager(uuid) from public,anon,authenticated,service_role;

do $avatar$
declare definition text:=pg_get_functiondef('public.can_write_avatar_object(text)'::regprocedure); updated text;
begin
 updated:=replace(definition,'select auth.uid() is not null and private.live_staff_role() is not null',
  $predicate$select auth.uid() is not null and private.live_staff_role() is not null
   and coalesce((select private.managed_barber_manager(b.branch_id) from public.barbers b
    where b.management_mode='managed' and b.id::text=left(split_part(object_name,'/',2),36)
     and split_part(object_name,'/',1)='barbers'),true)$predicate$);
 if updated=definition then raise exception 'Avatar ownership contract changed';end if;
 execute updated;
end $avatar$;

-- Caller identity is derived from the live Auth session; client role claims do
-- not grant management. These guards cover direct writes and existing RPCs.
create function private.guard_managed_barber() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.barbers%rowtype; role_name text:=private.live_staff_role();
begin
 if tg_op='DELETE' then b:=old;else b:=new;end if;
 if b.management_mode='managed' or (tg_op='UPDATE' and old.management_mode='managed') then
  if auth.uid() is not null and coalesce(auth.jwt()->>'role','')='authenticated' then
   if private.managed_barber_manager(b.branch_id) is not true
    or (tg_op='UPDATE' and (new.branch_id,new.user_id,new.management_mode) is distinct from (old.branch_id,old.user_id,old.management_mode)) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
   end if;
  end if;
  if tg_op<>'DELETE' then
   if length(trim(coalesce(new.name,''))) not between 2 and 120 or length(coalesce(new.name_ar,''))>120 then raise exception 'INVALID_NAME';end if;
   new.name:=trim(new.name);
   if new.management_mode='managed' then
    if new.email is not null or new.user_id is not null or new.manager_chair then raise exception 'MANAGED_BARBER_NO_ACCOUNT';end if;
    new.invite_status:='managed';
    if new.status='active' and not exists(select 1 from public.services where id=any(new.service_ids) and branch_id=new.branch_id and status='active') then raise exception 'BARBER_SERVICES_REQUIRED';end if;
    if new.status='active' and (new.availability_approved_at is null or not exists(select 1 from jsonb_each(coalesce(new.availability,'{}')) d where coalesce(d.value->>'enabled',d.value->>'available')='true')) then raise exception 'BARBER_HOURS_REQUIRED';end if;
    if nullif(trim(coalesce(new.phone,'')),'') is null then new.phone:=null;end if;
   end if;
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.guard_managed_barber() from public,anon,authenticated,service_role;
create trigger a0_managed_barber before insert or update or delete on public.barbers
 for each row execute function private.guard_managed_barber();

create function private.guard_managed_booking_access() returns trigger
language plpgsql security definer set search_path='' as $$
declare ids uuid[]; role_name text:=private.live_staff_role();
begin
 if tg_op='INSERT' then ids:=array[new.barber_id];elsif tg_op='DELETE' then ids:=array[old.barber_id];else ids:=array[old.barber_id,new.barber_id];end if;
 if auth.uid() is not null and coalesce(auth.jwt()->>'role','')='authenticated' and exists(
  select 1 from public.barbers b join public.branches s on s.id=b.branch_id
  where b.id=any(ids) and b.management_mode='managed' and (private.managed_barber_manager(s.id) is not true)
 ) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.guard_managed_booking_access() from public,anon,authenticated,service_role;
create trigger a0_managed_booking_access before insert or update or delete on public.bookings
 for each row execute function private.guard_managed_booking_access();

create or replace function private.require_barber_invitation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not new.manager_chair and new.management_mode<>'managed' and auth.uid() is not null and private.live_staff_role()='manager' then
  raise exception 'INVITATION_REQUIRED' using errcode='42501';
 end if;return new;
end $$;

create function public.create_managed_barber(p_shop uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.barbers%rowtype; ids uuid[]; profile_id uuid:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
begin
 if private.managed_barber_manager(p_shop) is not true then
  raise exception 'NOT_AUTHORIZED' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('managed-barber:'||profile_id::text,0));
 select * into b from public.barbers where id=profile_id;
 if b.id is not null then
  if b.branch_id<>p_shop or b.management_mode<>'managed' then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  return to_jsonb(b);
 end if;
 if jsonb_typeof(p_data) is distinct from 'object' or length(trim(coalesce(p_data->>'name',''))) not between 2 and 120
  or length(coalesce(p_data->>'name_ar',''))>120 then raise exception 'INVALID_NAME';end if;
 if p_data ? 'service_ids' and jsonb_typeof(p_data->'service_ids')<>'array' then raise exception 'INVALID_SERVICE_ASSIGNMENT';end if;
 ids:=array(select jsonb_array_elements_text(coalesce(p_data->'service_ids','[]'))::uuid);
 if cardinality(ids)>200 or cardinality(ids)<>(select count(distinct id) from unnest(ids) id) or exists(
  select 1 from unnest(ids) x(id) left join public.services s on s.id=x.id where s.id is null or s.branch_id<>p_shop or s.status<>'active'
 ) then raise exception 'INVALID_SERVICE_ASSIGNMENT';end if;
 insert into public.barbers(id,branch_id,name,name_ar,country_code,phone,status,service_ids,management_mode,invite_status,availability,availability_approved_at)
 values(profile_id,p_shop,trim(p_data->>'name'),coalesce(p_data->>'name_ar',''),coalesce(p_data->>'country_code','+965'),nullif(trim(p_data->>'phone'),''),'inactive',ids,'managed','managed','{}',null)
 returning * into b;
 return to_jsonb(b);
end $$;
revoke all on function public.create_managed_barber(uuid,jsonb) from public,anon,service_role;
grant execute on function public.create_managed_barber(uuid,jsonb) to authenticated;

create or replace function private.guard_barber_confirmation_preference() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor text:=private.live_staff_role();
begin
 if tg_op='UPDATE' and new.auto_confirm_bookings is not distinct from old.auto_confirm_bookings then return new;end if;
 if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then return new;end if;
 if new.management_mode='managed' and private.managed_barber_manager(new.branch_id) then return new;end if;
 if actor is null or new.user_id is distinct from auth.uid() or (tg_op='UPDATE' and (old.user_id is distinct from auth.uid() or new.branch_id is distinct from old.branch_id))
  or not (actor='barber' and not new.manager_chair or actor='manager' and new.manager_chair and exists(select 1 from public.branches where id=new.branch_id and manager_id=auth.uid())) then
  raise exception 'NOT_AUTHORIZED' using errcode='42501';
 end if;
 return new;
end $$;

create or replace function public.set_barber_auto_confirm(p_barber_id uuid,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.barbers%rowtype; actor text:=private.live_staff_role();
begin
 if p_enabled is null then raise exception 'INVALID_REQUEST';end if;
 select * into b from public.barbers where id=p_barber_id for update;
 if actor is null or (
  b.management_mode='managed' and private.managed_barber_manager(b.branch_id)
  or b.management_mode='account' and b.user_id=auth.uid() and (actor='barber' and not b.manager_chair
   or actor='manager' and b.manager_chair and exists(select 1 from public.branches where id=b.branch_id and manager_id=auth.uid()))
 ) is not true then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 update public.barbers set auto_confirm_bookings=p_enabled where id=b.id;
 return jsonb_build_object('auto_confirm_bookings',p_enabled);
end $$;

-- A later invitation may link only this exact managed profile. No phone-number
-- lookup alone grants an account access to any existing barber or its history.
create function private.managed_invitation_phone_available(p_barber uuid,p_phone text) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from private.phone_numbers n where n.phone=p_phone and not(
  n.owner_key='barber:'||p_barber::text and n.customer_user_id is null and n.customer_record_id is null
  and exists(select 1 from public.barbers b where b.id=p_barber and b.management_mode='managed' and b.user_id is null)
 ));
$$;
revoke all on function private.managed_invitation_phone_available(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.shop_barber_invitation_api(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $invitation_recovery$
declare
 actor uuid:=nullif(p_data->>'actor','')::uuid; sid uuid:=nullif(p_data->>'session','')::uuid;
 shop_id uuid:=nullif(p_data->>'branch_id','')::uuid; invite_id uuid:=nullif(p_data->>'id','')::uuid;
 mail text:=lower(trim(p_data->>'email')); person auth.users%rowtype; shop public.branches%rowtype;
 inv private.shop_barber_invitations%rowtype; profile public.customers%rowtype;
 target public.barbers%rowtype; target_id uuid:=nullif(p_data->>'managed_barber_id','')::uuid;
 chair public.barbers%rowtype; uid uuid; label text; full_phone text; dial text; skip_count integer;
 actual_hash text:=p_data->>'token_hash'; password text:=p_data->>'password';
begin
 if p_action in('check','send','resend','cancel','list') then
  if not private.invitation_live(actor,sid,'manager') then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
  if invite_id is not null then
   select * into inv from private.shop_barber_invitations where id=invite_id for update;
   if inv.id is null or inv.manager_id<>actor then raise exception 'FORBIDDEN' using errcode='42501';end if;
   shop_id:=inv.branch_id;target_id:=inv.managed_barber_id;
  end if;
  select * into shop from public.branches where id=shop_id and manager_id=actor for share;
  if shop.id is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if target_id is not null then
   select * into target from public.barbers where id=target_id and branch_id=shop.id and management_mode='managed' and user_id is null and not manager_chair for update;
   if target.id is null then raise exception 'MANAGED_BARBER_UNAVAILABLE';end if;
  end if;
  if p_action='list' then
   skip_count:=greatest(0,least(coalesce((p_data->>'offset')::integer,0),10000));
   return jsonb_build_object('invitations',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,email,status,delivery,generation,expires_at,created_at,sent_at,accepted_at,barber_id,managed_barber_id
    from private.shop_barber_invitations where branch_id=shop.id and manager_id=actor
    order by created_at desc,id desc limit 11 offset skip_count) x));
  end if;
  if p_action='cancel' then
   if inv.status<>'pending' then raise exception 'INVITE_USED';end if;
   update private.shop_barber_invitations set status='cancelled' where id=inv.id;
   return jsonb_build_object('success',true);
  end if;
  if p_action='resend' then
   if inv.status<>'pending' then raise exception 'INVITE_USED';end if;
   if inv.sent_at>clock_timestamp()-interval '1 minute' and inv.delivery<>'failed' then raise exception 'RATE_LIMITED';end if;
   mail:=inv.email;
  end if;
  if mail is null or length(mail)>254 or mail !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then raise exception 'INVALID_EMAIL';end if;
  perform pg_advisory_xact_lock(hashtextextended('shop-invitation:'||mail,0));
  select * into person from auth.users where lower(email)=mail and deleted_at is null;
  if person.id is not null then
   if person.raw_app_meta_data->>'role'<>'customer' or person.raw_app_meta_data->>'role' is null
    or (person.banned_until is not null and person.banned_until>now()) then raise exception 'EMAIL_UNAVAILABLE';end if;
   if private.invitation_setup_identity(person.id) then
    if p_action='check' then return jsonb_build_object('kind','new');end if;
   else
    if p_action='check' then return jsonb_build_object('kind','customer');end if;
    if p_action='send' and coalesce((p_data->>'confirm_customer')::boolean,false) is not true then raise exception 'CUSTOMER_CONFIRMATION_REQUIRED';end if;
   end if;
  elsif p_action='check' then return jsonb_build_object('kind','new');end if;
  if actual_hash is null or actual_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REQUEST';end if;
  if p_action='send' then
   update private.shop_barber_invitations set status='cancelled' where branch_id=shop.id and email=mail and status='pending' and manager_id<>actor;
   if exists(select 1 from private.shop_barber_invitations where branch_id=shop.id and email=mail and status='pending') then raise exception 'INVITE_EXISTS';end if;
   if (select count(*) from private.shop_barber_invitations where manager_id=actor and created_at>now()-interval '1 hour')>=30 then raise exception 'RATE_LIMITED';end if;
   if target_id is not null and exists(select 1 from private.shop_barber_invitations where managed_barber_id=target_id and status='pending') then raise exception 'INVITE_EXISTS';end if;
   insert into private.shop_barber_invitations(branch_id,manager_id,email,token_hash,managed_barber_id) values(shop.id,actor,mail,actual_hash,target_id) returning * into inv;
  else
   if inv.generation>=20 then raise exception 'RATE_LIMITED';end if;
   update private.shop_barber_invitations set token_hash=actual_hash,delivery='sending',generation=generation+1,expires_at=clock_timestamp()+interval '7 days',sent_at=clock_timestamp() where id=inv.id returning * into inv;
  end if;
  insert into public.logs(level,log_type,user_id,user_role,action,entity_type,entity_id,message) values('info','action',actor,'manager','invite','barber',inv.id,'Barber invitation issued');
  return jsonb_build_object('id',inv.id,'email',inv.email,'shop',shop.name,'expires_at',inv.expires_at,'generation',inv.generation);
 elsif p_action='delivery' then
  if p_data->>'delivery' not in('sent','failed') then raise exception 'INVALID_REQUEST';end if;
  update private.shop_barber_invitations set delivery=p_data->>'delivery' where id=invite_id and token_hash=actual_hash and status='pending';
  return jsonb_build_object('success',true);
 elsif p_action not in('resolve','accept') then raise exception 'INVALID_REQUEST';
 end if;
 if actual_hash is null or actual_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVITE_INVALID';end if;
 select * into inv from private.shop_barber_invitations where id=invite_id for update;
 if inv.id is null or inv.token_hash<>actual_hash then raise exception 'INVITE_INVALID';end if;
 select * into shop from public.branches where id=inv.branch_id and manager_id=inv.manager_id for share;
 if shop.id is null then raise exception 'INVITE_INVALID';end if;
 if inv.status='accepted' then raise exception 'INVITE_USED';end if;
 if inv.status='cancelled' then raise exception 'INVITE_CANCELLED';end if;
 if inv.expires_at<=clock_timestamp() then raise exception 'INVITE_EXPIRED';end if;
 target_id:=inv.managed_barber_id;
 if target_id is not null then
  select * into target from public.barbers where id=target_id and branch_id=inv.branch_id and management_mode='managed' and user_id is null and not manager_chair for update;
  if target.id is null then raise exception 'MANAGED_BARBER_UNAVAILABLE';end if;
 end if;
 select * into person from auth.users where lower(email)=inv.email and deleted_at is null;
 if person.id is not null and (person.raw_app_meta_data->>'role' is distinct from 'customer' or (person.banned_until is not null and person.banned_until>now())) then raise exception 'EMAIL_UNAVAILABLE';end if;
 if p_action='resolve' then
  if person.id is null and p_data ? 'phone' and not private.managed_invitation_phone_available(target_id,private.canonical_phone(p_data->>'phone',p_data->>'country_code')) then raise exception 'PHONE_IN_USE';end if;
  if person.id is not null and private.invitation_live(actor,sid,'customer') and actor=person.id then
   select c.* into profile from public.customers c join private.customer_accounts a on a.customer_id=c.id where a.user_id=person.id;
  end if;
  return jsonb_build_object('id',inv.id,'email',inv.email,'shop',shop.name,'expires_at',inv.expires_at,
   'kind',case when person.id is null or private.invitation_setup_identity(person.id) then 'new' else 'customer' end,
   'setup_user',case when private.invitation_setup_identity(person.id) then person.id else null end,
   'signed_in',coalesce(actor=person.id and private.invitation_live(actor,sid,'customer'),false),'name',profile.name,'phone',profile.phone,'country_code',profile.country_code);
 end if;

 -- Match the canonical contact write lock order: customer first, then Auth.
 if person.id is not null then
  select c.* into profile from public.customers c join private.customer_accounts a on a.customer_id=c.id where a.user_id=person.id for update of c;
  select * into person from auth.users where id=person.id and deleted_at is null for update;
  if person.id is null or lower(person.email)<>inv.email or person.raw_app_meta_data->>'role' is distinct from 'customer' or (person.banned_until is not null and person.banned_until>now()) then raise exception 'ACCOUNT_CHANGED';end if;
 end if;
 uid:=nullif(p_data->>'new_user','')::uuid;
 if person.id is null then raise exception 'AUTH_REQUIRED';end if;
 if uid is not null then
  if person.id<>uid or person.email_confirmed_at is not null or not private.invitation_setup_identity(person.id) then raise exception 'ACCOUNT_CHANGED';end if;
  if password is null or length(password)<8 or octet_length(password)>72 or person.encrypted_password='' or extensions.crypt(password,person.encrypted_password) is distinct from person.encrypted_password then raise exception 'INVALID_LOGIN';end if;
 else
  if actor is distinct from person.id or not private.invitation_live(actor,sid,'customer') then raise exception 'AUTH_REQUIRED';end if;
  select c.* into profile from public.customers c join private.customer_accounts a on a.customer_id=c.id where a.user_id=person.id for update of c;
 end if;
 if exists(select 1 from public.barbers where user_id=person.id) then raise exception 'EMAIL_UNAVAILABLE';end if;
 label:=coalesce(nullif(trim(profile.name),''),nullif(trim(p_data->>'name'),''));
 full_phone:=coalesce(private.canonical_phone(profile.phone,profile.country_code),private.canonical_phone(p_data->>'phone',p_data->>'country_code'));
 if length(coalesce(label,'')) not between 2 and 120 then raise exception 'INVALID_NAME';end if;
 if full_phone is null or full_phone !~ '^\+(965[569][0-9]{7}|9665[0-9]{8}|9715[0-9]{8}|973[0-9]{8}|974[3567][0-9]{7}|968[79][0-9]{7})$' then raise exception 'INVALID_PHONE';end if;

 dial:='+'||substring(full_phone from 2 for 3);
 -- Email invitation plus accepting account authorizes reclassifying only the
 -- exact target profile's optional number; it never matches unrelated contacts.
 if target.id is not null then
  perform pg_advisory_xact_lock(hashtextextended('barber-phone:'||full_phone,0));
  update private.phone_numbers set owner_key='user:'||person.id::text,customer_user_id=person.id
   where phone=full_phone and owner_key='barber:'||target.id::text and customer_user_id is null and customer_record_id is null;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('barber-phone:'||full_phone,0));
 -- Reclassify only the same canonical person. No number matching can attach
 -- another customer record, and uniqueness guards remain enabled throughout.
 update private.phone_numbers set owner_key='user:'||person.id::text,customer_user_id=person.id
 where phone=full_phone and owner_key='customer'
 and (customer_user_id=person.id or customer_record_id=profile.id);
 if profile.id is not null and profile.phone is null then update public.customers set phone=substring(full_phone from 5),country_code=dial where id=profile.id;end if;
 -- Email-token possession plus the new password authorize confirmation. Existing
 -- accounts require their own live session. No account is deleted or merged.
 update auth.users set raw_app_meta_data=(raw_app_meta_data-'invitation_setup')||jsonb_build_object('role','barber'),
  raw_user_meta_data=raw_user_meta_data||jsonb_build_object('name',label,'phone',full_phone),
  email_confirmed_at=coalesce(email_confirmed_at,clock_timestamp()),confirmation_token='',updated_at=clock_timestamp() where id=person.id;
 if target.id is not null then
  update public.barbers set management_mode='account',user_id=person.id,email=inv.email,country_code=dial,phone=substring(full_phone from 5),
   invite_status='accepted',invite_sent_at=inv.sent_at,invite_accepted_at=clock_timestamp() where id=target.id returning * into chair;
 else
 insert into public.barbers(user_id,branch_id,name,email,country_code,phone,status,service_ids,availability,time_offs,vacations,invite_status,invite_sent_at,invite_accepted_at,availability_approved_at)
 values(person.id,inv.branch_id,label,inv.email,dial,substring(full_phone from 5),'inactive','{}','{}','[]','[]','accepted',inv.sent_at,clock_timestamp(),null) returning * into chair;
 end if;
 update private.shop_barber_invitations set status='accepted',accepted_at=clock_timestamp(),accepted_user_id=person.id,barber_id=chair.id where id=inv.id;
 insert into public.logs(level,log_type,user_id,user_role,action,entity_type,entity_id,message) values('info','action',person.id,'barber','accept_invite','barber',chair.id,'Barber invitation accepted');
 perform private.deliver_dashboard_notification(inv.id,inv.manager_id,inv.branch_id,'manager','barber_invite_accepted',chair.id,'barber',jsonb_build_object('barberId',chair.id,'barberName',label));
 return jsonb_build_object('accepted',true,'barber_id',chair.id);
end $invitation_recovery$;

create or replace function private.shop_publication_readiness(p_shop public.branches) returns jsonb
language sql stable security definer set search_path='' as $$
 with ready_services as (
  select s.* from public.services s where s.branch_id=p_shop.id and s.status='active'
    and length(trim(s.name))>0 and s.duration between 5 and 480 and s.price between 0 and 10000
 ), ready_barbers as (
  select b.id from public.barbers b left join auth.users u on u.id=b.user_id
  where b.branch_id=p_shop.id and b.status='active' and b.availability_approved_at is not null
    and (b.management_mode='managed' and b.user_id is null and not b.manager_chair
     or b.management_mode='account' and (b.invite_status is null or b.invite_status='accepted' or b.manager_chair)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
      and (b.manager_chair and u.id=p_shop.manager_id and u.raw_app_meta_data->>'role'='manager' or not b.manager_chair and u.raw_app_meta_data->>'role'='barber'))
    and exists(select 1 from ready_services s cross join lateral jsonb_each(b.availability) h(day,hours)
      where s.id=any(b.service_ids) and h.day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
        and h.hours->>'enabled'='true'
        and h.hours->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and h.hours->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and p_shop.working_hours->h.day->>'open' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and p_shop.working_hours->h.day->>'close' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and least(h.hours->>'end',p_shop.working_hours->h.day->>'close')::time
          - greatest(h.hours->>'start',p_shop.working_hours->h.day->>'open')::time >= make_interval(mins=>s.duration))
 )
 select jsonb_build_object('ready',p_shop.status='active' and length(trim(p_shop.name))>0
   and p_shop.governorate_id is not null and p_shop.area_id is not null
   and exists(select 1 from public.areas a where a.id=p_shop.area_id and a.governorate_id=p_shop.governorate_id)
   and private.valid_schedule(p_shop.working_hours,false) and exists(select 1 from ready_barbers),
   'ready_barbers',(select count(*) from ready_barbers));
$$;

notify pgrst,'reload schema';
commit;
