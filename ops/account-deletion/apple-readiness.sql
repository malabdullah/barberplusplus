-- Read-only post-migration metadata/aggregate check. No account identifiers,
-- ciphertext, tokens, signing secrets or Vault values are returned.
-- The operator must compare the deployment identity with the reviewed target.
begin read only;
select jsonb_build_object(
 'deployment',(select jsonb_build_object('environment',deployment_environment,'testMode',test_mode)from private.customer_deletion_runtime where singleton),
 'publicWrapperServiceOnly',not has_function_privilege('anon','public.customer_deletion_service(text,jsonb)','execute')and not has_function_privilege('authenticated','public.customer_deletion_service(text,jsonb)','execute')and has_function_privilege('service_role','public.customer_deletion_service(text,jsonb)','execute'),
 'baseBypassClosed',not has_function_privilege('service_role','private.customer_deletion_base_v1(text,jsonb)','execute'),
 'privateTables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'noDirectApiSelect',not has_table_privilege('anon',c.oid,'select')and not has_table_privilege('authenticated',c.oid,'select')and not has_table_privilege('service_role',c.oid,'select'))order by c.relname)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'and c.relname in('customer_apple_credentials','customer_apple_attempts','customer_apple_tasks')),
 'savedCredentialCount',(select count(*)from private.customer_apple_credentials),
 'savedCredentialKeyVersions',(select coalesce(jsonb_agg(distinct key_id),'[]')from private.customer_apple_credentials),
 'pendingProviderTaskCount',(select count(*)from private.customer_apple_tasks),
 'pendingProviderKeyVersions',(select coalesce(jsonb_agg(distinct key_id),'[]')from private.customer_apple_tasks),
 'pendingCleanupJobCount',(select count(*)from private.customer_deletion_jobs where state='cleanup_pending'),
 'oldestPendingJobAgeSeconds',(select case when count(*)=0 then null else greatest(0,extract(epoch from(clock_timestamp()-min(created_at))))end from private.customer_deletion_jobs where state='cleanup_pending')
)as apple_deletion_readiness;
rollback;
