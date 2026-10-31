-- Email accounts can exist before a phone or business customer is chosen.
alter table private.customer_accounts alter column customer_id drop not null;
alter table private.customer_accounts alter column country_code drop not null;
alter table private.customer_accounts alter column phone drop not null;
alter table private.customer_accounts alter column phone_e164 drop not null;
-- A phone is contact data, not proof of ownership. Existing accounts remain untouched.
alter table private.customer_accounts drop constraint customer_accounts_phone_e164_key;

create or replace function private.customer_account_api(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  challenge private.customer_auth_challenges%rowtype;
  account private.customer_accounts%rowtype;
  account_user auth.users%rowtype;
  customer_id uuid;
  counter integer;
  valid boolean;
begin
  -- Email customers are independent of the phone-keyed business record.
  -- Identity and live session are supplied only by the service gateway.
  if p_action in ('email-ensure','profile','update-profile','bookings','logout','social-status') then
    select u.* into account_user from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=nullif(p_data->>'user_id','')::uuid and s.id=nullif(p_data->>'session_id','')::uuid
      and u.raw_app_meta_data->>'role'='customer' and u.email_confirmed_at is not null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
    if account_user.id is not null then
      select * into account from private.customer_accounts where user_id=account_user.id;
      if p_action='email-ensure' then
        if account.user_id is null then
          if length(trim(coalesce(p_data->>'name',''))) not between 2 and 120 then return jsonb_build_object('needsName',true); end if;
          insert into private.customer_accounts(user_id,name,email) values(account_user.id,trim(p_data->>'name'),account_user.email) returning * into account;
        end if;
        if account.customer_id is not null then return private.customer_account_api('profile',p_data); end if;
        return jsonb_build_object('id',account.user_id,'name',account.name,'phone',account.phone,'countryCode',account.country_code,'email',account_user.email);
      end if;
      if p_action='social-status' and (account.user_id is null or account.customer_id is null) then
        return jsonb_build_object('profile',case when account.user_id is null then null else private.customer_account_api('profile',p_data) end);
      end if;
      if account.user_id is not null and account.customer_id is null then
        if p_action='logout' then
          delete from auth.sessions where id=(p_data->>'session_id')::uuid and user_id=account_user.id;
          return jsonb_build_object('success',true);
        elsif p_action='update-profile' then
          if length(trim(coalesce(p_data->>'name',''))) not between 2 and 120 then raise exception 'INVALID_DETAILS'; end if;
          update private.customer_accounts set name=trim(p_data->>'name'),
            phone=case when p_data ? 'phone' then nullif(p_data->>'phone','') else phone end,
            country_code=case when p_data ? 'phone' then nullif(p_data->>'country_code','') else country_code end,
            phone_e164=case when p_data ? 'phone' then nullif((p_data->>'country_code')||(p_data->>'phone'),'') else phone_e164 end,
            email=account_user.email where user_id=account.user_id returning * into account;
        elsif p_action='bookings' then
          return (select coalesce(jsonb_agg(row_to_json(b)),'[]'::jsonb) from (
            select b.id,b.date,to_char(b.date+b.time,'HH24:MI') as time,b.duration,b.price,b.status,
              br.name as shop_name,br.name_ar as shop_name_ar,ba.name as barber_name,ba.name_ar as barber_name_ar,
              (select jsonb_agg(jsonb_build_object('name',s.name,'name_ar',s.name_ar)) from public.services s where s.id=any(b.service_ids)) as services
            from private.customer_booking_owners o join public.bookings b on b.id=o.booking_id
              join public.branches br on br.id=b.branch_id join public.barbers ba on ba.id=b.barber_id
            where o.account_user_id=account.user_id order by b.date desc,b.time desc limit 50
          ) b);
        end if;
        return jsonb_build_object('id',account.user_id,'name',account.name,'phone',account.phone,'countryCode',account.country_code,'email',account_user.email);
      end if;
    elsif p_action='email-ensure' then raise exception 'AUTH_REQUIRED';
    end if;
  end if;
  if p_action='email-lookup' then
    select * into account_user from auth.users where lower(email)=lower(trim(p_data->>'email'))
      and raw_app_meta_data->>'role'='customer' and deleted_at is null and (banned_until is null or banned_until<=now());
    if account_user.id is null then return 'null'::jsonb; end if;
    return jsonb_build_object('id',account_user.id,'confirmed',account_user.email_confirmed_at is not null);
  end if;
  if p_action='email-reset-guard' then
    select u.* into account_user from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=nullif(p_data->>'user_id','')::uuid and s.id=nullif(p_data->>'session_id','')::uuid
      and u.raw_app_meta_data->>'role'='customer' and u.email_confirmed_at is not null and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now()) for update of u;
    if account_user.id is null then raise exception 'AUTH_REQUIRED'; end if;
    insert into private.customer_password_reset_guards(id,user_id) values((p_data->>'guard_id')::uuid,account_user.id);
    return jsonb_build_object('success',true);
  end if;
  if p_action in ('social-status','social-link') then
    -- Both the live Auth session and provider identity must belong to this user.
    select u.* into account_user from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=(p_data->>'user_id')::uuid and s.id=(p_data->>'session_id')::uuid
      and u.raw_app_meta_data->>'role'='customer' and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
      and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider in ('google','apple'))
      for update of u;
    if account_user.id is null then raise exception 'AUTH_REQUIRED'; end if;
    select a.* into account from private.customer_accounts a where a.user_id=account_user.id
      or a.user_id=(select account_user_id from private.customer_social_identities where user_id=account_user.id);
    if p_action='social-status' then
      return jsonb_build_object('profile',case when account.user_id is null then null else private.customer_account_api('profile',p_data) end);
    end if;
    if account.user_id is not null then return private.customer_account_api('profile',p_data); end if;
    -- Only a consumed, session-bound phone challenge can attach an identity.
    if not exists(select 1 from private.customer_auth_challenges ch where ch.purpose='social'
      and ch.consumed_at is not null and ch.id=(p_data->>'challenge_id')::uuid
      and ch.payload->>'social_user_id'=account_user.id::text
      and ch.payload->>'social_session_id'=p_data->>'session_id'
      and ch.phone_e164=p_data->>'phone_e164' and ch.expires_at>now()) then raise exception 'INVALID_CODE'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_data->>'phone_e164',0));
    select * into account from private.customer_accounts where phone_e164=p_data->>'phone_e164';
    if account.user_id is null then
      if nullif(account_user.phone,'') is not null and '+'||ltrim(account_user.phone,'+')<>p_data->>'phone_e164' then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
      update auth.users set phone=ltrim(p_data->>'phone_e164','+'),phone_confirmed_at=now() where id=account_user.id;
      perform private.customer_account_api('link',p_data||jsonb_build_object('email',''));
    else
      if exists(select 1 from private.customer_password_reset_guards where user_id=account.user_id) then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
      insert into private.customer_social_identities(user_id,account_user_id) values(account_user.id,account.user_id);
    end if;
    return private.customer_account_api('profile',p_data);
  elsif p_action='limit' then
    if p_data->>'key' !~ '^[0-9a-f]{64}$' or (p_data->>'max')::integer not between 1 and 100 then raise exception 'INVALID_REQUEST'; end if;
    insert into private.customer_auth_limits as l(key) values(p_data->>'key')
    on conflict(key) do update set
      attempts=case when l.window_start < now()-interval '15 minutes' then 1 else l.attempts+1 end,
      window_start=case when l.window_start < now()-interval '15 minutes' then now() else l.window_start end
    returning attempts into counter;
    return to_jsonb(counter <= (p_data->>'max')::integer);
  elsif p_action='issue' then
    delete from private.customer_auth_challenges where expires_at < now()-interval '1 day';
    delete from private.customer_auth_limits where window_start < now()-interval '1 day';
    insert into private.customer_auth_challenges(id,purpose,phone_e164,code_hash,payload)
    values((p_data->>'id')::uuid,p_data->>'purpose',p_data->>'phone_e164',p_data->>'code_hash',p_data->'payload');
    return jsonb_build_object('id',p_data->>'id');
  elsif p_action='lookup' then
    select a.* into account from private.customer_accounts a join auth.users u on u.id=a.user_id
      join public.customers c on c.id=a.customer_id
      where a.phone_e164=p_data->>'phone_e164' and u.raw_app_meta_data->>'role'='customer'
        and u.phone_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) and u.deleted_at is null and '+'||ltrim(u.phone,'+')=a.phone_e164 and c.status='active';
    return case when account.user_id is null then 'null'::jsonb else to_jsonb(account) end;
  elsif p_action='consume' then
    select * into challenge from private.customer_auth_challenges where id=(p_data->>'id')::uuid
      and (purpose<>'social' or (payload->>'social_user_id'=p_data->>'user_id' and payload->>'social_session_id'=p_data->>'session_id')) for update;
    if not found or challenge.purpose is distinct from p_data->>'purpose' or challenge.consumed_at is not null
      or challenge.expires_at <= now() or challenge.attempts >= 5 then return 'null'::jsonb; end if;
    valid := challenge.code_hash is not distinct from p_data->>'code_hash';
    update private.customer_auth_challenges set attempts=attempts+1,consumed_at=case when valid then now() else null end where id=challenge.id;
    if not valid then return 'null'::jsonb; end if;
    if challenge.purpose='recovery' then
      select * into account from private.customer_accounts where phone_e164=challenge.phone_e164;
      select * into account_user from auth.users where id=account.user_id for update;
      if account.user_id is null or account_user.raw_app_meta_data->>'role' is distinct from 'customer'
        or account_user.phone_confirmed_at is null or account_user.banned_until>now() or account_user.deleted_at is not null or '+'||ltrim(account_user.phone,'+') is distinct from challenge.phone_e164
        or not exists(select 1 from public.customers where id=account.customer_id and status='active') then
        return jsonb_build_object('unavailable',true);
      end if;
      insert into private.customer_password_reset_guards(id,user_id) values(challenge.id,account.user_id);
      return challenge.payload||jsonb_build_object('user_id',account.user_id,'guard_id',challenge.id);
    end if;
    return challenge.payload||jsonb_build_object('challenge_id',challenge.id);
  elsif p_action='link' then
    select * into account_user from auth.users where id=(p_data->>'user_id')::uuid for update;
    if account_user.raw_app_meta_data->>'role' is distinct from 'customer' or account_user.phone_confirmed_at is null
      or '+'||ltrim(account_user.phone,'+') is distinct from p_data->>'phone_e164' then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
    if exists(select 1 from public.customers where country_code=p_data->>'country_code' and phone=p_data->>'phone' and status<>'active') then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
    insert into public.customers as c(name,country_code,phone,email,created_by_type)
      values(p_data->>'name',p_data->>'country_code',p_data->>'phone',nullif(p_data->>'email',''),'customer')
      on conflict(country_code,phone) do update set name=excluded.name,email=excluded.email,updated_at=now()
      returning c.id into customer_id;
    insert into private.customer_accounts(user_id,customer_id,name,country_code,phone,phone_e164,email)
      values(account_user.id,customer_id,p_data->>'name',p_data->>'country_code',p_data->>'phone',p_data->>'phone_e164',nullif(p_data->>'email',''));
    return jsonb_build_object('success',true);
  elsif p_action='finish-reset' then
    if not exists(select 1 from private.customer_password_reset_guards where id=(p_data->>'guard_id')::uuid and user_id=(p_data->>'user_id')::uuid) then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
    -- Refresh tokens cascade from sessions; old access tokens also fail the
    -- explicit live-session check below on every customer operation.
    delete from auth.sessions where user_id=(p_data->>'user_id')::uuid or user_id in (select user_id from private.customer_social_identities where account_user_id=(p_data->>'user_id')::uuid);
    delete from private.customer_password_reset_guards where id=(p_data->>'guard_id')::uuid;
    return jsonb_build_object('success',true);
  end if;
  if p_action not in ('profile','update-profile','bookings','logout') then raise exception 'INVALID_REQUEST'; end if;
  select a.* into account from private.customer_accounts a join auth.users u on u.id=a.user_id
    join auth.sessions s on (s.user_id=u.id or exists(select 1 from private.customer_social_identities si where si.user_id=s.user_id and si.account_user_id=u.id))
    join auth.users login_user on login_user.id=s.user_id join public.customers c on c.id=a.customer_id
    where s.user_id=(p_data->>'user_id')::uuid and login_user.raw_app_meta_data->>'role'='customer'
      and login_user.deleted_at is null and (login_user.banned_until is null or login_user.banned_until<=now()) and s.id=(p_data->>'session_id')::uuid
      and u.raw_app_meta_data->>'role'='customer' and u.phone_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) and u.deleted_at is null
      and '+'||ltrim(u.phone,'+')=a.phone_e164 and c.status='active';
  if account.user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action='logout' then
    delete from auth.sessions where id=(p_data->>'session_id')::uuid and user_id=(p_data->>'user_id')::uuid;
    return jsonb_build_object('success',true);
  elsif p_action='update-profile' then
    if length(trim(p_data->>'name')) not between 2 and 120 or length(coalesce(p_data->>'email',''))>254 then raise exception 'INVALID_DETAILS'; end if;
    update private.customer_accounts set name=trim(p_data->>'name'),email=nullif(p_data->>'email','') where user_id=account.user_id returning * into account;
    update public.customers set name=account.name,email=account.email,updated_at=now() where id=account.customer_id;
  elsif p_action='bookings' then
    return (select coalesce(jsonb_agg(row_to_json(b)),'[]'::jsonb) from (
      select b.id,b.date,to_char(b.date+b.time,'HH24:MI') as time,b.duration,b.price,b.status,
        br.name as shop_name,br.name_ar as shop_name_ar,ba.name as barber_name,ba.name_ar as barber_name_ar,
        (select jsonb_agg(jsonb_build_object('name',s.name,'name_ar',s.name_ar)) from public.services s where s.id=any(b.service_ids)) as services
      from public.bookings b join public.branches br on br.id=b.branch_id join public.barbers ba on ba.id=b.barber_id
      where (b.customer_id=account.customer_id and exists(select 1 from auth.users legacy where legacy.id=account.user_id and legacy.phone_confirmed_at is not null))
         or exists(select 1 from private.customer_booking_owners owner where owner.booking_id=b.id and owner.account_user_id=account.user_id)
      order by b.date desc,b.time desc limit 50
    ) b);
  end if;
  return jsonb_build_object('id',account.user_id,'name',account.name,'phone',account.phone,'countryCode',account.country_code,'email',account.email);
end;
$$;
