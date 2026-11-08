begin;
-- customer_booking is an invoker RPC restricted to the trusted service gateway.
-- Its internal quote helper is executable only by that gateway and definers.
grant execute on function private.package_quote(uuid,uuid,uuid,uuid[],date,uuid) to service_role;
commit;
