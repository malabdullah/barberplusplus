begin;
do $patch$
declare definition text:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure);updated text;
begin
 updated:=replace(definition,$old$v_price:=(v_package->>'price')::numeric;$old$,$new$v_price:=(v_package->>'price')::numeric;
      if p_action='book' and ((p_data->'package_quote'->>'price')::numeric is distinct from v_price or (p_data->'package_quote'->>'duration')::integer is distinct from v_duration) then raise exception 'PACKAGE_CHANGED';end if;$new$);
 if updated=definition then raise exception 'Package quote contract changed';end if;definition:=updated;
 updated:=replace(definition,$old$'today', v_today, 'last_date'$old$,$new$'package',v_package->'package','package_quote',case when v_package is null then null else jsonb_build_object('price',v_price,'duration',v_duration) end,'today', v_today, 'last_date'$new$);
 if updated=definition then raise exception 'Package slots contract changed';end if;execute updated;
end $patch$;
create function public.staff_package_terms(p_booking uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.bookings%rowtype;actor text:=private.live_staff_role();o private.package_offers%rowtype;
begin
 select * into b from public.bookings where id=p_booking;
 if actor is null or b.id is null or not(actor in('admin','agent') or actor='manager' and exists(select 1 from public.branches where id=b.branch_id and manager_id=auth.uid())
 or actor='barber' and exists(select 1 from public.barbers where id=b.barber_id and user_id=auth.uid() and not manager_chair)) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if b.package_offer_id is null then return null;end if;
 select * into o from private.package_offers where id=b.package_offer_id;
 return b.package_snapshot||jsonb_build_object('id',b.package_offer_id,'starts_on',o.starts_on,'ends_on',o.ends_on,
  'duration',(select sum((x->>'duration')::integer) from jsonb_array_elements(b.service_snapshot)x where (x->>'id')::uuid=any(array(select jsonb_array_elements_text(b.package_snapshot->'service_ids')::uuid))),
  'regular_price',(select sum((x->>'price')::numeric) from jsonb_array_elements(b.service_snapshot)x where (x->>'id')::uuid=any(array(select jsonb_array_elements_text(b.package_snapshot->'service_ids')::uuid))));
end $$;
revoke all on function public.staff_package_terms(uuid) from public,anon,service_role;
grant execute on function public.staff_package_terms(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
