begin;
-- Re-enabling the master switch never resurrects older queued announcements.
create or replace function private.announcement_delivery_allowed(p_id uuid)returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.announcement_deliveries j join private.announcement_targets t on t.id=j.target_id
  join private.announcement_campaigns c on c.id=j.campaign_id join private.customer_push_devices d on d.id=j.device_id
  join private.announcement_devices cap on cap.device_id=d.id and cap.binding=j.recipient_binding
  join private.announcement_preferences pref on pref.account_id=t.account_id
  left join private.customer_push_preferences master on master.account_id=t.account_id
  where j.id=p_id and c.state='queued'and c.expires_at>now()and t.account_id=d.account_id
   and d.registration_version=j.registration_version and extensions.digest(d.token,'sha256')=j.token_hash
   and c.delivery_mode=(select mode from private.announcement_runtime where singleton)and coalesce((master.preference_enabled_since->>'enabled')::timestamptz,'-infinity'::timestamptz)<=c.created_at
   and coalesce((d.preference_enabled_since->>'enabled')::timestamptz,'-infinity'::timestamptz)<=c.created_at
   and pref.enabled_since<=c.created_at and private.announcement_device_allowed(d.id,t.account_id));
$$;


commit;
