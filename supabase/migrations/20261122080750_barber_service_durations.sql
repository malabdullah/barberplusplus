begin;
alter table public.barbers add column service_durations jsonb not null default '{}';
create function private.service_duration(p_barber uuid,p_service uuid,p_default integer) returns integer
language sql stable security definer set search_path='' as $$
 select coalesce((b.service_durations->>p_service::text)::integer,p_default) from public.barbers b where b.id=p_barber
$$;
revoke all on function private.service_duration(uuid,uuid,integer) from public,anon,authenticated,service_role;
create function private.guard_service_durations() returns trigger language plpgsql security definer set search_path='' as $$
declare item record; actor text:=private.live_staff_role();
begin
 if tg_op='UPDATE' and new.service_ids is distinct from old.service_ids and actor='barber' then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if tg_op='UPDATE' and new.service_durations=old.service_durations and new.service_ids=old.service_ids then return new;end if;
 if jsonb_typeof(new.service_durations)<>'object' then raise exception 'INVALID_SERVICE_DURATION';end if;
 -- Remove overrides when a manager unassigns a service.
 if tg_op='UPDATE' and new.service_ids is distinct from old.service_ids then
  select coalesce(jsonb_object_agg(key,value),'{}') into new.service_durations from jsonb_each(new.service_durations) where key=any(array(select x::text from unnest(new.service_ids)x));
 end if;
 for item in select * from jsonb_each(new.service_durations) loop
  if not coalesce(item.key=any(array(select x::text from unnest(new.service_ids)x)),false) or jsonb_typeof(item.value)<>'number' or item.value::text !~ '^[0-9]+$' then raise exception 'INVALID_SERVICE_DURATION';end if;
  if (item.value::text)::numeric not between 5 and 480 then raise exception 'INVALID_SERVICE_DURATION';end if;
 end loop;
 if auth.uid() is not null and not coalesce((actor in ('admin','agent') or actor='manager' and exists(select 1 from public.branches where id=new.branch_id and manager_id=auth.uid()) or actor='barber' and new.user_id=auth.uid() and not new.manager_chair),false) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 return new;
end $$;
revoke all on function private.guard_service_durations() from public,anon,authenticated,service_role;
create trigger validate_service_durations before insert or update on public.barbers for each row execute function private.guard_service_durations();
create function public.set_barber_service_duration(p_barber uuid,p_service uuid,p_duration integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.barbers%rowtype;actor text:=private.live_staff_role();
begin
 select * into b from public.barbers where id=p_barber for update;
 if actor is null or b.id is null or not coalesce((actor='manager' and exists(select 1 from public.branches where id=b.branch_id and manager_id=auth.uid()) or actor='barber' and b.user_id=auth.uid() and not b.manager_chair),false) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if p_service is null or not coalesce(p_service=any(b.service_ids),false) or not exists(select 1 from public.services where id=p_service and branch_id=b.branch_id and status='active') then raise exception 'INVALID_SERVICE_ASSIGNMENT';end if;
 if p_duration is not null and p_duration not between 5 and 480 then raise exception 'INVALID_SERVICE_DURATION';end if;
 update public.barbers set service_durations=case when p_duration is null then service_durations-p_service::text else jsonb_set(service_durations,array[p_service::text],to_jsonb(p_duration)) end where id=b.id returning * into b;
 return b.service_durations;
end $$;
revoke all on function public.set_barber_service_duration(uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.set_barber_service_duration(uuid,uuid,integer) to authenticated;
do $patch$ declare d text:=pg_get_functiondef('private.guard_booking_integrity()'::regprocedure);n text;begin
n:=replace(d,$old$s.duration$old$,$new$private.service_duration(new.barber_id,s.id,s.duration)$new$);if n=d then raise exception 'Duration patch mismatch: private.guard_booking_integrity()';end if;d:=n;
execute d;end $patch$;
do $patch$ declare d text:=pg_get_functiondef('private.staff_save_booking(uuid,jsonb)'::regprocedure);n text;begin
n:=replace(d,$old$s.duration$old$,$new$private.service_duration((p_data->>'barber_id')::uuid,s.id,s.duration)$new$);if n=d then raise exception 'Duration patch mismatch: private.staff_save_booking(uuid,jsonb)';end if;d:=n;
execute d;end $patch$;
do $patch$ declare d text:=pg_get_functiondef('private.package_quote(uuid,uuid,uuid,uuid[],date,uuid)'::regprocedure);n text;begin
n:=replace(d,$old$s.duration$old$,$new$private.service_duration(p_barber,s.id,s.duration)$new$);if n=d then raise exception 'Duration patch mismatch: private.package_quote(uuid,uuid,uuid,uuid[],date,uuid)';end if;d:=n;
execute d;end $patch$;
do $patch$ declare d text:=pg_get_functiondef('private.package_catalog(uuid,uuid,date)'::regprocedure);n text;begin
n:=replace(d,$old$sum(duration)$old$,$new$sum(private.service_duration(p_barber,id,duration))$new$);if n=d then raise exception 'Duration patch mismatch: private.package_catalog(uuid,uuid,date)';end if;d:=n;
execute d;end $patch$;
do $patch$ declare d text:=pg_get_functiondef('private.booking_provider_ready(public.barbers,public.branches)'::regprocedure);n text;begin
n:=replace(d,$old$s.duration$old$,$new$private.service_duration(p_barber.id,s.id,s.duration)$new$);if n=d then raise exception 'Duration patch mismatch: private.booking_provider_ready(public.barbers,public.branches)';end if;d:=n;
execute d;end $patch$;
do $patch$ declare d text:=pg_get_functiondef('private.customer_booking_discovery(text,jsonb)'::regprocedure);n text;begin
n:=replace(d,$old$s.duration$old$,$new$private.service_duration(selected.id,s.id,s.duration)$new$);if n=d then raise exception 'Duration patch mismatch: private.customer_booking_discovery(text,jsonb)';end if;d:=n;
n:=replace(d,$old$'service_ids',selected.service_ids,$old$,$new$'service_ids',selected.service_ids,'service_durations',selected.service_durations,$new$);if n=d then raise exception 'Duration patch mismatch: private.customer_booking_discovery(text,jsonb)';end if;d:=n;
execute d;end $patch$;
do $patch$ declare d text:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure);n text;begin
n:=replace(d,$old$sum(duration)$old$,$new$sum(private.service_duration(v_barber.id,id,duration))$new$);if n=d then raise exception 'Duration patch mismatch: public.customer_booking(text,jsonb)';end if;d:=n;
execute d;end $patch$;
do $patch$ declare d text:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure);n text;begin
 n:=replace(d,$old$if v_count <> cardinality(v_services)$old$,$new$if p_action='book' and p_data->>'expected_duration' is not null and (p_data->>'expected_duration')::integer is distinct from v_duration and nullif(p_data->>'package_offer_id','') is null then raise exception 'PRICE_CHANGED';end if;
 if v_count <> cardinality(v_services)$new$);
 if n=d then raise exception 'Duration quote safeguard mismatch';end if;execute n;end $patch$;
do $patch$ declare d text:=pg_get_functiondef('private.shop_publication_readiness(public.branches)'::regprocedure);n text;begin
 n:=replace(d,'make_interval(mins=>s.duration)','make_interval(mins=>private.service_duration(b.id,s.id,s.duration))');if n=d then raise exception 'Readiness duration patch mismatch';end if;execute n;end $patch$;
notify pgrst,'reload schema';
commit;
