begin;
create table private.customer_native_email_requests(
 id uuid primary key,
 client text not null check(client='android'),
 purpose text not null default 'signup' check(purpose='signup'),
 user_id uuid references auth.users(id) on delete cascade,
 email text not null check(length(email)<=254),
 native_state uuid not null,
 native_challenge text not null check(native_challenge~'^[A-Za-z0-9_-]{43}$'),
 pending_hash text not null check(pending_hash~'^[0-9a-f]{64}$'),
 token_hash text,
 delivery_hash text,
 operation uuid,
 state text not null default 'pending' check(state in('pending','ready','verifying','verified','failed')),
 attempts integer not null default 0 check(attempts between 0 and 10),
 resends integer not null default 0 check(resends between 0 and 5),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '1 hour'
);
create index customer_native_email_requests_expiry on private.customer_native_email_requests(expires_at);
create index customer_native_email_requests_user on private.customer_native_email_requests(user_id);
alter table private.customer_native_email_requests enable row level security;
revoke all on private.customer_native_email_requests from public,anon,authenticated,service_role;

create function public.customer_native_email_api(p_action text,p_data jsonb default '{}')returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.customer_native_email_requests;person auth.users;rid uuid:=nullif(p_data->>'request_id','')::uuid;delivery uuid;op uuid;secs integer;
begin
 if p_action='start' then
  if p_data->>'client' is distinct from 'android' or rid is null
   or coalesce(p_data->>'email','')='' or coalesce(p_data->>'native_challenge','')!~'^[A-Za-z0-9_-]{43}$'
   or nullif(p_data->>'native_state','')is null or nullif(p_data->>'pending_handle','')is null then raise exception 'INVALID_REQUEST';end if;
  select * into person from auth.users where id=nullif(p_data->>'user_id','')::uuid;
  if person.id is not null and(lower(person.email)is distinct from p_data->>'email' or person.raw_app_meta_data->>'role' is distinct from 'customer'
   or person.email_confirmed_at is not null or person.deleted_at is not null or person.banned_until>now())then raise exception 'INVALID_REQUEST';end if;
  -- Only this transient protocol's expired rows; no account, booking or other proof is removed.
  delete from private.customer_native_email_requests where id in(select id from private.customer_native_email_requests where expires_at<now()-interval '24 hours' order by expires_at limit 500);
  insert into private.customer_native_email_requests(id,client,user_id,email,native_state,native_challenge,pending_hash)
   values(rid,'android',person.id,lower(p_data->>'email'),(p_data->>'native_state')::uuid,p_data->>'native_challenge',encode(extensions.digest((p_data->>'pending_handle')::uuid::text,'sha256'),'hex'));
  return jsonb_build_object('success',true);
 end if;
 select * into r from private.customer_native_email_requests where id=rid for update;
 if r.id is null or r.expires_at<=clock_timestamp() then raise exception 'INVALID_CODE';end if;
 if p_action='delivery-failed' then
  if r.state='pending' then update private.customer_native_email_requests set state='failed',token_hash=null,delivery_hash=null where id=r.id;end if;
  return jsonb_build_object('success',true);
 end if;
 select * into person from auth.users where id=r.user_id for update;
 if p_action='ready' then
  if r.state<>'pending' then raise exception 'INVALID_CODE';end if;
  if r.user_id is not null and(person.id is null or person.raw_app_meta_data->>'role' is distinct from 'customer'
   or lower(person.email)is distinct from r.email or person.email_confirmed_at is not null or person.deleted_at is not null or person.banned_until>now())then raise exception 'INVALID_CODE';end if;
  update private.customer_native_email_requests set state='ready',token_hash=nullif(person.confirmation_token,'')where id=r.id;
  return jsonb_build_object('success',true);
 end if;
 if p_data->>'client' is distinct from r.client or nullif(p_data->>'native_state','')::uuid is distinct from r.native_state then raise exception 'INVALID_CODE';end if;
 secs:=greatest(0,floor(extract(epoch from(r.expires_at-clock_timestamp())))::integer);
 if p_action in('status','resend')then
  if r.pending_hash is distinct from encode(extensions.digest((p_data->>'pending_handle')::uuid::text,'sha256'),'hex')
   or p_data->>'native_challenge' is distinct from r.native_challenge then raise exception 'INVALID_CODE';end if;
  if p_action='status' then return jsonb_build_object('status',r.state,'expiresIn',secs,'email',r.email);end if;
  if r.state not in('ready','failed')or r.resends>=5 then raise exception 'INVALID_CODE';end if;
  if r.user_id is not null and(person.raw_app_meta_data->>'role' is distinct from 'customer' or person.email_confirmed_at is not null
   or lower(person.email)is distinct from r.email or person.deleted_at is not null or person.banned_until>now())then raise exception 'INVALID_CODE';end if;
  update private.customer_native_email_requests set state='pending',resends=resends+1,token_hash=null,delivery_hash=null,operation=null where id=r.id;
  return jsonb_build_object('email',r.email,'deliver',r.user_id is not null,'expiresIn',secs);
 end if;
 if p_action in('invalid-code','uncertain','verified')then
  if r.state<>'verifying' or r.operation is distinct from nullif(p_data->>'operation','')::uuid then raise exception 'INVALID_CODE';end if;
  if p_action='verified' then
   if nullif(p_data->>'user_id','')::uuid is distinct from r.user_id or person.raw_app_meta_data->>'role' is distinct from 'customer'
    or lower(person.email)is distinct from r.email or person.email_confirmed_at is null or person.deleted_at is not null or person.banned_until>now()
    or not public.customer_session_is_live(r.user_id,nullif(p_data->>'session_id','')::uuid)
    or not exists(select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id where s.id=nullif(p_data->>'session_id','')::uuid
     and s.user_id=r.user_id and s.created_at>=r.created_at-interval '5 seconds'and s.created_at>now()-interval '1 minute'
     and a.authentication_method in('otp','email','signup','magiclink'))then raise exception 'INVALID_CODE';end if;
   update private.customer_native_email_requests set state='verified',token_hash=null,delivery_hash=null,operation=null where id=r.id;
  else
   update private.customer_native_email_requests set state=case when p_action='uncertain'or attempts>=10 then'failed'else'ready'end,operation=null where id=r.id;
  end if;
  return jsonb_build_object('success',true);
 end if;
 if r.state<>'ready' or r.user_id is null or r.token_hash is null or r.token_hash is distinct from person.confirmation_token
  or person.raw_app_meta_data->>'role' is distinct from 'customer' or lower(person.email)is distinct from r.email
  or person.email_confirmed_at is not null or person.deleted_at is not null or person.banned_until>now()then raise exception 'INVALID_CODE';end if;
 if p_action='delivery' then
  if p_data->>'token_hash' is distinct from r.token_hash then raise exception 'INVALID_CODE';end if;
  delivery:=gen_random_uuid();update private.customer_native_email_requests set delivery_hash=encode(extensions.digest(delivery::text,'sha256'),'hex')where id=r.id;
  return jsonb_build_object('deliveryToken',delivery);
 elsif p_action='reserve' then
  if p_data->>'native_challenge' is distinct from r.native_challenge or r.attempts>=10
   or(p_data?'delivery_token'and(r.delivery_hash is null or r.delivery_hash is distinct from encode(extensions.digest((p_data->>'delivery_token')::uuid::text,'sha256'),'hex')))then raise exception 'INVALID_CODE';end if;
  op:=gen_random_uuid();update private.customer_native_email_requests set state='verifying',operation=op,attempts=attempts+1,delivery_hash=null where id=r.id;
  return jsonb_build_object('userId',r.user_id,'email',r.email,'tokenHash',r.token_hash,'operation',op);
 end if;
 raise exception 'INVALID_REQUEST';
end$$;
revoke all on function public.customer_native_email_api(text,jsonb)from public,anon,authenticated;
grant execute on function public.customer_native_email_api(text,jsonb)to service_role;
comment on function public.customer_native_email_api(text,jsonb)is 'Service-only Android native signup binding. Test activation only; device verifier and provider OTP are both required. No browser session handoff.';
commit;
