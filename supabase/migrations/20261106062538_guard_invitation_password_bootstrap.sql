-- Accept only the pinned Auth invitation bootstrap, followed by a separate one-use password proof.
create or replace function public.customer_password_api(p_action text,p_data jsonb default '{}') returns jsonb
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
  elsif p_action='invite-start' then
    select * into person from auth.users where confirmation_token=p_data->>'token_hash'
      and coalesce(confirmation_token,'')<>'' and invited_at is not null and email_confirmed_at is null
      and raw_app_meta_data->>'role'='barber' and deleted_at is null and (banned_until is null or banned_until<=now()) for update;
    if person.id is null or not exists(select 1 from public.barbers where user_id=person.id and invite_status in ('sent','pending')) then raise exception 'INVALID_CODE'; end if;
    delete from private.customer_password_reset_guards g using private.customer_password_proofs p
      where g.id=p.id and g.user_id=person.id and p.user_id=person.id and p.state='prepared' and p.expires_at<=now()
        and p.password_fingerprint=md5(coalesce(person.encrypted_password,''));
    if exists(select 1 from private.customer_password_reset_guards where user_id=person.id)
      or exists(select 1 from private.admin_password_reset_guards where target_id=person.id) then raise exception 'PASSWORD_CHANGE_IN_PROGRESS'; end if;
    request_id:=gen_random_uuid();
    insert into private.customer_password_requests(id,user_id,email,purpose,client,token_hash,state,expires_at)
      values(request_id,person.id,person.email,'invite','web',person.confirmation_token,'ready',now()+interval '1 minute');
    insert into private.customer_password_proofs(id,user_id,purpose,account_role,account_email,password_fingerprint,state,expires_at)
      values(request_id,person.id,'invite','barber',person.email,md5(coalesce(person.encrypted_password,'')),'prepared',now()+interval '1 minute');
    insert into private.customer_password_reset_guards(id,user_id) values(request_id,person.id);
    return jsonb_build_object('userId',person.id,'operation',request_id);
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

create or replace function private.enforce_customer_password_proof() returns trigger
language plpgsql security definer set search_path='' as $$
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

notify pgrst,'reload schema';
