begin;
-- Replacement links can resume a server-marked, unconfirmed invitation identity
-- only with its original password. Never recreate or reset the identity.
create function private.invitation_setup_identity(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join private.shop_barber_invitations i
 on i.id::text=u.raw_app_meta_data->>'invitation_setup' and i.email=lower(u.email)
 where u.id=p_user and u.deleted_at is null and u.email_confirmed_at is null
 and u.raw_app_meta_data->>'role'='customer' and i.accepted_user_id is null);
$$;
revoke all on function private.invitation_setup_identity(uuid) from public,anon,authenticated,service_role;
create or replace function public.shop_barber_invitation_api(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $invitation_recovery$
declare
 actor uuid:=nullif(p_data->>'actor','')::uuid; sid uuid:=nullif(p_data->>'session','')::uuid;
 shop_id uuid:=nullif(p_data->>'branch_id','')::uuid; invite_id uuid:=nullif(p_data->>'id','')::uuid;
 mail text:=lower(trim(p_data->>'email')); person auth.users%rowtype; shop public.branches%rowtype;
 inv private.shop_barber_invitations%rowtype; profile public.customers%rowtype;
 chair public.barbers%rowtype; uid uuid; label text; full_phone text; dial text; skip_count integer;
 actual_hash text:=p_data->>'token_hash'; password text:=p_data->>'password';
begin
 if p_action in('check','send','resend','cancel','list') then
  if not private.invitation_live(actor,sid,'manager') then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
  if invite_id is not null then
   select * into inv from private.shop_barber_invitations where id=invite_id for update;
   if inv.id is null or inv.manager_id<>actor then raise exception 'FORBIDDEN' using errcode='42501';end if;
   shop_id:=inv.branch_id;
  end if;
  select * into shop from public.branches where id=shop_id and manager_id=actor for share;
  if shop.id is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if p_action='list' then
   skip_count:=greatest(0,least(coalesce((p_data->>'offset')::integer,0),10000));
   return jsonb_build_object('invitations',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,email,status,delivery,generation,expires_at,created_at,sent_at,accepted_at,barber_id
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
   insert into private.shop_barber_invitations(branch_id,manager_id,email,token_hash) values(shop.id,actor,mail,actual_hash) returning * into inv;
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
 select * into person from auth.users where lower(email)=inv.email and deleted_at is null;
 if person.id is not null and (person.raw_app_meta_data->>'role' is distinct from 'customer' or (person.banned_until is not null and person.banned_until>now())) then raise exception 'EMAIL_UNAVAILABLE';end if;
 if p_action='resolve' then
  if person.id is null and p_data ? 'phone' and exists(select 1 from private.phone_numbers where phone=private.canonical_phone(p_data->>'phone',p_data->>'country_code')) then raise exception 'PHONE_IN_USE';end if;
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
 insert into public.barbers(user_id,branch_id,name,email,country_code,phone,status,service_ids,availability,time_offs,vacations,invite_status,invite_sent_at,invite_accepted_at,availability_approved_at)
 values(person.id,inv.branch_id,label,inv.email,dial,substring(full_phone from 5),'inactive','{}','{}','[]','[]','accepted',inv.sent_at,clock_timestamp(),null) returning * into chair;
 update private.shop_barber_invitations set status='accepted',accepted_at=clock_timestamp(),accepted_user_id=person.id,barber_id=chair.id where id=inv.id;
 insert into public.logs(level,log_type,user_id,user_role,action,entity_type,entity_id,message) values('info','action',person.id,'barber','accept_invite','barber',chair.id,'Barber invitation accepted');
 perform private.deliver_dashboard_notification(inv.id,inv.manager_id,inv.branch_id,'manager','barber_invite_accepted',chair.id,'barber',jsonb_build_object('barberId',chair.id,'barberName',label));
 return jsonb_build_object('accepted',true,'barber_id',chair.id);
end $invitation_recovery$;
commit;
