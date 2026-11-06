begin;

-- Email writes are atomic and auditable. No password, token or code is retained.
create table private.account_email_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  actor_id uuid,
  old_email text not null,
  new_email text not null,
  reason text not null,
  kind text not null check (kind in ('registration_correction','admin_change')),
  transaction_id bigint not null default txid_current(),
  created_at timestamptz not null default now()
);
alter table private.account_email_changes enable row level security;
revoke all on private.account_email_changes from public,anon,authenticated,service_role;
create index account_email_changes_user_idx on private.account_email_changes(user_id,created_at desc);

create function private.guard_account_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.email is distinct from old.email or (coalesce(new.email_change,'')<>'' and coalesce(new.email_change,'')<>coalesce(old.email_change,'')) then
    if not exists(select 1 from private.account_email_changes e
      where e.user_id=old.id and e.transaction_id=txid_current()
        and e.old_email=coalesce(old.email,'') and e.new_email=coalesce(new.email,'')
        and (e.kind='admin_change' or old.email_confirmed_at is null)) then
      raise exception 'EMAIL_ADMIN_ONLY' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_account_email() from public,anon,authenticated,service_role;
create trigger guard_account_email before update of email,email_change on auth.users
for each row execute function private.guard_account_email();

create function private.write_account_email(p_user uuid,p_email text,p_actor uuid,p_kind text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person auth.users%rowtype; normalized text:=lower(trim(coalesce(p_email,'')));
begin
  select * into person from auth.users where id=p_user and deleted_at is null for update;
  if person.id is null then raise exception 'INVALID_ACCOUNT'; end if;
  if length(normalized)>254 or normalized !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then raise exception 'INVALID_EMAIL'; end if;
  if normalized=lower(coalesce(person.email,'')) then raise exception 'EMAIL_UNCHANGED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('barber-account-email:'||normalized,0));
  if exists(select 1 from auth.users where id<>person.id and deleted_at is null and lower(email)=normalized)
    or exists(select 1 from auth.identities where user_id<>person.id and lower(identity_data->>'email')=normalized) then
    raise exception 'EMAIL_IN_USE';
  end if;
  if p_kind='registration_correction' and person.email_confirmed_at is not null then raise exception 'EMAIL_ADMIN_ONLY'; end if;
  insert into private.account_email_changes(user_id,actor_id,old_email,new_email,kind,reason)
  values(person.id,p_actor,coalesce(person.email,''),normalized,p_kind,p_reason);
  -- Invalidate old confirmation/recovery/email-change links in this transaction.
  update auth.users set email=normalized,confirmation_token='',confirmation_sent_at=null,
    recovery_token='',recovery_sent_at=null,email_change='',email_change_token_new='',email_change_token_current='',
    email_change_confirm_status=0,email_change_sent_at=null,updated_at=now()
    where id=person.id;
  update auth.identities set identity_data=identity_data||jsonb_build_object('email',normalized,
    'email_verified',person.email_confirmed_at is not null),updated_at=now()
    where user_id=person.id and provider='email';
  -- The existing Auth sync triggers maintain the one canonical customer profile.
  update public.barbers set email=normalized where user_id=person.id and email is distinct from normalized;
  delete from auth.sessions where user_id=person.id;
  return jsonb_build_object('id',person.id,'email',normalized,'verified',person.email_confirmed_at is not null);
end;
$$;
revoke all on function private.write_account_email(uuid,text,uuid,text,text) from public,anon,authenticated,service_role;

create function public.correct_registration_email(p_email text,p_new_email text,p_password text,p_audience text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person auth.users%rowtype; old_address text:=lower(trim(p_email));
begin
  if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if coalesce(p_audience,'') not in ('customer','team') or length(coalesce(p_password,''))<8 or octet_length(p_password)>72 then raise exception 'REGISTRATION_CANNOT_CORRECT'; end if;
  select * into person from auth.users where lower(email)=old_address and deleted_at is null for update;
  -- Recover safely from a lost response after a successful correction.
  if person.id is null then
    select u.* into person from auth.users u join private.account_email_changes e on e.user_id=u.id
      where e.old_email=old_address and e.new_email=lower(trim(p_new_email)) and e.kind='registration_correction'
        and e.created_at>now()-interval '10 minutes' and u.email=e.new_email and u.deleted_at is null
      order by e.created_at desc limit 1 for update of u;
  end if;
  if person.id is null or person.email_confirmed_at is not null or (person.banned_until is not null and person.banned_until>now())
    or coalesce(person.encrypted_password,'')='' or extensions.crypt(p_password,person.encrypted_password) is distinct from person.encrypted_password
    or not exists(select 1 from auth.identities where user_id=person.id and provider='email')
    or (p_audience='customer' and coalesce(person.raw_app_meta_data->>'role','')<>'customer')
    or (p_audience='team' and coalesce(person.raw_app_meta_data->>'role','') not in ('manager','barber','agent')) then
    raise exception 'REGISTRATION_CANNOT_CORRECT';
  end if;
  if lower(person.email)=lower(trim(p_new_email)) then return jsonb_build_object('id',person.id,'email',person.email,'verified',false); end if;
  return private.write_account_email(person.id,p_new_email,null,'registration_correction','Registrant corrected an unverified address');
end;
$$;
revoke all on function public.correct_registration_email(text,text,text,text) from public,anon,authenticated;
grant execute on function public.correct_registration_email(text,text,text,text) to service_role;

create function public.admin_account_email(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target auth.users%rowtype; result jsonb; page_number integer;
begin
  perform public.enforce_account_session();
  if actor is null or auth.jwt()->>'aal' is distinct from 'aal2' or not exists(select 1 from auth.users where id=actor and raw_app_meta_data->>'role'='admin' and deleted_at is null) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_action='list' then
    page_number:=coalesce((p_data->>'page')::integer,1);
    if page_number<1 or page_number>10000 then raise exception 'INVALID_REQUEST'; end if;
    select coalesce(jsonb_agg(x),'[]') into result from (
      select id,email,raw_user_meta_data->>'name' as name,raw_app_meta_data->>'role' as role,
        email_confirmed_at is not null as verified
      from auth.users where deleted_at is null order by created_at,id limit 25 offset (page_number-1)*25
    ) x;
    return jsonb_build_object('users',result,'hasMore',exists(select 1 from auth.users where deleted_at is null order by created_at,id offset page_number*25 limit 1));
  end if;
  if p_action<>'change' or length(trim(coalesce(p_data->>'reason','')))<8 or length(p_data->>'reason')>500 then raise exception 'INVALID_REQUEST'; end if;
  select * into target from auth.users where id=(p_data->>'userId')::uuid and deleted_at is null for update;
  if target.id is null or lower(coalesce(target.email,''))<>lower(coalesce(p_data->>'expectedEmail','')) then raise exception 'EMAIL_CHANGED_REFRESH'; end if;
  result:=private.write_account_email(target.id,p_data->>'newEmail',actor,'admin_change',trim(p_data->>'reason'));
  return result||jsonb_build_object('success',true,'signedOut',target.id=actor);
end;
$$;
revoke all on function public.admin_account_email(text,jsonb) from public,anon,service_role;
grant execute on function public.admin_account_email(text,jsonb) to authenticated;

-- Contact projections cannot be used to change the login identity indirectly.
create function private.guard_account_contact_email() returns trigger
language plpgsql security definer set search_path='' as $$
declare person uuid; primary_email text;
begin
  if new.email is not distinct from old.email then return new; end if;
  if tg_table_name='barbers' then person:=new.user_id;
  else select user_id into person from private.customer_accounts where customer_id=new.id;
  end if;
  if person is not null then
    select email into primary_email from auth.users where id=person;
    if coalesce(new.email,'') is distinct from coalesce(primary_email,'') then raise exception 'EMAIL_ADMIN_ONLY' using errcode='42501'; end if;
  elsif tg_table_name='barbers' and not public.is_admin() then
    raise exception 'EMAIL_ADMIN_ONLY' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_account_contact_email() from public,anon,authenticated,service_role;
create trigger guard_barber_account_email before update of email on public.barbers for each row execute function private.guard_account_contact_email();
create trigger guard_customer_account_email before update of email on public.customers for each row execute function private.guard_account_contact_email();

commit;
