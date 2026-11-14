begin;
create function private.cleanup_staff_reports()returns void
language sql security definer set search_path=''as $$
 delete from private.staff_report_runs where id in(
  select id from private.staff_report_runs where expires_at<=clock_timestamp()order by expires_at limit 100
 )
$$;
revoke all on function private.cleanup_staff_reports()from public,anon,authenticated,service_role;
select cron.schedule('staff-report-expiry','17 * * * *','select private.cleanup_staff_reports()');
commit;
