begin;

-- Preserve the original public field whitelist. Never accept snapshots from clients.
create function private.booking_share_snapshot(p_booking uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
   'reference',upper(left(replace(b.id::text,'-',''),10)),
   'date',b.date,'time',to_char(b.time,'HH24:MI'),'duration',b.duration,'price',b.price,'status',b.status,
   'expiresAt',((b.date+b.time+make_interval(mins=>b.duration)) at time zone 'Asia/Kuwait')+interval '24 hours','updatedAt',b.updated_at,
   'shop',s.name,'shopAr',s.name_ar,'shopImage',s.image_url,'address',s.address,'city',s.city,'locationUrl',s.location_url,
   'barber',bar.name,'barberAr',bar.name_ar,'barberImage',bar.avatar_url,
   'services',case when jsonb_typeof(b.service_snapshot)='array' then
     (select coalesce(jsonb_agg(jsonb_build_object('name',x->>'name','nameAr',x->>'name_ar','quantity',x->'quantity')),'[]')from jsonb_array_elements(b.service_snapshot)x)
    else (select coalesce(jsonb_agg(jsonb_build_object('name',sv.name,'nameAr',sv.name_ar,'quantity',1)order by sv.name),'[]')from public.services sv where sv.id=any(b.service_ids))end,
   'package',case when b.package_snapshot is not null then jsonb_build_object('name',b.package_snapshot->>'name','nameAr',b.package_snapshot->>'name_ar')end
  )from public.bookings b join public.branches s on s.id=b.branch_id join public.barbers bar on bar.id=b.barber_id where b.id=p_booking;
$$;
revoke all on function private.booking_share_snapshot(uuid) from public,anon,authenticated;
grant execute on function private.booking_share_snapshot(uuid) to service_role;

-- Additive storage: preserve the legacy table unchanged for release recovery.
create table private.customer_booking_share_versions (
 booking_id uuid not null references public.bookings(id) on delete cascade,
 id uuid primary key, nonce uuid not null,
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 customer_id uuid not null references public.customers(id),
 account_user_id uuid references auth.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(), revoked_at timestamptz,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 expires_at timestamptz not null, snapshot_at timestamptz not null
);
alter table private.customer_booking_share_versions enable row level security;
revoke all on private.customer_booking_share_versions from public,anon,authenticated;
grant select,insert,update,delete on private.customer_booking_share_versions to service_role;
create index customer_booking_share_versions_booking on private.customer_booking_share_versions(booking_id,created_at desc) where revoked_at is null;

-- Legacy links keep their token and freeze currently visible details at upgrade
-- time. Earlier live versions were never retained and cannot be reconstructed.
insert into private.customer_booking_share_versions(booking_id,id,nonce,token_hash,customer_id,account_user_id,created_at,revoked_at,snapshot,expires_at,snapshot_at)
 select l.booking_id,l.id,l.nonce,l.token_hash,l.customer_id,l.account_user_id,l.created_at,l.revoked_at,
  captured,(captured->>'expiresAt')::timestamptz,clock_timestamp()
 from private.customer_booking_shares l cross join lateral (select private.booking_share_snapshot(l.booking_id) captured) c;

create function private.protect_booking_share_snapshot() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.booking_id,new.id,new.nonce,new.token_hash,new.customer_id,new.account_user_id,new.created_at,new.snapshot,new.expires_at,new.snapshot_at)
  is distinct from (old.booking_id,old.id,old.nonce,old.token_hash,old.customer_id,old.account_user_id,old.created_at,old.snapshot,old.expires_at,old.snapshot_at)
  or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
  raise exception 'SHARE_SNAPSHOT_IMMUTABLE';
 end if;
 return new;
end $$;
revoke all on function private.protect_booking_share_snapshot() from public,anon,authenticated;
create trigger protect_booking_share_snapshot before update on private.customer_booking_share_versions
 for each row execute function private.protect_booking_share_snapshot();

create or replace function public.customer_booking_share(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 b public.bookings%rowtype;
 link private.customer_booking_share_versions%rowtype;
 owner_id uuid;
 profile jsonb;
 account_id uuid;
 expiry timestamptz;
 receipt jsonb;
 captured jsonb;
begin
 if p_action is null or p_action not in ('create','revoke','view') then raise exception 'INVALID_REQUEST';end if;
 if p_action='view' then
  if coalesce(p_data->>'hash','') !~ '^[0-9a-f]{64}$' then raise exception 'LINK_UNAVAILABLE';end if;
  select * into link from private.customer_booking_share_versions where token_hash=p_data->>'hash' and revoked_at is null;
  if not found or link.expires_at<=clock_timestamp() then raise exception 'LINK_UNAVAILABLE';end if;
  select * into b from public.bookings where id=link.booking_id;
 else
  select * into b from public.bookings where id=(p_data->>'booking_id')::uuid for update;
  if not found then raise exception 'LINK_UNAVAILABLE';end if;
 end if;
 if b.id is null or b.customer_id is null then raise exception 'LINK_UNAVAILABLE';end if;
 select account_user_id into owner_id from private.customer_booking_owners where booking_id=b.id;
 if p_action='view' then
  -- Keep the live ownership boundary; appointment edits never alter the snapshot.
  if b.customer_id is distinct from link.customer_id or owner_id is distinct from link.account_user_id then raise exception 'LINK_UNAVAILABLE';end if;
  return link.snapshot||jsonb_build_object('sharedAt',link.snapshot_at);
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
  update private.customer_booking_share_versions set revoked_at=clock_timestamp() where booking_id=b.id and revoked_at is null;
  return jsonb_build_object('sharing',false);
 end if;
 captured:=private.booking_share_snapshot(b.id);
 expiry:=(captured->>'expiresAt')::timestamptz;
 if captured is null or expiry is null or expiry<=clock_timestamp() then raise exception 'LINK_UNAVAILABLE';end if;
 -- Private notes/audit timestamps do not create a different public version.
 select * into link from private.customer_booking_share_versions
  where booking_id=b.id and revoked_at is null and expires_at>clock_timestamp()
    and customer_id=b.customer_id and account_user_id is not distinct from owner_id
    and snapshot-'updatedAt'=captured-'updatedAt'
  order by created_at desc,id desc limit 1;
 if not found then
  if coalesce(p_data->>'hash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REQUEST';end if;
  insert into private.customer_booking_share_versions(booking_id,id,nonce,token_hash,customer_id,account_user_id,snapshot,expires_at,snapshot_at)
   values(b.id,(p_data->>'id')::uuid,(p_data->>'nonce')::uuid,p_data->>'hash',b.customer_id,owner_id,captured,expiry,clock_timestamp())
   returning * into link;
 end if;
 return jsonb_build_object('id',link.id,'nonce',link.nonce,'hash',link.token_hash,'expiresAt',link.expires_at);
end $$;
revoke all on function public.customer_booking_share(text,jsonb) from public,anon,authenticated;
grant execute on function public.customer_booking_share(text,jsonb) to service_role;
comment on function public.customer_booking_share(text,jsonb) is 'Service-only immutable booking snapshots; live owner or sealed guest receipt required to create/revoke; view token cannot mutate a booking.';

commit;
