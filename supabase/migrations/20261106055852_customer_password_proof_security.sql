-- Credential proofs are private, short lived and never inferred from UI state.
create table private.customer_password_requests (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  purpose text not null check (purpose in ('recovery','set','invite','legacy')),
  client text not null check (client in ('web','ios')),
  native_state uuid,
  native_challenge text,
  delivery_hash text,
  token_hash text,
  state text not null default 'pending' check (state in ('pending','ready','verified')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '1 hour',
  check ((client='ios')=(native_state is not null))
);
create index customer_password_requests_expiry_idx on private.customer_password_requests(expires_at);
create index customer_password_requests_user_idx on private.customer_password_requests(user_id);
alter table private.customer_password_requests enable row level security;
revoke all on private.customer_password_requests from public,anon,authenticated,service_role;

create table private.customer_password_proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  purpose text not null check (purpose in ('current','recovery','set','invite','admin','legacy_phone')),
  account_role text not null,
  account_email text,
  password_fingerprint text not null,
  state text not null default 'issued' check (state in ('issued','prepared','applied','failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '5 minutes'
);
create index customer_password_proofs_expiry_idx on private.customer_password_proofs(expires_at);
create index customer_password_proofs_user_idx on private.customer_password_proofs(user_id);
alter table private.customer_password_proofs enable row level security;
revoke all on private.customer_password_proofs from public,anon,authenticated,service_role;

create function public.customer_password_api(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  person auth.users%rowtype;
  request private.customer_password_requests%rowtype;
  proof private.customer_password_proofs%rowtype;
  uid uuid:=nullif(p_data->>'user_id','')::uuid;
  sid uuid:=nullif(p_data->>'session_id','')::uuid;
  request_id uuid:=nullif(p_data->>'request_id','')::uuid;
  candidate_email text;
  candidate_purpose text;
  reauth uuid;
  delivery uuid;
begin
  if p_action in ('operation-result','abort') then
    perform 1 from auth.users where id=uid for update;
    select * into proof from private.customer_password_proofs where id=(p_data->>'operation')::uuid for update;
    if proof.id is null or proof.user_id is distinct from uid or proof.session_id is distinct from sid then raise exception 'PASSWORD_PROOF_REQUIRED'; end if;
    if p_action='abort' and proof.state='prepared' then
      select * into person from auth.users where id=uid for update;
      if proof.password_fingerprint<>md5(coalesce(person.encrypted_password,'')) then raise exception 'PASSWORD_UPDATE_UNCERTAIN'; end if;
      delete from private.customer_password_reset_guards where id=proof.id and user_id=uid;
      update private.customer_password_proofs set state='failed' where id=proof.id;
    end if;
    return jsonb_build_object('applied',proof.state='applied');
  elsif p_action='invite-verified' then
    select * into person from auth.users where id=uid for update;
    if not public.customer_session_is_live(uid,sid) or person.raw_app_meta_data->>'role'<>'barber'
      or person.invited_at is null or person.email_confirmed_at is null
      or not exists(select 1 from public.barbers where user_id=uid and invite_status in ('sent','pending'))
      or not exists(select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
        where s.id=sid and s.created_at>now()-interval '1 minute' and a.authentication_method in ('otp','invite')) then raise exception 'INVALID_CODE'; end if;
    insert into private.customer_password_proofs(user_id,session_id,purpose,account_role,account_email,password_fingerprint)
      values(uid,sid,'invite','barber',person.email,md5(coalesce(person.encrypted_password,''))) returning * into proof;
    return jsonb_build_object('proof',proof.id,'expiresIn',300);
  elsif p_action='request-start' then
    candidate_email:=lower(trim(p_data->>'email'));
    candidate_purpose:='recovery';
    if p_data->>'purpose'='set' then
      select * into person from auth.users where id=uid;
      if not public.customer_session_is_live(uid,sid) or person.email_confirmed_at is null then raise exception 'AUTH_REQUIRED'; end if;
      if coalesce(person.encrypted_password,'')<>'' then raise exception 'PASSWORD_ALREADY_SET'; end if;
      candidate_email:=lower(person.email);candidate_purpose:='set';
    else
      select * into person from auth.users where lower(email)=candidate_email and email_confirmed_at is not null
        and deleted_at is null and (banned_until is null or banned_until<=now())
        and (raw_app_meta_data->>'role' in ('customer','manager','barber')
          or (p_data->>'audience'='work' and raw_app_meta_data->>'role' in ('admin','agent')));
      if person.raw_app_meta_data->>'role' in ('admin','agent') then candidate_purpose:='legacy'; end if;
    end if;
    if request_id is null or coalesce(candidate_email,'')='' or p_data->>'client' not in ('web','ios') then raise exception 'INVALID_REQUEST'; end if;
    if p_data->>'client'='ios' and coalesce(p_data->>'native_challenge','') !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'INVALID_REQUEST'; end if;
    insert into private.customer_password_requests(id,user_id,email,purpose,client,native_state,native_challenge)
      values(request_id,person.id,candidate_email,candidate_purpose,p_data->>'client',nullif(p_data->>'native_state','')::uuid,p_data->>'native_challenge');
    return jsonb_build_object('requestId',request_id,'email',candidate_email,'deliver',person.id is not null);
  elsif p_action='request-ready' then
    select * into request from private.customer_password_requests where id=request_id for update;
    if request.id is null or request.state<>'pending' then raise exception 'INVALID_CODE'; end if;
    select * into person from auth.users where id=request.user_id;
    update private.customer_password_requests set token_hash=nullif(person.recovery_token,''),state='ready' where id=request.id;
    return jsonb_build_object('success',true);
  elsif p_action='request-delivery' then
    select * into request from private.customer_password_requests where id=request_id for update;
    select * into person from auth.users where id=request.user_id;
    if request.id is null or request.client<>'ios' or request.native_state is distinct from nullif(p_data->>'native_state','')::uuid
      or request.state<>'ready' or request.expires_at<=now() or request.token_hash is null
      or request.token_hash is distinct from p_data->>'token_hash' or request.token_hash is distinct from person.recovery_token then raise exception 'INVALID_CODE'; end if;
    delivery:=gen_random_uuid();
    update private.customer_password_requests set delivery_hash=encode(extensions.digest(delivery::text,'sha256'),'hex') where id=request.id;
    return jsonb_build_object('deliveryToken',delivery);
  elsif p_action in ('request-load','request-verified') then
    select * into request from private.customer_password_requests where id=request_id for update;
    if request.id is null or request.state<>'ready' or request.expires_at<=now() or request.user_id is null
      or (request.client='ios' and (p_data->>'client' is distinct from 'ios'
        or nullif(p_data->>'native_state','')::uuid is distinct from request.native_state
        or p_data->>'native_challenge' is distinct from request.native_challenge)) then raise exception 'INVALID_CODE'; end if;
    select * into person from auth.users where id=request.user_id for update;
    if person.deleted_at is not null or person.banned_until>now() or person.email_confirmed_at is null
      or lower(person.email) is distinct from request.email then raise exception 'INVALID_CODE'; end if;
    if p_action='request-load' then
      if request.token_hash is null or request.token_hash is distinct from person.recovery_token then raise exception 'INVALID_CODE'; end if;
      if p_data ? 'delivery_token' and (request.client<>'ios' or request.delivery_hash is null
        or request.delivery_hash is distinct from encode(extensions.digest(p_data->>'delivery_token','sha256'),'hex')) then raise exception 'INVALID_CODE'; end if;
      return jsonb_build_object('userId',person.id,'email',request.email,'tokenHash',request.token_hash,'purpose',request.purpose);
    end if;
    if uid is distinct from person.id or not exists(select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
      where s.id=sid and s.user_id=uid and s.created_at>=request.created_at-interval '5 seconds'
        and s.created_at>now()-interval '1 minute' and a.authentication_method in ('otp','recovery')
        and (s.not_after is null or s.not_after>now())) then raise exception 'INVALID_CODE'; end if;
    update private.customer_password_requests set state='verified' where id=request.id;
    if request.purpose='legacy' then return jsonb_build_object('legacyRecovery',true); end if;
    if person.raw_app_meta_data->>'role' not in ('customer','manager','barber') then raise exception 'AUTH_REQUIRED'; end if;
    if request.purpose='set' and coalesce(person.encrypted_password,'')<>'' then raise exception 'PASSWORD_ALREADY_SET'; end if;
    insert into private.customer_password_proofs(user_id,session_id,purpose,account_role,account_email,password_fingerprint)
      values(uid,sid,request.purpose,person.raw_app_meta_data->>'role',person.email,md5(coalesce(person.encrypted_password,''))) returning * into proof;
    return jsonb_build_object('proof',proof.id,'expiresIn',300,'hasPassword',coalesce(person.encrypted_password,'')<>'');
  end if;

  select * into person from auth.users where id=uid for update;
  if person.id is null or not public.customer_session_is_live(uid,sid) then raise exception 'AUTH_REQUIRED'; end if;
  if p_action='status' then
    return jsonb_build_object('hasPassword',coalesce(person.encrypted_password,'')<>'',
      'providers',coalesce((select jsonb_agg(distinct provider) from auth.identities where user_id=uid),'[]'::jsonb),
      'email',person.email,'canVerifyEmail',person.email_confirmed_at is not null and coalesce(person.email,'')<>'');
  elsif p_action='current-begin' then
    if coalesce(person.encrypted_password,'')='' then raise exception 'PASSWORD_NOT_SET'; end if;
    reauth:=nullif(p_data->>'reauth_session_id','')::uuid;
    if reauth is null or reauth=sid or not exists(select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
      where s.id=reauth and s.user_id=uid and s.created_at>now()-interval '1 minute'
        and a.authentication_method='password' and a.created_at>now()-interval '1 minute'
        and (s.not_after is null or s.not_after>now())) then raise exception 'CURRENT_PASSWORD_REQUIRED'; end if;
    delete from auth.sessions where id=reauth and user_id=uid;
    insert into private.customer_password_proofs(user_id,session_id,purpose,account_role,account_email,password_fingerprint,state)
      values(uid,sid,'current',person.raw_app_meta_data->>'role',person.email,md5(person.encrypted_password),'prepared') returning * into proof;
  elsif p_action='prepare' then
    select * into proof from private.customer_password_proofs where id=(p_data->>'proof')::uuid for update;
    if proof.id is null or proof.user_id<>uid or proof.session_id is distinct from sid or proof.state<>'issued'
      or proof.expires_at<=now() or proof.password_fingerprint<>md5(coalesce(person.encrypted_password,''))
      or proof.account_role is distinct from person.raw_app_meta_data->>'role'
      or proof.account_email is distinct from person.email then raise exception 'PASSWORD_PROOF_REQUIRED'; end if;
    update private.customer_password_proofs set state='prepared' where id=proof.id;
  else raise exception 'INVALID_REQUEST';
  end if;
  -- An expired operation cannot pass the deferred Auth barrier. With the user
  -- locked, retire only its unchanged credential guard; never discard an
  -- in-flight, unexpired operation after an ambiguous network response.
  delete from private.customer_password_reset_guards g using private.customer_password_proofs p
    where g.id=p.id and g.user_id=uid and p.user_id=uid and p.state='prepared'
      and p.expires_at<=now() and p.password_fingerprint=md5(coalesce(person.encrypted_password,''));
  update private.customer_password_proofs set state='failed' where user_id=uid and state='prepared' and expires_at<=now()
    and password_fingerprint=md5(coalesce(person.encrypted_password,''));
  if exists(select 1 from private.customer_password_reset_guards where user_id=uid)
    or exists(select 1 from private.admin_password_reset_guards where target_id=uid) then raise exception 'PASSWORD_CHANGE_IN_PROGRESS'; end if;
  insert into private.customer_password_reset_guards(id,user_id) values(proof.id,uid);
  return jsonb_build_object('operation',proof.id);
end;
$$;
revoke all on function public.customer_password_api(text,jsonb) from public,anon,authenticated;
grant execute on function public.customer_password_api(text,jsonb) to service_role;

-- A client cannot set app_metadata. The marker is stripped before storage and
-- can authorize exactly one Auth write, including when the HTTP reply is lost.
create function private.enforce_customer_password_proof() returns trigger
language plpgsql security definer set search_path='' as $$
declare op uuid; proof private.customer_password_proofs%rowtype; admin_guard private.admin_password_reset_guards%rowtype; current_user_row auth.users%rowtype;
begin
  if old.raw_app_meta_data->>'role' not in ('customer','manager','barber') then return new; end if;
  select * into current_user_row from auth.users where id=old.id for update;
  if old.raw_app_meta_data->>'role' is distinct from current_user_row.raw_app_meta_data->>'role'
    or current_user_row.encrypted_password is distinct from new.encrypted_password then raise exception 'PASSWORD_PROOF_REQUIRED'; end if;
  if current_user_row.raw_app_meta_data ? 'barber_admin_password_operation' then
    op:=(current_user_row.raw_app_meta_data->>'barber_admin_password_operation')::uuid;
    select * into admin_guard from private.admin_password_reset_guards where id=op and target_id=old.id for update;
    if admin_guard.id is null or not exists(select 1 from auth.users where id=admin_guard.actor_id
      and raw_app_meta_data->>'role'='admin' and deleted_at is null and (banned_until is null or banned_until<=now())) then raise exception 'PASSWORD_PROOF_REQUIRED'; end if;
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
$$;
revoke all on function private.enforce_customer_password_proof() from public,anon,authenticated,service_role;
-- GoTrue updates the password before app_metadata, inside one transaction.
-- Check the final row at COMMIT; the operation marker never becomes visible.
create constraint trigger enforce_customer_password_proof after update on auth.users
deferrable initially deferred for each row when (old.encrypted_password is distinct from new.encrypted_password)
execute function private.enforce_customer_password_proof();

-- Retire the former ordinary-session-only path without editing applied SQL or
-- replacing the Test-only account/activity implementation underneath it.
create or replace function public.customer_account_api(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_action='email-reset-guard' then raise exception 'PASSWORD_PROOF_REQUIRED'; end if;
  return private.customer_account_api(p_action,p_data);
end;
$$;
revoke all on function public.customer_account_api(text,jsonb) from public,anon,authenticated;
grant execute on function public.customer_account_api(text,jsonb) to service_role;

create function public.enforce_password_session() returns void
language plpgsql security definer set search_path='' as $$
begin
  if to_regprocedure('public.enforce_account_session()') is not null then
    perform public.enforce_account_session();
  end if;
  if auth.jwt()->>'role'='authenticated' and auth.jwt()->'app_metadata'->>'role' in ('customer','manager','barber')
    and not public.customer_session_is_live(auth.uid(),nullif(auth.jwt()->>'session_id','')::uuid) then
    raise sqlstate 'PT401' using message='AUTH_REQUIRED';
  end if;
end;
$$;
revoke all on function public.enforce_password_session() from public;
grant execute on function public.enforce_password_session() to anon,authenticated,service_role;
do $$
declare existing text;
begin
  select split_part(cfg,'=',2) into existing from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,
    lateral unnest(s.setconfig) cfg where r.rolname='authenticator' and cfg like 'pgrst.db_pre_request=%';
  if coalesce(existing,'') not in ('','public.enforce_account_session','public.enforce_password_session') then raise exception 'Review existing pre-request hook before deploying'; end if;
  alter role authenticator set pgrst.db_pre_request='public.enforce_password_session';
end;
$$;
notify pgrst,'reload schema';
notify pgrst,'reload config';
