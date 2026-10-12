-- Fixed trusted schemas, with pg_temp explicitly last: caller-controlled paths
-- cannot shadow application tables or builtins. API roles cannot CREATE public.
alter function secure.mask_pii(text, text)
  set search_path = pg_catalog, secure, pg_temp;
alter function public.update_whatsapp_conversation_timestamp()
  set search_path = pg_catalog, public, pg_temp;
alter function public.create_booking_reminder()
  set search_path = pg_catalog, public, pg_temp;
alter function public.cancel_booking_reminder()
  set search_path = pg_catalog, public, pg_temp;
alter function public.detect_suspicious_booking_activity()
  set search_path = pg_catalog, public, pg_temp;
alter function public.detect_suspicious_login_activity()
  set search_path = pg_catalog, public, pg_temp;
alter function public.check_auth_rate_limit(text, integer, integer, integer)
  set search_path = pg_catalog, public, pg_temp;
alter function public.reset_auth_rate_limit(text)
  set search_path = pg_catalog, public, pg_temp;

-- Only the server worker uses these APIs. Neither needs owner privilege: the
-- service role already has its own authority. No browser may reset another
-- caller's identifier or customize server rate-limit settings.
alter function public.check_auth_rate_limit(text, integer, integer, integer)
  security invoker;
alter function public.reset_auth_rate_limit(text) security invoker;
revoke all on function public.check_auth_rate_limit(text, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.reset_auth_rate_limit(text)
  from public, anon, authenticated;
grant execute on function public.check_auth_rate_limit(text, integer, integer, integer)
  to service_role;
grant execute on function public.reset_auth_rate_limit(text) to service_role;

-- auth_rate_limits is absent from the authoritative baseline. Do not invent a
-- table, restore production data, or claim this optional feature is operational.
-- The worker fails closed on unavailable storage; normal Supabase Auth is separate.
