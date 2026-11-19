begin;
-- A dedicated, unexposed dispatcher schema lets the public wrapper stay an
-- invoker without opening the application's existing private schema to clients.
create schema subscription_billing;
revoke all on schema subscription_billing from public,anon,service_role;
grant usage on schema subscription_billing to authenticated;
alter function private.billing_api(text,jsonb) set schema subscription_billing;
create or replace function public.subscription_billing(p_action text,p_data jsonb default '{}')returns jsonb
language sql set search_path='' as $$select subscription_billing.billing_api(p_action,p_data);$$;
notify pgrst,'reload schema';
commit;
