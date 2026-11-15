begin;

-- One permanent, opaque identity per booking. No customer/Auth foreign keys,
-- snapshots or expiry: retained anonymized bookings retain their public identity.
create table private.booking_public_links (
 booking_id uuid primary key references public.bookings(id) on delete cascade,
 public_id text not null unique check(public_id ~ '^[0-9a-f]{64}$')
);
create unique index booking_public_links_token_hash on private.booking_public_links((encode(extensions.digest(public_id,'sha256'),'hex')));
create table private.booking_share_aliases (
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
 booking_id uuid not null references public.bookings(id) on delete cascade,
 revoked_at timestamptz
);
alter table private.booking_public_links enable row level security;
alter table private.booking_share_aliases enable row level security;
revoke all on private.booking_public_links,private.booking_share_aliases from public,anon,authenticated,service_role;
create index booking_share_aliases_booking on private.booking_share_aliases(booking_id);

-- Ambiguous historical mappings cannot be guessed. An explicit revocation in
-- either old store always wins over a duplicate unrevoked row; time expiry does not.
do $$begin
 if exists(select token_hash from (
  select token_hash,booking_id from private.customer_booking_shares
  union all select token_hash,booking_id from private.customer_booking_share_versions
 )l group by token_hash having count(distinct booking_id)>1)then
  raise exception 'AMBIGUOUS_LEGACY_SHARE_MAPPING';
 end if;
end$$;
insert into private.booking_share_aliases(token_hash,booking_id,revoked_at)
 select token_hash,(array_agg(booking_id))[1],max(revoked_at) from (
  select token_hash,booking_id,revoked_at from private.customer_booking_shares
  union all select token_hash,booking_id,revoked_at from private.customer_booking_share_versions
 )l group by token_hash;

-- Serialize only an identical token hash, not unrelated booking creation. This
-- guards the canonical/legacy namespace even during concurrent migration clients.
create function private.guard_booking_public_link()returns trigger
language plpgsql security definer set search_path='' as $$
declare h text;
begin
 if tg_op='UPDATE' then raise exception 'PUBLIC_LINK_IMMUTABLE';end if;
 h:=encode(extensions.digest(new.public_id,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(h,139147));
 if exists(select 1 from private.booking_share_aliases where token_hash=h)then raise exception 'SHARE_TOKEN_COLLISION';end if;
 return new;
end$$;
create trigger guard_booking_public_link before insert or update on private.booking_public_links
 for each row execute function private.guard_booking_public_link();
create function private.guard_booking_share_alias()returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if(new.token_hash,new.booking_id)is distinct from(old.token_hash,old.booking_id)
   or(old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)then raise exception 'SHARE_ALIAS_IMMUTABLE';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended(new.token_hash,139147));
  if exists(select 1 from private.booking_public_links where encode(extensions.digest(public_id,'sha256'),'hex')=new.token_hash)then raise exception 'SHARE_TOKEN_COLLISION';end if;
 end if;
 return new;
end$$;
create trigger guard_booking_share_alias before insert or update on private.booking_share_aliases
 for each row execute function private.guard_booking_share_alias();

-- Keep any in-flight old client/release alias and its explicit revocation.
-- Deleting old snapshot rows during PII cleanup must NOT delete these aliases.
create function private.remember_legacy_booking_share()returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.booking_share_aliases where token_hash=new.token_hash and booking_id<>new.booking_id)then raise exception 'AMBIGUOUS_LEGACY_SHARE_MAPPING';end if;
 insert into private.booking_share_aliases(token_hash,booking_id,revoked_at)values(new.token_hash,new.booking_id,new.revoked_at)
 on conflict(token_hash)do update set revoked_at=coalesce(private.booking_share_aliases.revoked_at,excluded.revoked_at);
 return new;
end$$;
create trigger remember_legacy_booking_share after insert or update of revoked_at on private.customer_booking_shares
 for each row execute function private.remember_legacy_booking_share();
create trigger remember_legacy_booking_share_version after insert or update of revoked_at on private.customer_booking_share_versions
 for each row execute function private.remember_legacy_booking_share();

create function private.provision_booking_public_link()returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.booking_public_links(booking_id,public_id)values(new.id,encode(extensions.gen_random_bytes(32),'hex'));
 return new;
end$$;
create trigger provision_booking_public_link after insert on public.bookings
 for each row execute function private.provision_booking_public_link();
-- Alias preparation and its collision guard precede this backfill.
insert into private.booking_public_links(booking_id,public_id)
 select id,encode(extensions.gen_random_bytes(32),'hex')from public.bookings;

create function private.booking_share_live(p_booking uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
   'reference',upper(left(replace(b.id::text,'-',''),10)),
   'date',b.date,'time',to_char(b.time,'HH24:MI'),'duration',b.duration,'price',b.price,'status',b.status,
   'shop',s.name,'shopAr',s.name_ar,'shopImage',s.image_url,'address',s.address,'city',s.city,'locationUrl',s.location_url,
   'barber',bar.name,'barberAr',bar.name_ar,'barberImage',bar.avatar_url,
   'services',case when jsonb_typeof(b.service_snapshot)='array' then
     (select coalesce(jsonb_agg(jsonb_build_object('name',x->>'name','nameAr',x->>'name_ar','quantity',x->'quantity')),'[]')from jsonb_array_elements(b.service_snapshot)x)
    else (select coalesce(jsonb_agg(jsonb_build_object('name',sv.name,'nameAr',sv.name_ar,'quantity',1)order by sv.name),'[]')from public.services sv where sv.id=any(b.service_ids))end,
   'package',case when b.package_snapshot is not null then jsonb_build_object('name',b.package_snapshot->>'name','nameAr',b.package_snapshot->>'name_ar')end
  )from public.bookings b join public.branches s on s.id=b.branch_id join public.barbers bar on bar.id=b.barber_id where b.id=p_booking;
$$;
revoke all on function private.booking_share_live(uuid) from public,anon,authenticated;
grant execute on function private.booking_share_live(uuid) to service_role;


create or replace function public.customer_booking_share(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 b public.bookings%rowtype;
 alias private.booking_share_aliases%rowtype;
 owner_id uuid;profile jsonb;account_id uuid;receipt jsonb;public_id text;resolved_booking uuid;captured jsonb;
begin
 if p_action is null or p_action not in('create','revoke','view','receipt')then raise exception 'INVALID_REQUEST';end if;
 if p_action='view'then
  if coalesce(p_data->>'hash','')!~'^[0-9a-f]{64}$'then raise exception 'LINK_UNAVAILABLE';end if;
  select * into alias from private.booking_share_aliases where token_hash=p_data->>'hash';
  if found then
   -- Alias-first lookup: a recorded revocation can never fall through.
   if alias.revoked_at is not null then raise exception 'LINK_UNAVAILABLE';end if;
   resolved_booking:=alias.booking_id;
  else
   if coalesce(p_data->>'token','')!~'^[0-9a-f]{64}$'
    or encode(extensions.digest(p_data->>'token','sha256'),'hex')is distinct from p_data->>'hash'then raise exception 'LINK_UNAVAILABLE';end if;
   select l.booking_id into resolved_booking from private.booking_public_links l where l.public_id=p_data->>'token';
  end if;
  captured:=private.booking_share_live(resolved_booking);
  if captured is null then raise exception 'LINK_UNAVAILABLE';end if;
  return captured;
 end if;
 select * into b from public.bookings where id=(p_data->>'booking_id')::uuid;
 if not found then raise exception 'LINK_UNAVAILABLE';end if;
 if p_action<>'receipt'then
  -- Only the gateway can call this RPC. The internal receipt action is never an
  -- HTTP action: customer-booking invokes it AFTER a validated booking/recovery.
  if b.customer_id is null then raise exception 'LINK_UNAVAILABLE';end if;
  select account_user_id into owner_id from private.customer_booking_owners where booking_id=b.id;
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

  if p_action='revoke'then raise exception 'PERMANENT_LINK';end if;
 end if;
 select l.public_id into public_id from private.booking_public_links l where l.booking_id=b.id;
 if public_id is null then raise exception 'LINK_UNAVAILABLE';end if;
 return jsonb_build_object('publicId',public_id,'permanent',true,'sharingVersion',2);
end$$;
revoke all on function public.customer_booking_share(text,jsonb)from public,anon,authenticated;
grant execute on function public.customer_booking_share(text,jsonb)to service_role;
revoke all on function private.guard_booking_public_link(),private.guard_booking_share_alias(),private.remember_legacy_booking_share(),private.provision_booking_public_link()from public,anon,authenticated,service_role;
comment on function public.customer_booking_share(text,jsonb)is 'Service-only permanent live booking sharing; URL lookup requires current ownership or sealed guest receipt. Internal receipt lookup is called only after validated booking/recovery. Legacy revoked aliases never resolve.';
commit;
