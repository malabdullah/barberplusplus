begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(27);

select ok('search_path=pg_catalog, public, pg_temp' = any(p.proconfig), p.proname || ' has a fixed trusted path')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('check_auth_rate_limit','reset_auth_rate_limit',
  'update_whatsapp_conversation_timestamp','create_booking_reminder','cancel_booking_reminder',
  'detect_suspicious_booking_activity','detect_suspicious_login_activity') order by p.proname;
select ok((select 'search_path=pg_catalog, secure, pg_temp' = any(proconfig)
  from pg_proc where oid = 'secure.mask_pii(text,text)'::regprocedure), 'PII helper has fixed builtin/private path');
select ok(not has_schema_privilege('anon','public','CREATE'), 'anonymous callers cannot create trusted objects');
select ok(not has_schema_privilege('authenticated','public','CREATE'), 'browser callers cannot create trusted objects');
select ok(not prosecdef, proname || ' uses caller privilege') from pg_proc
where oid in ('public.check_auth_rate_limit(text,integer,integer,integer)'::regprocedure,
  'public.reset_auth_rate_limit(text)'::regprocedure) order by proname;
select ok(not has_function_privilege('anon',oid,'EXECUTE'), proname || ' denies anonymous RPC') from pg_proc
where oid in ('public.check_auth_rate_limit(text,integer,integer,integer)'::regprocedure,
  'public.reset_auth_rate_limit(text)'::regprocedure) order by proname;
select ok(not has_function_privilege('authenticated',oid,'EXECUTE'), proname || ' denies browser RPC') from pg_proc
where oid in ('public.check_auth_rate_limit(text,integer,integer,integer)'::regprocedure,
  'public.reset_auth_rate_limit(text)'::regprocedure) order by proname;
select ok(has_function_privilege('service_role',oid,'EXECUTE'), proname || ' retains explicit server RPC') from pg_proc
where oid in ('public.check_auth_rate_limit(text,integer,integer,integer)'::regprocedure,
  'public.reset_auth_rate_limit(text)'::regprocedure) order by proname;
set local role anon;
select throws_ok($$select public.reset_auth_rate_limit('synthetic-hardening-probe')$$,'42501');
select throws_ok($$select public.check_auth_rate_limit('synthetic-hardening-probe',5,60,300)$$,'42501');
reset role;
set local role authenticated;
select throws_ok($$select public.reset_auth_rate_limit('synthetic-hardening-probe')$$,'42501');
select throws_ok($$select public.check_auth_rate_limit('synthetic-hardening-probe',5,60,300)$$,'42501');
reset role;
select is(secure.mask_pii('synthetic@barber.test','email'),'sy****@barber.test','PII helper keeps masking semantics');
select is(secure.mask_pii(null,'email'),null::text,'PII helper preserves null');
select is((select count(*) from pg_trigger where not tgisinternal and tgfoid in
  ('public.create_booking_reminder()'::regprocedure,'public.cancel_booking_reminder()'::regprocedure)),0::bigint,'old reminders remain unattached');
select ok((select prosecdef and proowner='barber_reminder_writer'::regrole and 'search_path=""'=any(proconfig)
  from pg_proc where oid='private.maintain_booking_reminder()'::regprocedure),'restricted private writer is unchanged');
select ok(to_regclass('public.auth_rate_limits') is null,'absent optional store is not silently invented');
select * from finish();
rollback;
