-- Customer identities stay separate from staff registrations and internal notes.
create table private.customer_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_id uuid not null unique references public.customers(id) on delete restrict,
  name text not null check (length(name) between 2 and 120),
  country_code text not null,
  phone text not null,
  phone_e164 text not null unique,
  email text,
  created_at timestamptz not null default now()
);
create table private.customer_auth_challenges (
  id uuid primary key,
  purpose text not null check (purpose in ('signup','recovery')),
  phone_e164 text not null,
  code_hash text not null,
  payload jsonb not null,
  expires_at timestamptz not null default now() + interval '5 minutes',
  attempts integer not null default 0,
  consumed_at timestamptz
);
create table private.customer_auth_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
create table private.customer_password_reset_guards (
  id uuid primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.customer_accounts enable row level security;
alter table private.customer_auth_challenges enable row level security;
alter table private.customer_auth_limits enable row level security;
alter table private.customer_password_reset_guards enable row level security;
revoke all on private.customer_accounts, private.customer_auth_challenges,
  private.customer_auth_limits, private.customer_password_reset_guards from public, anon, authenticated, service_role;

create function private.block_customer_recovery_role_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (old.raw_app_meta_data ->> 'role') is distinct from (new.raw_app_meta_data ->> 'role')
     and exists(select 1 from private.customer_password_reset_guards where user_id=old.id) then
    raise exception 'Role change blocked by customer recovery guard';
  end if;
  return new;
end;
$$;
revoke all on function private.block_customer_recovery_role_changes() from public, anon, authenticated, service_role;
create trigger block_customer_recovery_role_changes before update of raw_app_meta_data on auth.users
for each row execute function private.block_customer_recovery_role_changes();

create function private.customer_account_api(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  challenge private.customer_auth_challenges%rowtype;
  account private.customer_accounts%rowtype;
  account_user auth.users%rowtype;
  customer_id uuid;
  counter integer;
  valid boolean;
begin
  if p_action='limit' then
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
    select * into challenge from private.customer_auth_challenges where id=(p_data->>'id')::uuid for update;
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
    return challenge.payload;
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
    delete from auth.sessions where user_id=(p_data->>'user_id')::uuid;
    delete from private.customer_password_reset_guards where id=(p_data->>'guard_id')::uuid;
    return jsonb_build_object('success',true);
  end if;
  if p_action not in ('profile','update-profile','bookings','logout') then raise exception 'INVALID_REQUEST'; end if;
  select a.* into account from private.customer_accounts a join auth.users u on u.id=a.user_id
    join auth.sessions s on s.user_id=u.id join public.customers c on c.id=a.customer_id
    where a.user_id=(p_data->>'user_id')::uuid and s.id=(p_data->>'session_id')::uuid
      and u.raw_app_meta_data->>'role'='customer' and u.phone_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) and u.deleted_at is null
      and '+'||ltrim(u.phone,'+')=a.phone_e164 and c.status='active';
  if account.user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action='logout' then
    delete from auth.sessions where id=(p_data->>'session_id')::uuid and user_id=account.user_id;
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
      where b.customer_id=account.customer_id order by b.date desc,b.time desc limit 50
    ) b);
  end if;
  return jsonb_build_object('id',account.user_id,'name',account.name,'phone',account.phone,'countryCode',account.country_code,'email',account.email);
end;
$$;
revoke all on function private.customer_account_api(text,jsonb) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.customer_account_api(text,jsonb) to service_role;
create function public.customer_account_api(p_action text,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.customer_account_api(p_action,p_data);$$;
revoke all on function public.customer_account_api(text,jsonb) from public, anon, authenticated;
grant execute on function public.customer_account_api(text,jsonb) to service_role;

-- Native public phone registrations must never inherit manager permissions.
-- The existing business email-registration flow retains its manager role.
create or replace function private.assign_default_manager_role() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.invited_at is null and coalesce(new.raw_app_meta_data->>'role','')='' then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('role',
      case when nullif(new.phone,'') is not null and nullif(new.email,'') is null then 'customer' else 'manager' end);
  end if;
  return new;
end;
$$;
revoke all on function private.assign_default_manager_role() from public,anon,authenticated;

-- Keep ownership consistent with CLI migration replay and existing application
-- objects, even when initially applying through the local administrator.
alter table private.customer_accounts owner to postgres;
alter table private.customer_auth_challenges owner to postgres;
alter table private.customer_auth_limits owner to postgres;
alter table private.customer_password_reset_guards owner to postgres;
alter function private.block_customer_recovery_role_changes() owner to postgres;
alter function private.customer_account_api(text,jsonb) owner to postgres;
alter function public.customer_account_api(text,jsonb) owner to postgres;
