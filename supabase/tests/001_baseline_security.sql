begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(15);

select has_schema('public', 'public schema exists');
select has_schema('private', 'private authorization schema exists');
select has_table('public', 'bookings', 'bookings table exists');

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  ),
  20::bigint,
  'all 20 production application tables are present'
);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ),
  'RLS is enabled on every public application table'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public'),
  119::bigint,
  'all baseline and trusted-role RLS policies are present'
);

select is(
  (
    select pg_get_function_result(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'count_users_by_role'
      and pg_get_function_identity_arguments(p.oid) = 'role_filter text'
  ),
  'bigint',
  'count_users_by_role returns bigint after the authorization migration'
);

select ok(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'count_users_by_role'
      and pg_get_function_identity_arguments(p.oid) = 'role_filter text'
  ),
  'count_users_by_role is security definer'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'assign_default_manager_role'
      and p.prosecdef
      and 'search_path=""' = any (p.proconfig)
  ),
  'default-role trigger function is private, hardened, and security definer'
);

select ok(
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgname = 'assign_default_manager_role'
      and not t.tgisinternal
  ),
  'trusted default-role trigger is installed on auth.users'
);

select is(
  (
    select count(*)
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in (
        'bookings',
        'notifications',
        'whatsapp_conversations',
        'whatsapp_messages'
      )
  ),
  4::bigint,
  'Realtime contains the four approved application tables'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'Barbers view own notifications',
        'Managers view branch notifications',
        'Barbers view own logs',
        'Managers view branch logs',
        'Admins view all logs',
        'Admins view all audit logs',
        'Admins insert audit logs'
      )
  ),
  7::bigint,
  'all seven trusted-role policies are installed'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'Barbers view own notifications',
        'Managers view branch notifications',
        'Barbers view own logs',
        'Managers view branch logs',
        'Admins view all logs',
        'Admins view all audit logs',
        'Admins insert audit logs'
      )
      and (
        coalesce(qual, '') ilike '%user_metadata%'
        or coalesce(with_check, '') ilike '%user_metadata%'
      )
  ),
  'trusted-role policies never authorize from editable user_metadata'
);

select is(
  (
    select command
    from cron.job
    where jobname = 'send-booking-reminders'
  ),
  'select private.invoke_booking_reminders();',
  'booking reminder cron invokes only the hardened private function'
);

select is(
  (select count(*) from vault.secrets),
  0::bigint,
  'the clean replay contains no production Vault values'
);

select * from finish();
rollback;
