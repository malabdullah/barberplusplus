begin;
-- Newly materialized jobs are eligible in the same transaction. Comparing a
-- clock_timestamp default with the earlier transaction now() delayed first claim.
alter table private.android_live_push_deliveries alter column available_at set default now();
commit;
