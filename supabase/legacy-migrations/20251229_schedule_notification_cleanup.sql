-- Notification Cleanup Job
-- Deletes notifications older than 30 days
-- Runs daily at 3 AM UTC

-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage on cron schema to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Create a function to handle batched deletion
-- This prevents long-running transactions and reduces database strain
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications(
  retention_days INTEGER DEFAULT 30,
  batch_size INTEGER DEFAULT 1000
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_deleted INTEGER := 0;
  batch_deleted INTEGER;
  cutoff_date TIMESTAMPTZ;
BEGIN
  cutoff_date := NOW() - (retention_days || ' days')::INTERVAL;

  -- Delete in batches until no more old records exist
  LOOP
    WITH deleted AS (
      DELETE FROM public.notifications
      WHERE id IN (
        SELECT id FROM public.notifications
        WHERE created_at < cutoff_date
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    )
    SELECT COUNT(*) INTO batch_deleted FROM deleted;

    total_deleted := total_deleted + batch_deleted;

    -- Exit when no more records to delete
    EXIT WHEN batch_deleted = 0;

    -- Small pause between batches to reduce load
    PERFORM pg_sleep(0.1);
  END LOOP;

  -- Log the cleanup result
  RAISE NOTICE 'Notification cleanup completed: % notifications deleted (older than %)',
    total_deleted, cutoff_date;

  RETURN total_deleted;
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION public.cleanup_old_notifications IS
  'Deletes notifications older than specified days in batches. Default: 30 days retention, 1000 batch size.';

-- Schedule daily notification cleanup job at 3 AM UTC
SELECT cron.schedule(
  'cleanup-old-notifications',
  '0 3 * * *',  -- Every day at 3:00 AM UTC
  $$SELECT public.cleanup_old_notifications();$$
);

-- Add comment on the cron extension
COMMENT ON EXTENSION pg_cron IS 'Job scheduler for PostgreSQL - used for notification cleanup';
