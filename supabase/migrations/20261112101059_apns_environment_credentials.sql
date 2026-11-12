begin;

-- Import one explicitly scoped credential without rewriting the legacy sandbox
-- key, dispatcher secret, enabled flag, runtime allowlist or customer records.
create or replace function private.configure_customer_push_credential(p_environment text,p_config jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare runtime private.customer_push_runtime; secret_name text; existing_id uuid; value jsonb; other_key text;
begin
 select * into runtime from private.customer_push_runtime where singleton;
 if not found or p_environment is null or p_environment not in('sandbox','production')
   or(p_environment='production'and runtime.api_url<>'https://srv1073968.hstgr.cloud')then raise exception 'PUSH_ENVIRONMENT_NOT_ALLOWED';end if;
 if jsonb_typeof(p_config)is distinct from'object'
   or p_config-array['privateKey','keyId','teamId']<>'{}'::jsonb
   or not(p_config ?& array['privateKey','keyId','teamId'])
   or jsonb_typeof(p_config->'privateKey')is distinct from'string'
   or length(p_config->>'privateKey')>16384
   or p_config->>'privateKey'!~'^-----BEGIN PRIVATE KEY-----[[:space:]]+[A-Za-z0-9+/=[:space:]]+[[:space:]]+-----END PRIVATE KEY-----[[:space:]]*$' -- gitleaks:allow (PEM validation regex, no key material)
   or jsonb_typeof(p_config->'keyId')is distinct from'string'
   or jsonb_typeof(p_config->'teamId')is distinct from'string'
   or coalesce(p_config->>'keyId','')!~'^[A-Z0-9]{10}$'
   or coalesce(p_config->>'teamId','')!~'^[A-Z0-9]{10}$'then raise exception 'INVALID_REQUEST';end if;
 select decrypted_secret::jsonb->>'keyId'into other_key from vault.decrypted_secrets
   where name='customer_push_apns_'||case when p_environment='production'then'sandbox'else'production'end;
 if other_key=p_config->>'keyId'or(p_environment='production'and exists(select 1 from vault.decrypted_secrets where name='customer_push_apns'and decrypted_secret::jsonb->>'keyId'=p_config->>'keyId'))then raise exception 'PUSH_CREDENTIAL_ENVIRONMENT_MISMATCH';end if;
 if exists(select 1 from vault.decrypted_secrets where name='customer_push_apns'and decrypted_secret::jsonb->>'teamId'is distinct from p_config->>'teamId')then raise exception 'PUSH_CREDENTIAL_TEAM_MISMATCH';end if;
 value:=p_config||jsonb_build_object('environment',p_environment,'topic',runtime.topic,'apiUrl',runtime.api_url);
 secret_name:='customer_push_apns_'||p_environment;
 select id into existing_id from vault.secrets where name=secret_name;
 if found then perform vault.update_secret(existing_id,value::text);
 else perform vault.create_secret(value::text,secret_name,'Barber++ environment-scoped APNs credential');end if;
 return true;
end $$;
revoke all on function private.configure_customer_push_credential(text,jsonb)from public,anon,authenticated;
grant execute on function private.configure_customer_push_credential(text,jsonb)to service_role;

create or replace function public.configure_customer_push_credential(p_environment text,p_config jsonb)returns boolean
language sql set search_path='' as $$select private.configure_customer_push_credential(p_environment,p_config);$$;
revoke all on function public.configure_customer_push_credential(text,jsonb)from public,anon,authenticated;
grant execute on function public.configure_customer_push_credential(text,jsonb)to service_role;

create or replace function private.customer_push_configuration()returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce((select decrypted_secret::jsonb from vault.decrypted_secrets where name='customer_push_apns'),'{}'::jsonb)
   ||coalesce((select jsonb_build_object('apiUrl',api_url,'topic',topic,'environments',environments)from private.customer_push_runtime where singleton),'{}'::jsonb)
   ||jsonb_build_object('dispatchSecret',(select decrypted_secret from vault.decrypted_secrets where name='customer_push_dispatch_secret'),
     'credentials',jsonb_strip_nulls(jsonb_build_object(
       'sandbox',(select decrypted_secret::jsonb from vault.decrypted_secrets where name='customer_push_apns_sandbox'),
       'production',(select decrypted_secret::jsonb from vault.decrypted_secrets where name='customer_push_apns_production'))));
$$;
revoke all on function private.customer_push_configuration()from public,anon,authenticated;
grant execute on function private.customer_push_configuration()to service_role;

commit;
