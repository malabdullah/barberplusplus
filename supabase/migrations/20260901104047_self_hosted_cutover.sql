-- Point the hourly reminder job at self-hosted Supabase.
-- Before applying this migration, store the browser-safe publishable or
-- legacy anon key once:
--   select vault.create_secret(
--     '<browser-safe-key>',
--     'self_hosted_browser_key',
--     'Browser-safe key used by the booking reminder cron job'
--   );

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'send-booking-reminders'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'send-booking-reminders',
  '0 * * * *',
  $schedule$
  select net.http_post(
    url := 'https://supabase.malabdullah.cloud/functions/v1/send-booking-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'self_hosted_browser_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) as request_id;
  $schedule$
);
