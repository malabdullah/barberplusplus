begin;
-- Future rows only. Never reset existing choices or notification consent.
alter table private.customer_push_devices alter column preferences
 set default '{"updates":true,"reminder24":true,"reminder2":true,"reviews":true}'::jsonb;
alter table private.customer_push_preferences alter column preferences
 set default '{"updates":true,"reminder24":true,"reminder2":true,"reviews":true}'::jsonb;
commit;
