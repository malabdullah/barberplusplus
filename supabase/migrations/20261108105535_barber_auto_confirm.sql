begin;
alter table public.barbers add column auto_confirm_bookings boolean not null default true;

create function private.guard_barber_confirmation_preference() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor text:=private.live_staff_role();
begin
 if tg_op='UPDATE' and new.auto_confirm_bookings is not distinct from old.auto_confirm_bookings then return new;end if;
 if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then return new;end if;
 if actor is null or new.user_id is distinct from auth.uid() or (tg_op='UPDATE' and (old.user_id is distinct from auth.uid() or new.branch_id is distinct from old.branch_id))
  or not (actor='barber' and not new.manager_chair or actor='manager' and new.manager_chair and exists(select 1 from public.branches where id=new.branch_id and manager_id=auth.uid())) then
  raise exception 'NOT_AUTHORIZED' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.guard_barber_confirmation_preference() from public,anon,authenticated,service_role;
create trigger a_barber_confirmation_preference before update of auto_confirm_bookings on public.barbers
for each row execute function private.guard_barber_confirmation_preference();

create function public.set_barber_auto_confirm(p_barber_id uuid,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.barbers%rowtype; actor text:=private.live_staff_role();
begin
 if p_enabled is null then raise exception 'INVALID_REQUEST';end if;
 select * into b from public.barbers where id=p_barber_id for update;
 if actor is null or b.user_id is distinct from auth.uid() or not (
  actor='barber' and not b.manager_chair or actor='manager' and b.manager_chair and exists(select 1 from public.branches where id=b.branch_id and manager_id=auth.uid())
 ) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 update public.barbers set auto_confirm_bookings=p_enabled where id=b.id;
 return jsonb_build_object('auto_confirm_bookings',p_enabled);
end $$;
revoke all on function public.set_barber_auto_confirm(uuid,boolean) from public,anon,service_role;
grant execute on function public.set_barber_auto_confirm(uuid,boolean) to authenticated;

create function public.confirm_pending_booking(p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; actor text:=private.live_staff_role(); contact jsonb;
begin
 if actor is null then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if b.id is null or not (actor='admin' or actor='manager' and exists(select 1 from public.branches where id=b.branch_id and manager_id=auth.uid())
  or actor='barber' and exists(select 1 from public.barbers where id=b.barber_id and user_id=auth.uid() and not manager_chair)) then
  raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if b.status<>'pending' then raise exception 'BOOKING_NOT_PENDING';end if;
 if b.date+b.time <= (clock_timestamp() at time zone 'Asia/Kuwait') then raise exception 'BOOKING_ALREADY_STARTED';end if;
 update public.bookings set status='confirmed',modified_by_type=actor,modified_by_user_id=auth.uid() where id=b.id returning * into b;
 select jsonb_build_object('id',id,'name',name,'country_code',country_code,'phone',phone) into contact from public.customers where id=b.customer_id;
 return to_jsonb(b)||jsonb_build_object('customer',contact);
end $$;
revoke all on function public.confirm_pending_booking(uuid) from public,anon,service_role;
grant execute on function public.confirm_pending_booking(uuid) to authenticated;

-- Patch only the creation decision and expose it in slots. Existing retry,
-- verification, ownership, conflict and cancellation-policy logic is retained.
do $patch$
declare definition text:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure); updated text;
begin
 updated:=replace(definition,
  $old$v_duration, v_price, 'confirmed', nullif(trim(p_data ->> 'notes'), ''), 'customer')$old$,
  $new$v_duration, v_price, case when v_barber.auto_confirm_bookings then 'confirmed' else 'pending' end, nullif(trim(p_data ->> 'notes'), ''), 'customer')$new$);
 if updated=definition then raise exception 'Customer booking creation contract changed';end if;
 definition:=updated;
 updated:=replace(definition,$old$'booking_policy',public.shop_booking_policy(v_branch.id)$old$,$new$'confirmation_required',not v_barber.auto_confirm_bookings,'booking_policy',public.shop_booking_policy(v_branch.id)$new$);
 if updated=definition then raise exception 'Customer booking slots contract changed';end if;
 execute updated;
end $patch$;
commit;
