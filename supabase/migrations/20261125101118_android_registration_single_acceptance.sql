begin;
create table private.android_registration_acceptance(
 singleton boolean primary key default true check(singleton),
 account_id uuid references auth.users(id)on delete cascade,
 session_id uuid references auth.sessions(id)on delete cascade,
 device_id uuid, secret_hash bytea, expires_at timestamptz not null default '-infinity'
);
insert into private.android_registration_acceptance(singleton)values(true);
alter table private.android_registration_acceptance enable row level security;
revoke all on private.android_registration_acceptance from public,anon,authenticated,service_role;

create function private.android_registration_acceptance_configure(p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.android_live_push_runtime;u uuid:=(p_data->>'userId')::uuid;d uuid:=(p_data->>'deviceId')::uuid;
begin
 if auth.role()is distinct from'service_role'then raise exception'FORBIDDEN';end if;
 if p_data->>'deviceId'is null then
  update private.android_registration_acceptance set account_id=null,session_id=null,device_id=null,secret_hash=null,expires_at='-infinity'where singleton;
  return '{"configured":true}';
 end if;
 select * into r from private.android_live_push_runtime where singleton;
 if not found or r.registration_enabled or r.delivery_enabled or r.environment<>'production'or r.api_url<>'https://srv1073968.hstgr.cloud'
  or r.project_id<>'barber-plus-plus-phone-prod'or r.package_name<>'com.barberplusplus.customer'or not private.android_live_push_bound(r)
  or u is null or d is null
  or not exists(select 1 from auth.users person join private.customer_accounts account on account.user_id=person.id join public.customers customer on customer.id=account.customer_id
   where person.id=u and person.raw_app_meta_data->>'role'in('customer','manager','barber')and person.email_confirmed_at is not null
   and person.deleted_at is null and(person.banned_until is null or person.banned_until<=now())and customer.status='active'and customer.account_deleted_at is null)
  or coalesce(p_data->>'secretHash','')!~'^[0-9a-f]{64}$'
  or exists(select 1 from private.android_live_push_devices where id=d)then raise exception'ACCEPTANCE_SCOPE_INVALID';end if;
 update private.android_registration_acceptance set account_id=u,session_id=null,device_id=d,secret_hash=decode(p_data->>'secretHash','hex'),expires_at=clock_timestamp()+interval'10 minutes'where singleton;
 return '{"configured":true}';
end $$;

create function private.android_registration_acceptance_allowed(p_data jsonb,r private.android_live_push_runtime)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.android_registration_acceptance scope
 where scope.singleton and scope.expires_at>clock_timestamp()and not r.registration_enabled and not r.delivery_enabled
 and r.environment='production'and r.api_url='https://srv1073968.hstgr.cloud'and private.android_live_push_bound(r)
 and r.project_id='barber-plus-plus-phone-prod'and r.package_name='com.barberplusplus.customer'
 and p_data->>'projectId'=r.project_id and p_data->>'packageName'=r.package_name
 and scope.account_id=(p_data->>'user_id')::uuid
 and scope.device_id=(p_data->>'deviceId')::uuid
 and scope.secret_hash=extensions.digest(p_data->>'deviceSecret','sha256')
 and not exists(select 1 from private.android_live_push_devices existing where existing.token_hash=extensions.digest(p_data->>'token','sha256'))
 and private.android_live_push_owner(scope.account_id,(p_data->>'session_id')::uuid));
$$;

-- Modify exactly the closed-registration guard, retaining every normal validator.
do $$declare source text:=pg_get_functiondef('private.android_live_push_api(text,jsonb)'::regprocedure);old_guard text:='if not r.registration_enabled then raise exception''PUSH_NOT_CONFIGURED'';end if;';begin
 if position(old_guard in source)=0 then raise exception'ANDROID_REGISTRATION_CONTRACT_CHANGED';end if;
 source:=replace(source,old_guard,'if not r.registration_enabled and not private.android_registration_acceptance_allowed(p_data,r)then raise exception''PUSH_NOT_CONFIGURED'';end if;');
 -- PostgreSQL repetition bounds cannot exceed 255. Check the size separately.
 if position($old$coalesce(p_data->>'token','')!~'^[A-Za-z0-9_:-]{20,4096}$'$old$ in source)=0 then raise exception'ANDROID_TOKEN_CONTRACT_CHANGED';end if;
 source:=replace(source,$old$coalesce(p_data->>'token','')!~'^[A-Za-z0-9_:-]{20,4096}$'$old$,
  $new$(length(coalesce(p_data->>'token',''))not between 20 and 4096 or coalesce(p_data->>'token','')!~'^[A-Za-z0-9_:-]+$')$new$);
 execute replace(source,'FUNCTION private.android_live_push_api(','FUNCTION private.android_live_push_registration_api(');
end $$;
create or replace function private.android_live_push_api(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 result:=private.android_live_push_registration_api(p_action,p_data);
 if p_action='push-register'and result->>'success'='true'then
  update private.android_registration_acceptance set account_id=null,session_id=null,device_id=null,secret_hash=null,expires_at='-infinity'
   where singleton and device_id=(p_data->>'deviceId')::uuid and account_id=(p_data->>'user_id')::uuid;
 end if;
 return result;
end $$;
create or replace function private.admin_push_worker(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if p_action='registration-configure'then return private.android_registration_acceptance_configure(p_data);end if;
 if p_action like'acceptance-%'then return private.android_announcement_acceptance_worker(substring(p_action from 12),p_data);end if;
 return private.admin_push_general_worker(p_action,p_data);
end $$;

-- Fresh one-installation enrollment is allowed while general registration stays closed.
do $$declare source text:=pg_get_functiondef('private.android_announcement_acceptance_allowed(uuid)'::regprocedure);begin
 execute replace(source,'and not r.delivery_enabled and not ar.enabled and r.registration_enabled','and not r.delivery_enabled and not ar.enabled');
end $$;
revoke all on function private.android_registration_acceptance_configure(jsonb),private.android_registration_acceptance_allowed(jsonb,private.android_live_push_runtime),private.android_live_push_registration_api(text,jsonb),private.android_live_push_api(text,jsonb),private.admin_push_worker(text,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.admin_push_worker(text,jsonb),private.android_live_push_api(text,jsonb)to service_role;
commit;
