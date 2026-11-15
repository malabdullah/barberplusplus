-- Use a literal dot without nested string escaping.
create or replace function public.manage_administrators(p_action text,p_data jsonb default '{}')returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();target auth.users%rowtype;rows jsonb;page_number integer;affected uuid;email_value text;
begin
 perform public.enforce_account_session();
 if not public.is_super_admin()then raise exception 'SUPER_ADMIN_REQUIRED'using errcode='42501';end if;
 if p_action='list'then
  page_number:=coalesce((p_data->>'page')::integer,1);if page_number<1 or page_number>10000 then raise exception 'INVALID_REQUEST';end if;
  select coalesce(jsonb_agg(x),'[]')into rows from(select id,email,coalesce(raw_user_meta_data->>'name','')as name,
   case when raw_app_meta_data->>'role'='admin'then 'super_admin'else 'admin'end as role,
   coalesce(banned_until<=now(),true)as enabled,email_confirmed_at is not null as verified
   from auth.users where deleted_at is null and raw_app_meta_data->>'role'in('admin','agent')order by created_at,id limit 25 offset(page_number-1)*25)x;
  return jsonb_build_object('users',rows,'hasMore',exists(select 1 from auth.users where deleted_at is null and raw_app_meta_data->>'role'in('admin','agent')order by created_at,id offset page_number*25 limit 1));
 end if;
 if p_action='add'then
  email_value:=lower(trim(p_data->>'email'));
  if email_value is null or length(email_value)>254 or email_value!~'^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'then raise exception 'INVALID_DETAILS';end if;
  select *into target from auth.users where lower(email)=email_value and deleted_at is null for update;
  if target.id is null or target.email_confirmed_at is null then raise exception 'VERIFIED_ACCOUNT_REQUIRED';end if;
  if target.raw_app_meta_data->>'role'in('admin','agent')then raise exception 'ALREADY_ADMIN';end if;
  if target.raw_app_meta_data->>'role'is distinct from 'customer'or target.banned_until>now()
   or exists(select 1 from public.branches where manager_id=target.id)
   or exists(select 1 from public.barbers where user_id=target.id)
   or exists(select 1 from private.customer_social_identities where user_id=target.id or account_user_id=target.id)then raise exception 'SEPARATE_ADMIN_ACCOUNT_REQUIRED';end if;
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||jsonb_build_object('role','agent'),updated_at=now()where id=target.id;
  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,new_values)
   values(actor,target.id,'role_assigned','user',target.id,'{"role":"admin"}'::jsonb);
 elsif p_action in('disable','enable')then
  select *into target from auth.users where id=(p_data->>'userId')::uuid and deleted_at is null for update;
  if target.id is null or target.id=actor or target.raw_app_meta_data->>'role'is distinct from 'agent'then raise exception 'PROTECTED_ADMIN_ACCOUNT';end if;
  update auth.users set banned_until=case when p_action='enable'then null else now()+interval'100 years'end,updated_at=now()where id=target.id;
  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,new_values)
   values(actor,target.id,case when p_action='enable'then 'user_enabled'else 'user_disabled'end,'user',target.id,jsonb_build_object('enabled',p_action='enable'));
 else raise exception 'INVALID_REQUEST';end if;
 if p_action in('add','disable')then
  insert into private.account_revoked_sessions(session_id,user_id)select id,user_id from auth.sessions where user_id=target.id on conflict(session_id)do nothing;
  update auth.sessions set not_after=now()where user_id=target.id;
 end if;
 return jsonb_build_object('success',true);
end $$;
