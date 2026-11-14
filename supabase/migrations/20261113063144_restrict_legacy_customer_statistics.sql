-- Booking writes already maintain these aggregates through their existing trigger.
revoke all on function public.increment_customer_booking_count(uuid,date) from public,anon,authenticated;
grant execute on function public.increment_customer_booking_count(uuid,date) to service_role;
