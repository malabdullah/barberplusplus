begin;
-- Operator-only, finite acceptance lease. It never enables either general queue.
create table private.android_announcement_acceptance(
 singleton boolean primary key default true check(singleton),
 delivery_id uuid references private.android_announcement_deliveries(id) on delete set null,
 expires_at timestamptz not null default '-infinity'
);
insert into private.android_announcement_acceptance(singleton)values(true);
alter table private.android_announcement_acceptance enable row level security;
revoke all on private.android_announcement_acceptance from public,anon,authenticated,service_role;

create function private.android_announcement_acceptance_allowed(p_id uuid)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.android_announcement_acceptance scope
 join private.android_announcement_deliveries j on j.id=scope.delivery_id
 join private.announcement_campaigns c on c.id=j.campaign_id
 join private.announcement_targets t on t.id=j.target_id and t.campaign_id=c.id
 join private.android_live_push_devices d on d.id=j.device_id and d.account_id=t.account_id
 join private.android_announcement_devices cap on cap.device_id=d.id and cap.account_id=d.account_id and cap.session_id=d.session_id
 join private.announcement_preferences pref on pref.account_id=d.account_id and pref.enabled
 left join private.customer_push_preferences master on master.account_id=d.account_id
 join private.android_live_push_runtime r on r.singleton
 join private.android_announcement_runtime ar on ar.singleton
 where scope.singleton and scope.expires_at>clock_timestamp() and j.id=p_id
 and not r.delivery_enabled and not ar.enabled and r.registration_enabled
 and r.environment='production'and r.api_url='https://srv1073968.hstgr.cloud'and private.android_live_push_bound(r)
 and r.project_id='barber-plus-plus-phone-prod'and r.package_name='com.barberplusplus.customer'
 and c.state='preview'and c.expires_at>clock_timestamp()and c.delivery_mode='apns'and j.delivery_mode='apns'
 and c.created_at>clock_timestamp()-interval'15 minutes'and t.exclusion is null
 and private.announcement_author_allowed(c.created_by)
 and private.android_live_push_owner(d.account_id,d.session_id)
 and d.permission and not d.detached and coalesce(master.notifications_enabled,true)
 and pref.enabled_since<=c.created_at
 and coalesce((master.preference_enabled_since->>'enabled')::timestamptz,'-infinity')<=c.created_at
 and d.updated_at>clock_timestamp()-interval'90 days'
 and length(d.token)between 20 and 4096 and d.token~'^[A-Za-z0-9_:-]+$'
 and d.token_hash=extensions.digest(d.token,'sha256')and j.token_hash=d.token_hash
 and j.registration_version=d.registration_version and cap.registration_version=d.registration_version
 and j.recipient_binding=cap.binding and j.eligibility_epoch=cap.eligibility_epoch
 and(select count(*)from private.android_announcement_deliveries where campaign_id=c.id)=1
 and not exists(select 1 from private.announcement_deliveries where campaign_id=c.id)
 and not exists(select 1 from private.announcement_targets where campaign_id=c.id and id<>t.id));
$$;

create function private.android_announcement_acceptance_worker(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.android_announcement_deliveries;cfg jsonb;scope_id uuid;status integer;
begin
 if auth.role()is distinct from'service_role'then raise exception'FORBIDDEN';end if;
 select delivery_id into scope_id from private.android_announcement_acceptance where singleton for update;
 if p_action='configure'then
  if p_data->>'deliveryId'is null then
   update private.android_announcement_acceptance set delivery_id=null,expires_at='-infinity'where singleton;
   return '{"configured":true}';
  end if;
  select * into j from private.android_announcement_deliveries where id=(p_data->>'deliveryId')::uuid for update;
  if not found or j.state<>'pending'or j.attempts<>0 then raise exception'ACCEPTANCE_SCOPE_INVALID';end if;
  update private.android_announcement_acceptance set delivery_id=j.id,expires_at=clock_timestamp()+interval'10 minutes'where singleton;
  if not private.android_announcement_acceptance_allowed(j.id)then raise exception'ACCEPTANCE_SCOPE_INVALID';end if;
  return '{"configured":true}';
 end if;
 if p_action='configuration'then
  if scope_id is null or not private.android_announcement_acceptance_allowed(scope_id)then return '{"enabled":false}';end if;
  -- This narrowly scoped credential read does not change the general delivery flag.
  select jsonb_build_object('enabled',true,'apiUrl',r.api_url,'projectId',r.project_id,'packageName',r.package_name,'senderEmail',r.sender_email,
   'credential',(select decrypted_secret::jsonb from vault.decrypted_secrets where name='customer_android_live_fcm'))into cfg from private.android_live_push_runtime r where singleton;
  return cfg||jsonb_build_object('dispatchSecret',(private.admin_push_ios_worker('configuration','{}')->>'dispatchSecret'));
 end if;
 if p_action='claim'then
  if scope_id is null or not private.android_announcement_acceptance_allowed(scope_id)then return'[]';end if;
  update private.android_announcement_deliveries set state='sending',attempts=1,lease_id=gen_random_uuid(),leased_until=clock_timestamp()+interval'2 minutes'
   where id=scope_id and state='pending'and attempts=0 and available_at<=clock_timestamp() returning * into j;
  if not found then return'[]';end if;
  return(select jsonb_build_array(jsonb_build_object('id',j.id,'lease',j.lease_id,'campaignId',c.id,'recipientBinding',j.recipient_binding,'deliveryMode','apns',
   'client','android','token',d.token,'environment','production','projectId','barber-plus-plus-phone-prod','packageName','com.barberplusplus.customer','language',d.language,
   'titleEn',c.title_en,'bodyEn',c.body_en,'titleAr',c.title_ar,'bodyAr',c.body_ar,'destination',c.destination,'expiresAt',extract(epoch from least(c.expires_at,(select expires_at from private.android_announcement_acceptance where singleton)))::bigint))
   from private.announcement_campaigns c join private.android_live_push_devices d on d.id=j.device_id where c.id=j.campaign_id);
 end if;
 select * into j from private.android_announcement_deliveries where id=scope_id and id=(p_data->>'id')::uuid and lease_id=(p_data->>'lease')::uuid and state='sending'for update;
 if not found then return'false';end if;
 if p_action='validate'then return to_jsonb(j.leased_until>clock_timestamp()and private.android_announcement_acceptance_allowed(j.id));end if;
 if p_action='finish'then
  status:=(p_data->>'status')::integer;
  update private.android_announcement_deliveries set state=case when status=200 then'accepted'when status=0 then'unknown'else'failed'end,
   provider_status=status,provider_id=left(p_data->>'providerId',150),last_error=left(p_data->>'reason',80),finished_at=clock_timestamp(),leased_until=null where id=j.id;
  update private.android_announcement_acceptance set delivery_id=null,expires_at='-infinity'where singleton;
  return'true';
 end if;
 raise exception'INVALID_REQUEST';
end $$;

do $$declare source text:=pg_get_functiondef('private.admin_push_worker(text,jsonb)'::regprocedure);begin
 execute replace(source,'FUNCTION private.admin_push_worker(','FUNCTION private.admin_push_general_worker(');
end $$;
create or replace function private.admin_push_worker(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if p_action like'acceptance-%'then return private.android_announcement_acceptance_worker(substring(p_action from 12),p_data);end if;
 return private.admin_push_general_worker(p_action,p_data);
end $$;
revoke all on function private.android_announcement_acceptance_allowed(uuid),private.android_announcement_acceptance_worker(text,jsonb),private.admin_push_general_worker(text,jsonb),private.admin_push_worker(text,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.admin_push_worker(text,jsonb)to service_role;
commit;
