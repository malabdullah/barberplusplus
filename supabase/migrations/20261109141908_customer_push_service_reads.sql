begin;
-- The server-only, SECURITY INVOKER push RPC checks booking ownership and
-- ratings. Registration needs neither table, so missing reads only surface
-- when subscribing a guest or evaluating notification eligibility.
-- Keep both tables closed to browser roles and preserve existing RLS/policies.
grant select on private.customer_booking_owners, private.customer_booking_ratings to service_role;
commit;
