begin;
-- Expose only this purpose-specific schema to the invoker wrapper, not the general private schema.
create schema shop_publishing;
revoke all on schema shop_publishing from public,anon,authenticated,service_role;
grant usage on schema shop_publishing to authenticated;
alter function private.manage_shop_publication(uuid,text,text) set schema shop_publishing;
create or replace function public.manage_shop_publication(p_branch uuid,p_action text default 'get',p_expected text default null) returns jsonb
language sql security invoker set search_path='' as $$select shop_publishing.manage_shop_publication(p_branch,p_action,p_expected);$$;
commit;
