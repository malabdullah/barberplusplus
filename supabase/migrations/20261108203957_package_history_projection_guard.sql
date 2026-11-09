begin;
-- The account dispatcher runs as the validated gateway role, not as postgres.
-- Expose only the purchased terms; keep all package tables inaccessible directly.
create function private.package_history_terms(p_booking uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select b.package_snapshot||jsonb_build_object('starts_on',o.starts_on,'ends_on',o.ends_on)
 from public.bookings b join private.package_offers o on o.id=b.package_offer_id where b.id=p_booking;
$$;
revoke all on function private.package_history_terms(uuid) from public,anon,authenticated;
grant execute on function private.package_history_terms(uuid) to service_role;
do $patch$
declare definition text:=pg_get_functiondef('public.customer_account_api(text,jsonb)'::regprocedure);updated text;
begin
 updated:=replace(definition,$old$case when b.package_offer_id is null then null else b.package_snapshot||coalesce((select jsonb_build_object('starts_on',starts_on,'ends_on',ends_on) from private.package_offers where id=b.package_offer_id),'{}') end$old$,$new$case when b.package_offer_id is null then null else private.package_history_terms(b.id) end$new$);
 if updated=definition then raise exception 'Package history projection contract changed';end if;
 execute updated;
end $patch$;
notify pgrst,'reload schema';
commit;
