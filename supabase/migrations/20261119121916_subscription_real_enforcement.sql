-- Portable gates default OFF. Hosted Test activation is a separate ops migration.
begin;
create table private.billing_enforcement (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
alter table private.billing_enforcement enable row level security;
revoke all on private.billing_enforcement from public,anon,authenticated,service_role;
insert into private.billing_enforcement(singleton,enabled)values(true,false);
create function private.billing_enforced()returns boolean
language sql stable security definer set search_path='' as $$select coalesce((select enabled from private.billing_enforcement where singleton),false);$$;

create function private.billing_shop_access(p_shop uuid,p_manual boolean default false)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.branches br
 left join private.billing_shops l on l.branch_id=br.id
 left join private.billing_subscriptions s on s.business_id=l.business_id
 cross join lateral(select private.billing_access(l.business_id) a) v
 where br.id=p_shop and br.status='active' and (
   not private.billing_enforced() and(br.publication_state='published' or p_manual and br.publication_state='paused'and br.paused_manual_booking_allowed)
   or private.billing_enforced() and br.publication_state in('published','paused') and (
    (v.a->>'fullAccess')::boolean and (br.publication_state='published' or p_manual and br.paused_manual_booking_allowed)
     and(v.a->>'status'not in('active','grace')or private.billing_active_count(l.business_id)<=s.paid_capacity)
    or p_manual and(v.a->'manualBranchIds')?br.id::text
   )
  ));
$$;

-- Shared lock order: business UUID ascending, then refreshed capacity. Updating
-- revision also makes repeatable-read contenders retry rather than overbook.
create function private.billing_lock_businesses(p_ids uuid[])returns void
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 for target in select distinct x from unnest(p_ids)x where x is not null order by x loop
  update private.billing_subscriptions set revision=revision+1 where business_id=target;
 end loop;
end$$;

create function private.billing_capacity_quote(p_business uuid,p_count integer)returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s private.billing_subscriptions%rowtype;a jsonb;now_at timestamptz:=clock_timestamp();extra bigint:=0;due bigint:=0;allowed boolean;why text;
begin
 if p_count is null or p_count not between 0 and 10000 then raise exception 'BILLING_INVALID';end if;
 select *into s from private.billing_subscriptions where business_id=p_business;
 if not found then raise exception 'BILLING_ACCESS_REQUIRED';end if;
 a:=private.billing_access(p_business,now_at);
 allowed:=not private.billing_enforced() or a->>'status'in('not_started','trial','transition','complimentary');
 if a->>'status'in('active','grace')then
  extra:=greatest(0,private.billing_price(p_count,s.frequency)-private.billing_price(s.paid_capacity,s.frequency));
  if p_count<=s.paid_capacity then allowed:=true;
  elsif a->>'status'='grace'then why:='BILLING_RENEW_REQUIRED';
  elsif extra=0 then allowed:=true;
  else
   due:=round(extra::numeric*extract(epoch from(s.period_ends_at-now_at))/extract(epoch from(s.period_ends_at-s.period_started_at)))::bigint;
   why:='BILLING_CAPACITY_REQUIRED';
  end if;
 end if;
 if not coalesce(allowed,false)and why is null then why:='BILLING_ACCESS_REQUIRED';end if;
 return jsonb_build_object('activeCount',private.billing_active_count(p_business),'requestedCount',p_count,'paidCapacity',s.paid_capacity,
  'allowed',coalesce(allowed,false),'reason',case when allowed then null else why end,'additionalFils',due,'currency','KWD',
  'nextRenewalFils',private.billing_price(p_count,coalesce(s.next_frequency,s.frequency)),
  'periodEndsAt',s.period_ends_at,'quotedAt',now_at,'revision',s.revision,'settled',false,'gatewayConnected',false);
end$$;

create function private.billing_guard_capacity()returns trigger
language plpgsql security definer set search_path='' as $$
declare old_business uuid;new_business uuid;was_counted boolean:=false;is_counted boolean:=false;a jsonb;quote jsonb;total integer;
begin
 if not private.billing_enforced()then return null;end if;
 if tg_op<>'INSERT'then
  select business_id into old_business from private.billing_shops where branch_id=old.branch_id;
  was_counted:=old.status='active'and(old.management_mode='managed'or old.manager_chair or old.user_id is not null and coalesce(old.invite_status,'accepted')='accepted');
 end if;
 if tg_op<>'DELETE'then
  select business_id into new_business from private.billing_shops where branch_id=new.branch_id;
  is_counted:=new.status='active'and(new.management_mode='managed'or new.manager_chair or new.user_id is not null and coalesce(new.invite_status,'accepted')='accepted');
 end if;
 if not was_counted and not is_counted then return null;end if;
 if tg_op='UPDATE'and was_counted=is_counted and old_business is not distinct from new_business then return null;end if;
 perform private.billing_lock_businesses(array[old_business,new_business]);
 if is_counted and(not was_counted or old_business is distinct from new_business)then
  if new_business is null then raise exception 'BILLING_ACCESS_REQUIRED';end if;
  total:=private.billing_active_count(new_business);
  quote:=private.billing_capacity_quote(new_business,total);
  a:=private.billing_access(new_business);
  -- A dated manual grant covers growth only in the selected shop.
  if not(quote->>'allowed')::boolean and not(a->>'status'not in('active','grace')and(a->'manualBranchIds')?new.branch_id::text) then
   raise exception '%',quote->>'reason' using detail=quote::text;
  end if;
  if a->>'status'='active'and(quote->>'allowed')::boolean then
   update private.billing_subscriptions set paid_capacity=greatest(paid_capacity,total)where business_id=new_business;
  end if;
 end if;
 return null;
end$$;
create trigger zz_billing_capacity after insert or update of status,branch_id,user_id,management_mode,manager_chair,invite_status or delete on public.barbers
 for each row execute function private.billing_guard_capacity();

create function private.billing_guard_publication()returns trigger
language plpgsql security definer set search_path='' as $$
declare business uuid;a jsonb;
begin
 if not private.billing_enforced()or new.status<>'active'or new.publication_state<>'published'then return null;end if;
 if tg_op='UPDATE'and(old.status,old.publication_state)is not distinct from(new.status,new.publication_state)then return null;end if;
 select business_id into business from private.billing_shops where branch_id=new.id;
 perform private.billing_lock_businesses(array[business]);
 a:=private.billing_access(business);
 if not coalesce((a->>'fullAccess')::boolean,false)then raise exception 'BILLING_ACCESS_REQUIRED';end if;
 if not private.billing_shop_access(new.id,false)then raise exception 'BILLING_CAPACITY_REQUIRED';end if;
 return null;
end$$;
create trigger zz_billing_publication after insert or update of publication_state,status on public.branches
 for each row execute function private.billing_guard_publication();

create function private.billing_guard_booking()returns trigger
language plpgsql security definer set search_path='' as $$
declare manual boolean;business uuid;target uuid;fresh boolean;
begin
 if not private.billing_enforced()then return new;end if;
 fresh:=tg_op='INSERT';
 if tg_op='UPDATE'then
  fresh:=new.branch_id is distinct from old.branch_id or new.customer_id is distinct from old.customer_id
    or old.status in('cancelled','no_show','completed')and new.status in('pending','confirmed');
 end if;
 if not fresh then return new;end if;
 -- RLS/RPC authorization is retained. Client-supplied audit labels cannot turn
 -- a customer gateway request into a manual reservation.
 manual:=auth.uid()is not null and auth.jwt()->>'role'='authenticated'and private.live_staff_role()in('manager','barber','admin','agent');
 select business_id into business from private.billing_shops where branch_id=new.branch_id;
 -- SHARE serializes new reservations against access/capacity changes. No lock
 -- on normal edits to existing reservations (avoids changing prior commitments).
 select business_id into target from private.billing_subscriptions where business_id=business for share;
 if not private.billing_shop_access(new.branch_id,coalesce(manual,false))then raise exception 'BILLING_BOOKING_UNAVAILABLE';end if;
 return new;
end$$;
create trigger ab_billing_booking before insert or update on public.bookings for each row execute function private.billing_guard_booking();

-- Refresh count after a business lock, including previous rows in a bulk write.
alter function private.billing_active_count(uuid)volatile;

-- Service-only legacy catalog filter. Public discovery uses the same predicate.
create function public.customer_bookable_shops()returns uuid[]
language sql stable security definer set search_path='' as $$select coalesce(array_agg(id),'{}')from public.branches where private.billing_shop_access(id,false);$$;
revoke all on function public.customer_bookable_shops()from public,anon,authenticated;
grant execute on function public.customer_bookable_shops()to service_role;

revoke all on function private.billing_enforced(),private.billing_shop_access(uuid,boolean),private.billing_lock_businesses(uuid[]),private.billing_capacity_quote(uuid,integer),private.billing_guard_capacity(),private.billing_guard_publication(),private.billing_guard_booking()from public,anon,authenticated,service_role;
-- Existing trusted service invokers need only this boolean predicate.
grant execute on function private.billing_shop_access(uuid,boolean)to service_role;
notify pgrst,'reload schema';

do $patch$
declare source text;fixed text;
begin
 source:=pg_get_functiondef('private.billing_access(uuid,timestamptz)'::regprocedure);
 fixed:=replace(source,$a$'enforced',false$a$,$b$'enforced',private.billing_enforced()$b$);
 if fixed=source then raise exception 'billing access contract changed';end if;execute fixed;
 source:=pg_get_functiondef('private.guard_shop_booking_access()'::regprocedure);
 fixed:=replace(source,$a$ if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' then return new;end if;$a$,
 $b$ if private.billing_enforced() or auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' then return new;end if;$b$);
 if fixed=source then raise exception 'shop booking guard contract changed';end if;execute fixed;
 source:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure);
 fixed:=replace(source,$a$and publication_state = 'published' for share;$a$,$b$and (publication_state = 'published' or p_action='appointment-slots') for share;
    if p_action<>'appointment-slots' and v_branch.id is not null and not private.billing_shop_access(v_branch.id,false) then raise exception 'BILLING_BOOKING_UNAVAILABLE';end if;$b$);
 if fixed=source then raise exception 'customer booking subscription contract changed';end if;execute fixed;
 source:=pg_get_functiondef('private.customer_booking_discovery(text,jsonb)'::regprocedure);
 fixed:=replace(source,$a$and publication_state='published';$a$,$b$and publication_state='published' and private.billing_shop_access(id,false);$b$);
 fixed:=replace(fixed,$a$br.publication_state='published'$a$,$b$br.publication_state='published' and private.billing_shop_access(br.id,false)$b$);
 if fixed=source then raise exception 'discovery subscription contract changed';end if;execute fixed;
 source:=pg_get_functiondef('public.customer_package_catalog(uuid,uuid,date)'::regprocedure);
 fixed:=replace(source,$a$publication_state='published'$a$,$b$publication_state='published' and private.billing_shop_access(id,false)$b$);
 if fixed=source then raise exception 'package subscription contract changed';end if;execute fixed;
 source:=pg_get_functiondef('private.billing_business_view(uuid,uuid,boolean)'::regprocedure);
 fixed:=replace(source,$a$'paidCapacity',s.paid_capacity$a$,$b$'capacity',private.billing_capacity_quote(b.id,private.billing_active_count(b.id)+1),'paidCapacity',s.paid_capacity$b$);
 if fixed=source then raise exception 'business view subscription contract changed';end if;execute fixed;
 source:=pg_get_functiondef('subscription_billing.billing_api(text,jsonb)'::regprocedure);
 fixed:=replace(source,$a$ if p_action='quote'then$a$,$b$ if p_action='capacity-quote'then
  return private.billing_capacity_quote(business,coalesce((p_data->>'count')::integer,private.billing_active_count(business)+1));
 end if;
 if p_action='quote'then$b$);
 if fixed=source then raise exception 'billing API subscription contract changed';end if;execute fixed;
 -- Publication controls must report the effective permission, not only the old
 -- pause flag. Readiness and existing authorization remain unchanged.
 source:=pg_get_functiondef('shop_publishing.manage_shop_publication(uuid,text,text)'::regprocedure);
 fixed:=replace(source,$a$'manual_booking_allowed',shop.status='active' and (shop.publication_state='published' or shop.publication_state='paused' and shop.paused_manual_booking_allowed)$a$,
  $b$'manual_booking_allowed',private.billing_shop_access(shop.id,true),'subscription_enforced',private.billing_enforced()$b$);
 if fixed=source then raise exception 'publication view subscription contract changed';end if;execute fixed;
end $patch$;
commit;
