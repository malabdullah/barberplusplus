begin;
create or replace function private.announcement_device_allowed(p_device uuid,p_account uuid)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.customer_push_devices d
  join private.announcement_devices cap on cap.device_id=d.id and cap.account_id=d.account_id and cap.session_id=d.session_id and cap.registration_version=d.registration_version
  join private.announcement_preferences ap on ap.account_id=d.account_id and ap.enabled
  join private.customer_accounts ca on ca.user_id=d.account_id join public.customers c on c.id=ca.customer_id and c.status='active'
  left join private.customer_push_preferences pref on pref.account_id=d.account_id
  join private.customer_push_runtime runtime on runtime.singleton
  where d.id=p_device and d.account_id=p_account and d.enabled and d.permission and d.notifications_enabled
   and coalesce(pref.notifications_enabled,true)and public.customer_session_is_live(d.account_id,d.session_id)
   and d.topic=runtime.topic and d.environment=any(runtime.environments)
   and length(d.token)between 32 and 512 and d.token ~ '^[0-9a-f]+$'and length(d.token)%2=0);
$$;

commit;
