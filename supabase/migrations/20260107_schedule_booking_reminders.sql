-- Schedule booking reminders to run every hour
-- This cron job calls the send-booking-reminders Edge Function
-- NOTE: This migration was already applied manually via SQL

-- Enable pg_net extension for HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule the job to run every hour at minute 0
-- The Edge Function will find and send pending reminders
SELECT cron.schedule(
    'send-booking-reminders',
    '0 * * * *',  -- Every hour at minute 0
    $$
    SELECT extensions.http_post(
        'https://pqaidfykknoiqmosfvnb.supabase.co/functions/v1/send-booking-reminders',
        '{}',
        'application/json'
    );
    $$
);
