-- Only the trusted booking gateway needs direct helper access.
-- Anonymous and authenticated clients still cannot execute the private helper.
grant execute on function private.service_duration(uuid,uuid,integer) to service_role;
