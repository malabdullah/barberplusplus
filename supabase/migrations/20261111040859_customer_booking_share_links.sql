begin;

-- No raw viewing token or customer contact data is stored in a share link.
create table private.customer_booking_shares (
 booking_id uuid primary key references public.bookings(id) on delete cascade,
 id uuid not null unique, nonce uuid not null,
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 customer_id uuid not null references public.customers(id),
 account_user_id uuid references auth.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(), revoked_at timestamptz
);
alter table private.customer_booking_shares enable row level security;
revoke all on private.customer_booking_shares from public,anon,authenticated;
grant select,insert,update,delete on private.customer_booking_shares to service_role;

create function public.customer_booking_share(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 b public.bookings%rowtype;
 link private.customer_booking_shares%rowtype;
 owner_id uuid;
 profile jsonb;
 account_id uuid;
 expiry timestamptz;
 receipt jsonb;
begin
 if p_action is null or p_action not in ('create','revoke','view') then raise exception 'INVALID_REQUEST';end if;
 if p_action='view' then
  if coalesce(p_data->>'hash','') !~ '^[0-9a-f]{64}$' then raise exception 'LINK_UNAVAILABLE';end if;
  select * into link from private.customer_booking_shares where token_hash=p_data->>'hash' and revoked_at is null;
  if not found then raise exception 'LINK_UNAVAILABLE';end if;
  select * into b from public.bookings where id=link.booking_id;
 else
  select * into b from public.bookings where id=(p_data->>'booking_id')::uuid for update;
  if not found then raise exception 'LINK_UNAVAILABLE';end if;
 end if;
 if b.id is null or b.customer_id is null then raise exception 'LINK_UNAVAILABLE';end if;
 select account_user_id into owner_id from private.customer_booking_owners where booking_id=b.id;
 expiry:=((b.date+b.time+make_interval(mins=>b.duration)) at time zone 'Asia/Kuwait')+interval '24 hours';
 if p_action='view' then
  -- Reassignment or a guest-to-account transition must not preserve old access.
  if b.customer_id is distinct from link.customer_id or owner_id is distinct from link.account_user_id
   or expiry<=clock_timestamp() then raise exception 'LINK_UNAVAILABLE';end if;
  return (select jsonb_build_object(
   'reference',upper(left(replace(b.id::text,'-',''),10)),
   'date',b.date,'time',to_char(b.time,'HH24:MI'),'duration',b.duration,'price',b.price,'status',b.status,
   'expiresAt',expiry,'updatedAt',b.updated_at,
   'shop',s.name,'shopAr',s.name_ar,'shopImage',s.image_url,'address',s.address,'city',s.city,'locationUrl',s.location_url,
   'barber',bar.name,'barberAr',bar.name_ar,'barberImage',bar.avatar_url,
   'services',case when jsonb_typeof(b.service_snapshot)='array' then
     (select coalesce(jsonb_agg(jsonb_build_object('name',x->>'name','nameAr',x->>'name_ar','quantity',x->'quantity')),'[]')from jsonb_array_elements(b.service_snapshot)x)
    else (select coalesce(jsonb_agg(jsonb_build_object('name',sv.name,'nameAr',sv.name_ar,'quantity',1)order by sv.name),'[]')from public.services sv where sv.id=any(b.service_ids))end,
   'package',case when b.package_snapshot is not null then jsonb_build_object('name',b.package_snapshot->>'name','nameAr',b.package_snapshot->>'name_ar')end
  )from public.branches s join public.barbers bar on bar.id=b.barber_id where s.id=b.branch_id);
 end if;

 -- Identities and signed-receipt fields are supplied only by the authenticated gateway.
 if nullif(p_data->>'user_id','') is not null then
  profile:=private.customer_account_api('profile',jsonb_build_object('user_id',p_data->>'user_id','session_id',p_data->>'session_id'));
  account_id:=(profile->>'id')::uuid;
  if account_id is null or owner_id is distinct from account_id then raise exception 'LINK_UNAVAILABLE';end if;
 else
  receipt:=p_data->'receipt';
  if receipt is null or owner_id is not null or receipt->>'id' is distinct from b.id::text
    or b.created_at+interval '1 hour'<=clock_timestamp()
    or not exists(select 1 from public.customers c where c.id=b.customer_id and c.status='active' and (
      (receipt->>'guest_contact'='email' and lower(c.email)=receipt->>'email'
        and exists(select 1 from private.customer_booking_email_context ctx where ctx.booking_id=b.id and ctx.customer_id=b.customer_id and ctx.guest))
      or (receipt->>'guest_contact' is distinct from 'email' and c.phone is not null and c.phone=receipt->>'phone' and c.country_code=receipt->>'country_code')
    )) then raise exception 'LINK_UNAVAILABLE';end if;
 end if;
 if p_action='revoke' then
  update private.customer_booking_shares set revoked_at=clock_timestamp() where booking_id=b.id and revoked_at is null;
  return jsonb_build_object('sharing',false);
 end if;
 if expiry<=clock_timestamp() then raise exception 'LINK_UNAVAILABLE';end if;
 select * into link from private.customer_booking_shares where booking_id=b.id;
 if link.booking_id is null or link.revoked_at is not null or link.customer_id is distinct from b.customer_id or link.account_user_id is distinct from owner_id then
  if coalesce(p_data->>'hash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REQUEST';end if;
  insert into private.customer_booking_shares(booking_id,id,nonce,token_hash,customer_id,account_user_id)
   values(b.id,(p_data->>'id')::uuid,(p_data->>'nonce')::uuid,p_data->>'hash',b.customer_id,owner_id)
   on conflict(booking_id)do update set id=excluded.id,nonce=excluded.nonce,token_hash=excluded.token_hash,
    customer_id=excluded.customer_id,account_user_id=excluded.account_user_id,created_at=clock_timestamp(),revoked_at=null
   returning * into link;
 end if;
 return jsonb_build_object('id',link.id,'nonce',link.nonce,'hash',link.token_hash,'expiresAt',expiry);
end $$;
revoke all on function public.customer_booking_share(text,jsonb) from public,anon,authenticated;
grant execute on function public.customer_booking_share(text,jsonb) to service_role;
comment on function public.customer_booking_share(text,jsonb) is 'Service-only booking sharing. Gateway validates live owner or sealed original guest receipt. View returns only whitelisted appointment data.';

commit;
