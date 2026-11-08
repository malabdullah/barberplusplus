begin;

-- Preserve existing visibility. Only shops created after this migration start as drafts.
alter table public.branches add column publication_state text not null default 'published'
  check(publication_state in ('draft','published','paused'));
alter table public.branches alter column publication_state set default 'draft';
alter table public.branches add column paused_manual_booking_allowed boolean not null default false;

create function private.shop_publication_readiness(p_shop public.branches) returns jsonb
language sql stable security definer set search_path='' as $$
 with ready_services as (
  select s.* from public.services s where s.branch_id=p_shop.id and s.status='active'
    and length(trim(s.name))>0 and s.duration between 5 and 480 and s.price between 0 and 10000
 ), ready_barbers as (
  select b.id from public.barbers b join auth.users u on u.id=b.user_id
  where b.branch_id=p_shop.id and b.status='active' and b.availability_approved_at is not null
    and (b.invite_status is null or b.invite_status='accepted' or b.manager_chair)
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    and (b.manager_chair and u.id=p_shop.manager_id and u.raw_app_meta_data->>'role'='manager' or not b.manager_chair and u.raw_app_meta_data->>'role'='barber')
    and exists(select 1 from ready_services s cross join lateral jsonb_each(b.availability) h(day,hours)
      where s.id=any(b.service_ids) and h.day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
        and h.hours->>'enabled'='true'
        and h.hours->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and h.hours->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and p_shop.working_hours->h.day->>'open' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and p_shop.working_hours->h.day->>'close' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and least(h.hours->>'end',p_shop.working_hours->h.day->>'close')::time
          - greatest(h.hours->>'start',p_shop.working_hours->h.day->>'open')::time >= make_interval(mins=>s.duration))
 )
 select jsonb_build_object('ready',p_shop.status='active' and length(trim(p_shop.name))>0
   and p_shop.governorate_id is not null and p_shop.area_id is not null
   and exists(select 1 from public.areas a where a.id=p_shop.area_id and a.governorate_id=p_shop.governorate_id)
   and private.valid_schedule(p_shop.working_hours,false) and exists(select 1 from ready_barbers),
   'ready_barbers',(select count(*) from ready_barbers));
$$;
revoke all on function private.shop_publication_readiness(public.branches) from public,anon,authenticated,service_role;

create function private.guard_shop_publication() returns trigger
language plpgsql security definer set search_path='' as $$
declare staff_role text:=private.live_staff_role();
begin
 -- Trusted imports keep their explicit state. Clients cannot create an already-published shop.
 if tg_op='INSERT' then
  if auth.uid() is not null then new.publication_state:='draft';new.paused_manual_booking_allowed:=false;end if;
  return new;
 end if;
 if (new.publication_state,new.paused_manual_booking_allowed) is not distinct from
   (old.publication_state,old.paused_manual_booking_allowed) then return new;end if;
 if auth.uid() is null or staff_role is null or not (staff_role='admin' or staff_role='manager' and old.manager_id=auth.uid())
   or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
     and (s.not_after is null or s.not_after>now())) then raise exception 'SHOP_PUBLICATION_FORBIDDEN' using errcode='42501';end if;
 if new.paused_manual_booking_allowed is distinct from old.paused_manual_booking_allowed and staff_role<>'admin' and not (new.publication_state='published' and not new.paused_manual_booking_allowed) then
  raise exception 'SHOP_PERMISSION_ADMIN_ONLY' using errcode='42501';end if;
 if new.publication_state='draft' or new.publication_state='paused' and old.publication_state='draft' then raise exception 'SHOP_STATE_CHANGED';end if;
 if new.publication_state='published' and old.publication_state<>'published'
   and coalesce((private.shop_publication_readiness(new)->>'ready')::boolean,false) is not true then raise exception 'SHOP_NOT_READY';end if;
 if new.paused_manual_booking_allowed and new.publication_state<>'paused' then raise exception 'SHOP_STATE_CHANGED';end if;
 insert into public.logs(user_id,branch_id,action,entity_type,entity_id,message,metadata)
 values(auth.uid(),new.id,'update','branch',new.id,'Shop booking access changed',
  jsonb_build_object('old',jsonb_build_object('publication_state',old.publication_state,'paused_manual_booking_allowed',old.paused_manual_booking_allowed),
    'new',jsonb_build_object('publication_state',new.publication_state,'paused_manual_booking_allowed',new.paused_manual_booking_allowed)));
 return new;
end $$;
revoke all on function private.guard_shop_publication() from public,anon,authenticated,service_role;
create trigger guard_shop_publication before insert or update on public.branches for each row execute function private.guard_shop_publication();

create function private.manage_shop_publication(p_branch uuid,p_action text,p_expected text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare shop public.branches%rowtype; staff_role text:=private.live_staff_role();
begin
 if auth.uid() is null or staff_role is null or not exists(select 1 from auth.sessions s where s.user_id=auth.uid()
   and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now())) then raise exception 'SHOP_PUBLICATION_FORBIDDEN' using errcode='42501';end if;
 select * into shop from public.branches where id=p_branch for update;
 if shop.id is null or not (staff_role='admin' or staff_role='manager' and shop.manager_id=auth.uid()) then raise exception 'SHOP_PUBLICATION_FORBIDDEN' using errcode='42501';end if;
 if p_action is null or p_action not in ('get','publish','pause','allow-manual','block-manual') then raise exception 'INVALID_REQUEST';end if;
 if p_action<>'get' then
  if p_expected is distinct from shop.publication_state then raise exception 'SHOP_STATE_CHANGED';end if;
  if p_action in ('allow-manual','block-manual') and staff_role<>'admin' then raise exception 'SHOP_PERMISSION_ADMIN_ONLY' using errcode='42501';end if;
  if p_action in ('allow-manual','block-manual') and shop.publication_state<>'paused' then raise exception 'SHOP_STATE_CHANGED';end if;
  if p_action='pause' and shop.publication_state<>'published' then raise exception 'SHOP_STATE_CHANGED';end if;
  update public.branches set publication_state=case p_action when 'publish' then 'published' when 'pause' then 'paused' else publication_state end,
    paused_manual_booking_allowed=case when p_action='allow-manual' then true when p_action='block-manual' or p_action='publish' then false else paused_manual_booking_allowed end
    where id=shop.id returning * into shop;
 end if;
 return private.shop_publication_readiness(shop)||jsonb_build_object('publication_state',shop.publication_state,
  'manual_booking_allowed',shop.status='active' and (shop.publication_state='published' or shop.publication_state='paused' and shop.paused_manual_booking_allowed),
  'paused_manual_booking_allowed',shop.paused_manual_booking_allowed);
end $$;
revoke all on function private.manage_shop_publication(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.manage_shop_publication(uuid,text,text) to authenticated;
create function public.manage_shop_publication(p_branch uuid,p_action text default 'get',p_expected text default null) returns jsonb
language sql security invoker set search_path='' as $$select private.manage_shop_publication(p_branch,p_action,p_expected);$$;
revoke all on function public.manage_shop_publication(uuid,text,text) from public,anon,service_role;
grant execute on function public.manage_shop_publication(uuid,text,text) to authenticated;

create function private.guard_shop_booking_access() returns trigger
language plpgsql security definer set search_path='' as $$
declare shop public.branches%rowtype;
begin
 -- Existing appointments remain manageable. Reinstating a cancelled booking is a new reservation.
 if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' then return new;end if;
 if tg_op='UPDATE' and not (old.status in ('cancelled','no_show') and new.status in ('pending','confirmed')) then return new;end if;
 select * into shop from public.branches where id=new.branch_id for share;
 if shop.status is distinct from 'active' or not (shop.publication_state='published'
   or shop.publication_state='paused' and shop.paused_manual_booking_allowed) then raise exception 'SHOP_BOOKINGS_PAUSED';end if;
 return new;
end $$;
revoke all on function private.guard_shop_booking_access() from public,anon,authenticated,service_role;
create trigger a_shop_booking_access before insert or update on public.bookings for each row execute function private.guard_shop_booking_access();

-- All customer callers, including stale catalogs and native clients, share this check.
-- Existing branch SHARE locks serialize booking with pause/unpublish transitions.
do $$declare definition text; original text:='where id = v_barber.branch_id and status = ''active'' for share;';begin
 select pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure) into definition;
 if position(original in definition)=0 then raise exception 'Customer booking selection changed; review publishing migration';end if;
 execute replace(definition,original,'where id = v_barber.branch_id and status = ''active'' and publication_state = ''published'' for share;');
end $$;
commit;
