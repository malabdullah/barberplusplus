-- Persisted Auth codes remain unchanged: admin=Super Admin, agent=Admin.
-- Never rewrite an existing account, credential or provider identity here.
begin;
create or replace function private.staff_session_factor_satisfied(person uuid, session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select (
 not exists(select 1 from auth.users u where u.id=person and u.raw_app_meta_data->>'role' in('admin','agent'))
 and not exists(select 1 from auth.users u join auth.mfa_factors f on f.user_id=u.id where u.id=person and u.raw_app_meta_data->>'role' in('manager','barber')and f.status='verified')
 ) or exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
 where s.id=session and s.user_id=person and s.aal='aal2'and f.status='verified'and f.factor_type='totp'and(s.not_after is null or s.not_after>now()));
$$;
create or replace function public.staff_factor_satisfied() returns boolean
language sql stable security definer set search_path='' as $$
 select (
 not exists(select 1 from auth.users u where u.id=auth.uid()and u.raw_app_meta_data->>'role' in('admin','agent'))
 and not exists(select 1 from auth.users u join auth.mfa_factors f on f.user_id=u.id where u.id=auth.uid()and u.raw_app_meta_data->>'role' in('manager','barber')and f.status='verified')
 ) or(auth.jwt()->>'aal'='aal2'and exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
 where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid()and s.aal='aal2'and f.status='verified'and f.factor_type='totp'and(s.not_after is null or s.not_after>now())));
$$;
CREATE OR REPLACE FUNCTION private.live_staff_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when u.raw_app_meta_data->>'role'='agent' then 'admin' else u.raw_app_meta_data->>'role' end from auth.users u
  where public.staff_factor_satisfied() and u.id=auth.uid() and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    and u.raw_app_meta_data->>'role' in ('admin','manager','barber','agent')
    and (auth.jwt()->>'session_id' is null or exists(select 1 from auth.sessions s
      where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=u.id and (s.not_after is null or s.not_after>now())));
$function$;

create or replace function public.is_admin()returns boolean language sql stable security definer set search_path='' as $$select coalesce(private.live_staff_role()='admin',false);$$;
create function public.is_super_admin()returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin()and exists(select 1 from auth.users where id=auth.uid()and raw_app_meta_data->>'role'='admin');$$;
revoke all on function public.is_super_admin()from public,anon;grant execute on function public.is_super_admin()to authenticated,service_role;
create or replace function public.is_agent()returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin()and exists(select 1 from auth.users where id=auth.uid()and raw_app_meta_data->>'role'='agent');$$;
CREATE OR REPLACE FUNCTION public.get_managers()
 RETURNS TABLE(id uuid, email text, name text, phone text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then
    raise insufficient_privilege using message = 'Administrator role required';
  end if;

  return query
  select
    users.id,
    users.email::text,
    coalesce(users.raw_user_meta_data ->> 'name', pg_catalog.split_part(users.email::text, '@', 1))::text,
    (users.raw_user_meta_data ->> 'phone')::text,
    users.created_at
  from auth.users
  where users.raw_app_meta_data ->> 'role' = 'manager';
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_manager_by_id(manager_id uuid)
 RETURNS TABLE(id uuid, email text, name text, phone text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then
    raise insufficient_privilege using message = 'Administrator role required';
  end if;

  return query
  select
    users.id,
    users.email::text,
    coalesce(users.raw_user_meta_data ->> 'name', pg_catalog.split_part(users.email::text, '@', 1))::text,
    (users.raw_user_meta_data ->> 'phone')::text,
    users.created_at
  from auth.users
  where users.id = manager_id
    and users.raw_app_meta_data ->> 'role' = 'manager';
end;
$function$;
CREATE OR REPLACE FUNCTION public.count_users_by_role(role_filter text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result bigint;
begin
  if not public.is_admin() then
    raise insufficient_privilege using message = 'Administrator role required';
  end if;

  select count(*) into result
  from auth.users
  where raw_app_meta_data ->> 'role' = role_filter;
  return result;
end;
$function$;
CREATE OR REPLACE FUNCTION private.announcement_author_allowed(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from auth.users u where u.id=p_user and u.raw_app_meta_data->>'role' in('admin','agent')and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
 and exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified'and f.factor_type='totp'));
$function$;
CREATE OR REPLACE FUNCTION private.require_announcement_admin(p_user uuid, p_session uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
  where u.id=p_user and s.id=p_session and u.raw_app_meta_data->>'role' in('admin','agent')
   and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())and(s.not_after is null or s.not_after>now()))then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
  where s.id=p_session and s.user_id=p_user and s.aal='aal2'and f.status='verified'and f.factor_type='totp')then raise exception 'ADMIN_MFA_REQUIRED';end if;
end $function$;
CREATE OR REPLACE FUNCTION public.enforce_account_session()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_session uuid;
begin
  if auth.jwt()->>'role' is distinct from 'authenticated' then return; end if;
  if public.staff_factor_satisfied() is not true then raise exception using errcode='42501', message=case
    when exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role' in('admin','agent'))
      then 'ADMIN_MFA_REQUIRED' else 'MFA_REQUIRED' end; end if; current_session := private.current_account_session();
  if current_session is null then raise sqlstate 'PT401' using message='SESSION_ENDED'; end if;
  if exists (
    select 1 from auth.users u where u.id=auth.uid() and u.raw_app_meta_data->>'role' in('admin','agent')
  ) and (auth.jwt()->>'aal' is distinct from 'aal2' or not exists (
    select 1 from auth.sessions s
    join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
    where s.id=current_session and s.aal='aal2' and f.status='verified' and f.factor_type='totp'
  )) then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode='42501';
  end if;
end;
$function$;
CREATE OR REPLACE FUNCTION private.guard_booking_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  kuwait_now timestamp;
begin
  if tg_op='DELETE' then
    -- A cascading delete through a barber or branch must preserve history too.
    if auth.uid() is not null and not exists (
      select 1 from auth.users u where u.id=auth.uid() and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=now())
        and u.raw_app_meta_data->>'role' in('admin','agent')
    ) then
      raise exception 'BOOKING_DELETE_FORBIDDEN' using errcode='42501';
    end if;
    return old;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  kuwait_now := clock_timestamp() at time zone 'Asia/Kuwait';
  if new.status='no_show' then
    if tg_op='INSERT' then
      if new.date + new.time > kuwait_now then
        raise exception 'BOOKING_NO_SHOW_BEFORE_START';
      end if;
    elsif (old.status is distinct from 'no_show' or row(new.date,new.time) is distinct from row(old.date,old.time))
      and greatest(old.date + old.time, new.date + new.time) > kuwait_now then
      raise exception 'BOOKING_NO_SHOW_BEFORE_START';
    end if;
  end if;

  if tg_op='UPDATE' and old.date + old.time > kuwait_now and new.date + new.time <= kuwait_now then
    raise exception 'BOOKING_CANNOT_BE_BACKDATED';
  end if;

  return new;
end
$function$;
CREATE OR REPLACE FUNCTION private.account_tools_api(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare viewer uuid:=(p_data->>'user_id')::uuid;sid uuid:=(p_data->>'session_id')::uuid;
 role_name text;profile_id uuid;canonical uuid;allowed_users uuid[];target uuid;cursor_id bigint;
 cursor_time timestamptz;session_cursor uuid;rows jsonb;current_row jsonb;more boolean;next_cursor jsonb;
begin
 select u.raw_app_meta_data->>'role' into role_name from auth.users u join auth.sessions s on s.user_id=u.id
 where public.staff_token_factor_satisfied(viewer,sid,p_data->>'aal') and u.id=viewer and s.id=sid and(s.not_after is null or s.not_after>clock_timestamp())
 and not exists(select 1 from private.account_revoked_sessions r where r.session_id=sid)
 and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
 and(u.raw_app_meta_data->>'role'not in('admin','agent') or(p_data->>'aal'='aal2' and s.aal='aal2' and exists(select 1 from auth.mfa_factors f where f.id=s.factor_id and f.user_id=u.id and f.factor_type='totp' and f.status='verified')));
 if role_name is null then raise exception 'AUTH_REQUIRED';end if;
 if role_name not in('customer','manager','barber','admin','agent')then raise exception 'FORBIDDEN';end if;
 if p_action not in('status','sessions','revoke-session','activity')or p_action is null then raise exception 'INVALID_REQUEST';end if;
 if p_action='status' then return jsonb_build_object('accountId',viewer,'role',role_name);end if;
 canonical:=viewer;
 if role_name='customer' then select coalesce((select i.account_user_id from private.customer_social_identities i where i.user_id=viewer),viewer)into canonical;end if;
 select a.customer_id into profile_id from private.customer_accounts a where a.user_id=canonical;
 select array_agg(u.id)into allowed_users from auth.users u where public.staff_token_factor_satisfied(viewer,sid,p_data->>'aal') and u.id=viewer or(role_name='customer' and u.raw_app_meta_data->>'role'='customer' and(u.id=canonical or exists(select 1 from private.customer_social_identities i where i.user_id=u.id and i.account_user_id=canonical)));
 if p_action in('sessions','revoke-session')then
  if p_action='revoke-session' then
   target:=(p_data->>'targetId')::uuid;
   if target is null then raise exception 'INVALID_REQUEST';end if;
   if target=sid then raise exception 'USE_SIGN_OUT_FOR_CURRENT_SESSION';end if;
   perform pg_advisory_xact_lock(hashtextextended(viewer::text,81212));
   update auth.sessions set not_after=least(coalesce(not_after,'infinity'::timestamptz),clock_timestamp()) where id=target and user_id=any(allowed_users);
   if not found then raise exception 'SESSION_NOT_FOUND';end if;
   insert into private.account_revoked_sessions(session_id,user_id)select id,user_id from auth.sessions where id=target on conflict(session_id)do nothing;
   return jsonb_build_object('revoked',true);
  end if;
  if p_data ? 'cursor' then cursor_time:=(p_data->'cursor'->>'createdAt')::timestamptz;session_cursor:=(p_data->'cursor'->>'id')::uuid;if cursor_time is null or session_cursor is null then raise exception 'INVALID_REQUEST';end if;end if;
  select jsonb_build_object('id',s.id,'device',left(coalesce(s.user_agent,''),256),'createdAt',s.created_at,'lastActiveAt',coalesce(s.refreshed_at at time zone 'UTC',s.created_at),'current',true)into current_row from auth.sessions s where s.id=sid;
  with candidates as(select s.* from auth.sessions s where s.user_id=any(allowed_users)and s.id<>sid and(s.not_after is null or s.not_after>clock_timestamp())and(cursor_time is null or(s.created_at,s.id)<(cursor_time,session_cursor))order by s.created_at desc,s.id desc limit 26),page as(select * from candidates order by created_at desc,id desc limit 25)
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'device',left(coalesce(p.user_agent,''),256),'createdAt',p.created_at,'lastActiveAt',coalesce(p.refreshed_at at time zone 'UTC',p.created_at),'current',false)order by p.created_at desc,p.id desc),'[]'::jsonb),(select count(*)>25 from candidates)into rows,more from page p;
  if more then next_cursor:=jsonb_build_object('createdAt',rows->-1->'createdAt','id',rows->-1->'id');end if;
  return jsonb_build_object('currentSession',current_row,'rows',rows,'nextCursor',next_cursor);
 end if;
 if p_data->>'view'not in('customer','work')or p_data->>'view'is null then raise exception 'INVALID_REQUEST';end if;
 if p_data->>'view'='customer'and(role_name not in('customer','manager','barber')or profile_id is null)then raise exception 'FORBIDDEN';end if;
 if p_data->>'view'='work'and role_name='customer'then raise exception 'FORBIDDEN';end if;
 if p_data ? 'cursor' then cursor_id:=(p_data->>'cursor')::bigint;if cursor_id is null or cursor_id<1 then raise exception 'INVALID_REQUEST';end if;end if;
 with candidates as(
  select a.* from private.account_activity a where(cursor_id is null or a.id<cursor_id)and(
   (p_data->>'view'='customer'and a.booking_id in(select o.booking_id from private.customer_booking_owners o where o.account_user_id=canonical))or
   (p_data->>'view'='work'and(role_name in('admin','agent') or
    (role_name='manager'and a.branch_id in(select b.id from public.branches b where b.manager_id=viewer))or
    (role_name='barber'and a.barber_id in(select x.id from public.barbers x where x.user_id=viewer and x.status='active'))or
    (role_name='agent'and a.actor_user_id=viewer))))order by a.id desc limit 26
 ),page as(select * from candidates order by id desc limit 25)
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'happenedAt',e.happened_at,'kind',e.kind,'shop',b.name,'shopAr',b.name_ar,'reference',upper(left(replace(e.booking_id::text,'-',''),10)),'byYou',e.actor_user_id=viewer,'actorRole',coalesce(e.actor_role,'unknown'),'actorName',case when p_data->>'view'='work'and role_name in('admin','agent','manager')and e.actor_role in('admin','manager','barber','agent')then left(u.raw_user_meta_data->>'name',120)end)order by e.id desc),'[]'::jsonb),(select count(*)>25 from candidates)into rows,more from page e left join public.branches b on b.id=e.branch_id left join auth.users u on u.id=e.actor_user_id;
 return jsonb_build_object('rows',rows,'nextCursor',case when more then rows->-1->'id'else null end);
end $function$;
CREATE OR REPLACE FUNCTION private.enforce_customer_password_proof()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare op uuid; proof private.customer_password_proofs%rowtype; admin_guard private.admin_password_reset_guards%rowtype; current_user_row auth.users%rowtype;
begin
  if old.raw_app_meta_data->>'role' not in ('customer','manager','barber') then return new; end if;
  select * into current_user_row from auth.users where id=old.id for update;
  if old.raw_app_meta_data->>'role' is distinct from current_user_row.raw_app_meta_data->>'role'
    or current_user_row.encrypted_password is distinct from new.encrypted_password then raise exception 'PASSWORD_PROOF_REQUIRED'; end if;
  -- Pinned GoTrue creates an unknowable temporary password when accepting an
  -- invited user with no password. Authorize only the server-started, token-bound
  -- confirmation transition; it is not the user's chosen credential change.
  if old.raw_app_meta_data->>'role'='barber' and coalesce(old.encrypted_password,'')=''
    and old.invited_at is not null and old.email_confirmed_at is null and coalesce(old.confirmation_token,'')<>''
    and current_user_row.email_confirmed_at is not null and coalesce(current_user_row.confirmation_token,'')=''
    and old.email is not distinct from current_user_row.email then
    select p.* into proof from private.customer_password_proofs p join private.customer_password_requests r on r.id=p.id
      join private.customer_password_reset_guards g on g.id=p.id and g.user_id=p.user_id
      where p.user_id=old.id and p.session_id is null and p.purpose='invite' and p.state='prepared'
        and p.expires_at>now() and p.password_fingerprint=md5(coalesce(old.encrypted_password,''))
        and r.purpose='invite' and r.state='ready' and r.expires_at>now() and r.token_hash=old.confirmation_token
        and current_user_row.deleted_at is null and (current_user_row.banned_until is null or current_user_row.banned_until<=now())
      for update of p,r,g;
    if proof.id is null then raise exception 'PASSWORD_PROOF_REQUIRED'; end if;
    update private.customer_password_proofs set state='applied' where id=proof.id;
    update private.customer_password_requests set state='verified' where id=proof.id;
    delete from private.customer_password_reset_guards where id=proof.id and user_id=old.id;
    return null;
  end if;
  if current_user_row.raw_app_meta_data ? 'barber_admin_password_operation' then
    op:=(current_user_row.raw_app_meta_data->>'barber_admin_password_operation')::uuid;
    select * into admin_guard from private.admin_password_reset_guards where id=op and target_id=old.id for update;
    if admin_guard.id is null or not exists(select 1 from auth.users where id=admin_guard.actor_id
      and raw_app_meta_data->>'role' in('admin','agent') and (raw_app_meta_data->>'role'='admin' or old.raw_app_meta_data->>'role'not in('admin','agent')) and deleted_at is null and (banned_until is null or banned_until<=now())) then raise exception 'PASSWORD_PROOF_REQUIRED'; end if;
    insert into private.customer_password_proofs(id,user_id,purpose,account_role,account_email,password_fingerprint,state)
      values(op,old.id,'admin',old.raw_app_meta_data->>'role',old.email,md5(coalesce(old.encrypted_password,'')),'applied');
  else
    op:=nullif(current_user_row.raw_app_meta_data->>'barber_password_operation','')::uuid;
    select * into proof from private.customer_password_proofs where id=op for update;
    if proof.id is null and exists(select 1 from private.customer_password_reset_guards where id=op and user_id=old.id and created_at>now()-interval '5 minutes')
      and old.raw_app_meta_data->>'role'='customer' and old.email_confirmed_at is null and old.phone_confirmed_at is not null then
      insert into private.customer_password_proofs(id,user_id,purpose,account_role,password_fingerprint,state)
        values(op,old.id,'legacy_phone','customer',md5(coalesce(old.encrypted_password,'')),'applied');
    else
      if current_user_row.deleted_at is not null or current_user_row.banned_until>now()
        or proof.id is null or proof.user_id<>old.id or proof.state<>'prepared' or proof.expires_at<=now()
        or proof.password_fingerprint<>md5(coalesce(old.encrypted_password,''))
        or proof.account_role is distinct from old.raw_app_meta_data->>'role' or proof.account_email is distinct from old.email
        or not exists(select 1 from private.customer_password_reset_guards where id=op and user_id=old.id) then raise exception 'PASSWORD_PROOF_REQUIRED'; end if;
      update private.customer_password_proofs set state='applied' where id=op;
      delete from private.customer_password_reset_guards where id=op and user_id=old.id;
      if proof.purpose='invite' then
        update public.barbers set invite_status='accepted',invite_accepted_at=now() where user_id=old.id and invite_status in ('sent','pending');
      end if;
    end if;
  end if;
  update auth.users set raw_app_meta_data=current_user_row.raw_app_meta_data-'barber_password_operation'-'barber_admin_password_operation' where id=old.id;
  delete from auth.sessions where user_id=old.id;
  return null;
end;
$function$;
CREATE OR REPLACE FUNCTION public.begin_admin_password_reset(p_actor uuid, p_target uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_role text; target_role text; guard_id uuid;
begin
  if p_actor is null or p_target is null or p_actor = p_target then
    raise exception 'Invalid account selection';
  end if;
  -- Lock both users in a stable order. A concurrent role update must either
  -- finish before our recheck or encounter the persistent guard afterward.
  perform 1 from auth.users where id in (p_actor, p_target) order by id for update;
  select pg_catalog.lower(raw_app_meta_data ->> 'role') into actor_role from auth.users where id = p_actor;
  select pg_catalog.lower(raw_app_meta_data ->> 'role') into target_role from auth.users where id = p_target;
  if actor_role not in('admin','agent') or actor_role is null or target_role is null
     or target_role not in('manager','barber','customer')and not(actor_role='admin'and target_role='agent') then
    raise exception 'Account role is not eligible for reset';
  end if;
  if (select pg_catalog.count(*) from public.audit_logs where admin_user_id = p_actor
      and action_type = 'password_reset_requested' and created_at >= pg_catalog.now() - interval '1 hour') >= 10 then
    raise exception 'Password reset limit reached';
  end if;
  insert into private.admin_password_reset_guards(actor_id,target_id) values (p_actor,p_target) returning id into guard_id;
  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,metadata)
    values (p_actor,p_target,'password_reset_requested','user',p_target,'{"source":"admin_password_reset"}'::jsonb);
  return guard_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_account_email(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); target auth.users%rowtype; result jsonb; page_number integer;
begin
  perform public.enforce_account_session();
  if actor is null or auth.jwt()->>'aal' is distinct from 'aal2' or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_action='list' then
    page_number:=coalesce((p_data->>'page')::integer,1);
    if page_number<1 or page_number>10000 then raise exception 'INVALID_REQUEST'; end if;
    select coalesce(jsonb_agg(x),'[]') into result from (
      select id,email,raw_user_meta_data->>'name' as name,raw_app_meta_data->>'role' as role,
        email_confirmed_at is not null as verified
      from auth.users where deleted_at is null and(public.is_super_admin()or raw_app_meta_data->>'role'not in('admin','agent')) order by created_at,id limit 25 offset (page_number-1)*25
    ) x;
    return jsonb_build_object('users',result,'hasMore',exists(select 1 from auth.users where deleted_at is null and(public.is_super_admin()or raw_app_meta_data->>'role'not in('admin','agent')) order by created_at,id offset page_number*25 limit 1));
  end if;
  if p_action<>'change' or length(trim(coalesce(p_data->>'reason','')))<8 or length(p_data->>'reason')>500 then raise exception 'INVALID_REQUEST'; end if;
  select * into target from auth.users where id=(p_data->>'userId')::uuid and deleted_at is null for update;
  if target.id is null or lower(coalesce(target.email,''))<>lower(coalesce(p_data->>'expectedEmail','')) then raise exception 'EMAIL_CHANGED_REFRESH'; end if;
  if target.raw_app_meta_data->>'role' in('admin','agent')and not public.is_super_admin()then raise exception 'FORBIDDEN'using errcode='42501';end if;
  result:=private.write_account_email(target.id,p_data->>'newEmail',actor,'admin_change',trim(p_data->>'reason'));
  return result||jsonb_build_object('success',true,'signedOut',target.id=actor);
end;
$function$;

-- Administrative identities are writable only through this Super Admin capability.
create function public.manage_administrators(p_action text,p_data jsonb default '{}')returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();target auth.users%rowtype;rows jsonb;page_number integer;affected uuid;email_value text;
begin
 perform public.enforce_account_session();
 if not public.is_super_admin()then raise exception 'SUPER_ADMIN_REQUIRED'using errcode='42501';end if;
 if p_action='list'then
  page_number:=coalesce((p_data->>'page')::integer,1);if page_number<1 or page_number>10000 then raise exception 'INVALID_REQUEST';end if;
  select coalesce(jsonb_agg(x),'[]')into rows from(select id,email,coalesce(raw_user_meta_data->>'name','')as name,
   case when raw_app_meta_data->>'role'='admin'then 'super_admin'else 'admin'end as role,
   coalesce(banned_until<=now(),true)as enabled,email_confirmed_at is not null as verified
   from auth.users where deleted_at is null and raw_app_meta_data->>'role'in('admin','agent')order by created_at,id limit 25 offset(page_number-1)*25)x;
  return jsonb_build_object('users',rows,'hasMore',exists(select 1 from auth.users where deleted_at is null and raw_app_meta_data->>'role'in('admin','agent')order by created_at,id offset page_number*25 limit 1));
 end if;
 if p_action='add'then
  email_value:=lower(trim(p_data->>'email'));
  if email_value is null or length(email_value)>254 or email_value!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\\.[^[:space:]@<>]+$'then raise exception 'INVALID_DETAILS';end if;
  select *into target from auth.users where lower(email)=email_value and deleted_at is null for update;
  if target.id is null or target.email_confirmed_at is null then raise exception 'VERIFIED_ACCOUNT_REQUIRED';end if;
  if target.raw_app_meta_data->>'role'in('admin','agent')then raise exception 'ALREADY_ADMIN';end if;
  if target.raw_app_meta_data->>'role'is distinct from 'customer'or target.banned_until>now()
   or exists(select 1 from public.branches where manager_id=target.id)
   or exists(select 1 from public.barbers where user_id=target.id)
   or exists(select 1 from private.customer_social_identities where user_id=target.id or account_user_id=target.id)then raise exception 'SEPARATE_ADMIN_ACCOUNT_REQUIRED';end if;
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||jsonb_build_object('role','agent'),updated_at=now()where id=target.id;
  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,new_values)
   values(actor,target.id,'role_assigned','user',target.id,'{"role":"admin"}'::jsonb);
 elsif p_action in('disable','enable')then
  select *into target from auth.users where id=(p_data->>'userId')::uuid and deleted_at is null for update;
  if target.id is null or target.id=actor or target.raw_app_meta_data->>'role'is distinct from 'agent'then raise exception 'PROTECTED_ADMIN_ACCOUNT';end if;
  update auth.users set banned_until=case when p_action='enable'then null else now()+interval'100 years'end,updated_at=now()where id=target.id;
  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,new_values)
   values(actor,target.id,case when p_action='enable'then 'user_enabled'else 'user_disabled'end,'user',target.id,jsonb_build_object('enabled',p_action='enable'));
 else raise exception 'INVALID_REQUEST';end if;
 if p_action in('add','disable')then
  insert into private.account_revoked_sessions(session_id,user_id)select id,user_id from auth.sessions where user_id=target.id on conflict(session_id)do nothing;
  update auth.sessions set not_after=now()where user_id=target.id;
 end if;
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.manage_administrators(text,jsonb)from public,anon,service_role;grant execute on function public.manage_administrators(text,jsonb)to authenticated;
commit;

