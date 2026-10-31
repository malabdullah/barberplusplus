-- Cloud Test hardening for inherited legacy functions. Trigger execution is
-- unaffected; those functions need no direct REST RPC entry point.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature, p.prorettype, p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', f.signature);
    if f.prorettype = 'trigger'::regtype
      or f.proname in ('cleanup_old_notifications', 'increment_customer_booking_count') then
      execute format('revoke execute on function %s from authenticated', f.signature);
    end if;
  end loop;
end;
$$;
