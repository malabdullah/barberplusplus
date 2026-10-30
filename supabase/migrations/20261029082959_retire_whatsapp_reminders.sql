-- Retire WhatsApp delivery while preserving all existing customer and reminder rows.
-- This migration requires the separately reviewed production release path.
do $$
declare reminder_job record;
begin
  for reminder_job in select jobid from cron.job where jobname = 'send-booking-reminders' loop
    perform cron.unschedule(reminder_job.jobid);
  end loop;
end $$;

drop trigger if exists create_reminder_on_booking on public.bookings;
drop trigger if exists cancel_reminder_on_booking_cancel on public.bookings;
