begin;
alter table private.announcement_devices add column binding text not null default encode(extensions.gen_random_bytes(32),'hex') check(binding ~ '^[0-9a-f]{64}$');
alter table private.announcement_deliveries add column recipient_binding text not null default encode(extensions.gen_random_bytes(32),'hex') check(recipient_binding ~ '^[0-9a-f]{64}$');
-- Bound all growing admin lists; retain the sending administrator in history.
create or replace function private.announcement_summary(p_campaign uuid)returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'titleEn',c.title_en,'bodyEn',c.body_en,'titleAr',c.title_ar,'bodyAr',c.body_ar,'destination',c.destination,
  'createdBy',c.created_by,'createdByName',(select coalesce(u.raw_user_meta_data->>'name',u.email,'')from auth.users u where u.id=c.created_by),'state',c.state,'createdAt',c.created_at,'queuedAt',c.queued_at,'previewExpiresAt',c.preview_expires_at,'expiresAt',c.expires_at,
  'matchedUsers',(select count(*)from private.announcement_targets t where t.campaign_id=c.id),
  'eligibleUsers',(select count(*)from private.announcement_targets t where t.campaign_id=c.id and t.exclusion is null),
  'excludedUsers',(select count(*)from private.announcement_targets t where t.campaign_id=c.id and t.exclusion is not null),
  'devices',(select count(*)from private.announcement_deliveries d where d.campaign_id=c.id),
  'results',(select coalesce(jsonb_object_agg(state,n),'{}')from(select state,count(*)n from private.announcement_deliveries d where d.campaign_id=c.id group by state)x))
 from private.announcement_campaigns c where c.id=p_campaign;
$$;

create or replace function private.admin_push_api(p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(p_data->>'user_id')::uuid;sid uuid:=(p_data->>'session_id')::uuid;campaign private.announcement_campaigns;filters jsonb;
 page integer:=coalesce((p_data->>'page')::integer,1);rows jsonb;total bigint;runtime private.announcement_runtime;
begin
 perform private.require_announcement_admin(actor,sid);
 if page not between 1 and 10000 or length(coalesce(p_data->>'query',''))>120 then raise exception 'INVALID_REQUEST';end if;
 select * into runtime from private.announcement_runtime where singleton;
 if p_action='options'then
  return jsonb_build_object('governorates',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'nameEn',name_en,'nameAr',name_ar)order by id),'[]')from public.governorates),
   'cities',(select coalesce(jsonb_agg(jsonb_build_object('city',city,'governorateId',governorate_id)order by city),'[]')from(select distinct city,governorate_id from public.branches where city is not null)x),
   'shops',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'nameAr',name_ar,'city',city,'governorateId',governorate_id)order by name,id),'[]')from(select id,name,name_ar,city,governorate_id from public.branches where coalesce(p_data->>'query','')=''or position(lower(p_data->>'query')in lower(name||' '||coalesce(name_ar,'')||' '||coalesce(city,'')))>0 order by name,id limit 25 offset(page-1)*25)x),
   'shopTotal',(select count(*)from public.branches where coalesce(p_data->>'query','')=''or position(lower(p_data->>'query')in lower(name||' '||coalesce(name_ar,'')||' '||coalesce(city,'')))>0),
   'delivery',jsonb_build_object('enabled',runtime.enabled,'mode',runtime.mode));
 elsif p_action in('users','preview')then
  filters:=coalesce(p_data->'filters','{}');
  if jsonb_typeof(filters)<>'object'or filters-array['roles','userIds','excludeIds','shopIds','governorateId','city','query','upcoming','dateFrom','dateTo']<>'{}'
   or length(coalesce(filters->>'query',''))>120 or length(coalesce(filters->>'city',''))>120 then raise exception 'INVALID_REQUEST';end if;
  if filters?'upcoming'and jsonb_typeof(filters->'upcoming')<>'boolean'then raise exception 'INVALID_REQUEST';end if;
  for rows in select filters->key from unnest(array['roles','userIds','excludeIds','shopIds'])key where filters?key loop
   if jsonb_typeof(rows)<>'array'or jsonb_array_length(rows)>500 then raise exception 'INVALID_REQUEST';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements_text(coalesce(filters->'roles','[]'))x where x not in('customer','manager','barber'))then raise exception 'INVALID_REQUEST';end if;
  if coalesce(filters->>'dateFrom','')<>''and coalesce(filters->>'dateTo','')<>''and(filters->>'dateFrom')::date>(filters->>'dateTo')::date then raise exception 'INVALID_REQUEST';end if;
  if p_action='users'then
   select count(*)into total from private.announcement_audience(filters);
   select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select account_id as id,name,email,role,device_count as devices,exclusion from private.announcement_audience(filters)order by name,account_id limit 25 offset(page-1)*25)x;
   return jsonb_build_object('users',rows,'total',total,'page',page,'pageSize',25);
  end if;
  if not runtime.enabled then raise exception 'DELIVERY_DISABLED';end if;
  if length(btrim(coalesce(p_data->>'titleEn','')))not between 1 and 80 or length(btrim(coalesce(p_data->>'bodyEn','')))not between 1 and 500
   or length(coalesce(p_data->>'titleAr',''))>80 or length(coalesce(p_data->>'bodyAr',''))>500
   or coalesce(p_data->>'destination','none')not in('none','book','account','favourites')
   or((btrim(coalesce(p_data->>'titleAr',''))='')is distinct from(btrim(coalesce(p_data->>'bodyAr',''))=''))then raise exception 'INVALID_REQUEST';end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,718));
  if(select count(*)from private.announcement_campaigns where created_by=actor and created_at>now()-interval '1 hour')>=60 then raise exception 'RATE_LIMITED';end if;
  if(select count(*)from private.announcement_audience(filters))>50000 then raise exception 'AUDIENCE_TOO_LARGE';end if;
  insert into private.announcement_campaigns(created_by,created_session,title_en,body_en,title_ar,body_ar,destination,filters)
   values(actor,sid,btrim(p_data->>'titleEn'),btrim(p_data->>'bodyEn'),btrim(coalesce(p_data->>'titleAr','')),btrim(coalesce(p_data->>'bodyAr','')),coalesce(p_data->>'destination','none'),filters)returning * into campaign;
  insert into private.announcement_targets(campaign_id,account_id,exclusion)select campaign.id,a.account_id,a.exclusion from private.announcement_audience(filters)a;
  insert into private.announcement_deliveries(campaign_id,target_id,device_id,registration_version,token_hash,recipient_binding)
   select campaign.id,t.id,d.id,d.registration_version,extensions.digest(d.token,'sha256'),cap.binding from private.announcement_targets t
   join private.customer_push_devices d on d.account_id=t.account_id join private.announcement_devices cap on cap.device_id=d.id where t.campaign_id=campaign.id and t.exclusion is null and private.announcement_device_allowed(d.id,t.account_id);
  return jsonb_build_object('campaign',private.announcement_summary(campaign.id),'delivery',jsonb_build_object('enabled',runtime.enabled,'mode',runtime.mode));
 elsif p_action='send'then
  select * into campaign from private.announcement_campaigns where id=(p_data->>'campaignId')::uuid for update;
  if not found or campaign.created_by is distinct from actor or campaign.created_session is distinct from sid then raise exception 'FORBIDDEN';end if;
  if campaign.state='queued'then return jsonb_build_object('campaign',private.announcement_summary(campaign.id));end if;
  if not runtime.enabled then raise exception 'DELIVERY_DISABLED';end if;
  if campaign.preview_expires_at<=clock_timestamp()then raise exception 'PREVIEW_EXPIRED';end if;
  if not exists(select 1 from private.announcement_deliveries where campaign_id=campaign.id)then raise exception 'NO_RECIPIENTS';end if;
  if p_data->'confirmed'is distinct from 'true'::jsonb then raise exception 'CONFIRMATION_REQUIRED';end if;
  update private.announcement_campaigns set state='queued',queued_at=clock_timestamp()where id=campaign.id;
  perform private.kick_admin_push();return jsonb_build_object('campaign',private.announcement_summary(campaign.id));
 elsif p_action='history'then
  select count(*)into total from private.announcement_campaigns where state='queued';
  select coalesce(jsonb_agg(private.announcement_summary(x.id)),'[]')into rows from(select id from private.announcement_campaigns where state='queued'order by created_at desc,id desc limit 25 offset(page-1)*25)x;
  return jsonb_build_object('campaigns',rows,'total',total,'page',page,'pageSize',25);
 elsif p_action in('details','recipients')then
  select * into campaign from private.announcement_campaigns where id=(p_data->>'campaignId')::uuid;
  if not found then raise exception 'NOT_FOUND';end if;
  if p_action='details'then return jsonb_build_object('campaign',private.announcement_summary(campaign.id));end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select t.account_id id,coalesce(c.name,'')name,coalesce(u.email,'')email,u.raw_app_meta_data->>'role'role,t.exclusion,
   (select count(*)from private.announcement_deliveries j where j.target_id=t.id)devices,
   (select coalesce(jsonb_object_agg(state,n),'{}')from(select state,count(*)n from private.announcement_deliveries j where j.target_id=t.id group by state)y)results
   from private.announcement_targets t left join auth.users u on u.id=t.account_id left join private.customer_accounts ca on ca.user_id=t.account_id left join public.customers c on c.id=ca.customer_id
   where t.campaign_id=campaign.id order by t.id limit 25 offset(page-1)*25)x;
  return jsonb_build_object('users',rows,'campaign',private.announcement_summary(campaign.id),'page',page,'pageSize',25);
 end if;
 raise exception 'INVALID_REQUEST';
end $$;
create or replace function private.customer_announcement_api(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare account uuid:=(p_data->>'user_id')::uuid;sid uuid:=(p_data->>'session_id')::uuid;d private.customer_push_devices;
begin
 if not public.customer_session_is_live(account,sid)then raise exception 'AUTH_REQUIRED';end if;
 if p_action not in ('status','register','preference')or p_action is null then raise exception 'INVALID_REQUEST';end if;
 if p_action in ('register','preference')then
  if p_data->>'deviceSecret' !~ '^[0-9a-f]{64}$'or p_data->>'deviceSecret'is null or p_data->>'version'<>'1'then raise exception 'INVALID_REQUEST';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_data->>'deviceId',714));
  select * into d from private.customer_push_devices where id=(p_data->>'deviceId')::uuid for update;
  if not found or d.account_id is distinct from account or d.session_id is distinct from sid
   or d.secret_hash is distinct from extensions.digest(p_data->>'deviceSecret','sha256')then raise exception 'FORBIDDEN';end if;
  insert into private.announcement_devices as saved(device_id,account_id,session_id,registration_version)values(d.id,account,sid,d.registration_version)
   on conflict(device_id)do update set account_id=excluded.account_id,session_id=excluded.session_id,registration_version=excluded.registration_version,registered_at=clock_timestamp(),binding=case when saved.account_id=excluded.account_id and saved.session_id=excluded.session_id then saved.binding else excluded.binding end;
  if p_action='preference'then
   if jsonb_typeof(p_data->'enabled')is distinct from 'boolean'then raise exception 'INVALID_REQUEST';end if;
   insert into private.announcement_preferences as saved(account_id,enabled)values(account,(p_data->>'enabled')::boolean)
    on conflict(account_id)do update set enabled=excluded.enabled,enabled_since=case when excluded.enabled and not saved.enabled then clock_timestamp()else saved.enabled_since end;
  end if;
 end if;
 return jsonb_build_object('enabled',coalesce((select enabled from private.announcement_preferences where account_id=account),false),'version',1)||case when p_action='status'then'{}'::jsonb else jsonb_build_object('recipientBinding',(select binding from private.announcement_devices where device_id=d.id and account_id=account and session_id=sid))end;
end $$;

create or replace function private.announcement_delivery_allowed(p_id uuid)returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.announcement_deliveries j join private.announcement_targets t on t.id=j.target_id
  join private.announcement_campaigns c on c.id=j.campaign_id join private.customer_push_devices d on d.id=j.device_id
  join private.announcement_devices cap on cap.device_id=d.id and cap.binding=j.recipient_binding
  join private.announcement_preferences pref on pref.account_id=t.account_id
  where j.id=p_id and c.state='queued'and c.expires_at>now()and t.account_id=d.account_id
   and d.registration_version=j.registration_version and extensions.digest(d.token,'sha256')=j.token_hash
   and pref.enabled_since<=c.created_at and private.announcement_device_allowed(d.id,t.account_id));
$$;


create or replace function private.admin_push_worker(p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare runtime private.announcement_runtime;result jsonb;j private.announcement_deliveries;status integer;reason text;
begin
 select * into runtime from private.announcement_runtime where singleton;
 if p_action='configuration'then return private.customer_push_configuration()||jsonb_build_object('announcementEnabled',runtime.enabled,'deliveryMode',runtime.mode,'announcementApiUrl',runtime.api_url);end if;
 if p_action='configure'then
  if jsonb_typeof(p_data->'enabled')is distinct from'boolean'or p_data->>'mode'not in('capture','apns')or p_data->>'apiUrl'is distinct from(select api_url from private.customer_push_runtime where singleton)then raise exception 'INVALID_REQUEST';end if;
  update private.announcement_runtime set enabled=(p_data->>'enabled')::boolean,mode=p_data->>'mode',api_url=p_data->>'apiUrl'where singleton;return jsonb_build_object('configured',true);
 end if;
 if not runtime.enabled and p_action<>'finish'then raise exception 'DELIVERY_DISABLED';end if;
 if p_action='claim'then
  -- An expired lease may have reached Apple. Never resend an uncertain delivery.
  update private.announcement_deliveries set state='unknown',last_error='LeaseExpired',finished_at=clock_timestamp()where state='sending'and leased_until<now();
  update private.announcement_deliveries j set state='skipped',last_error='NoLongerEligible',finished_at=clock_timestamp()
   from private.announcement_campaigns c where j.campaign_id=c.id and c.state='queued'and j.state='pending'and not private.announcement_delivery_allowed(j.id);
  with candidates as(select d.id from private.announcement_deliveries d join private.announcement_campaigns c on c.id=d.campaign_id
   where c.state='queued'and d.state='pending'and d.available_at<=now()order by d.available_at,d.id for update of d skip locked limit greatest(1,least(coalesce((p_data->>'limit')::integer,20),20))),
  leased as(update private.announcement_deliveries d set state='sending',delivery_mode=runtime.mode,attempts=attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '2 minutes'from candidates c where d.id=c.id returning d.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'lease',l.lease_id,'campaignId',c.id,'recipientBinding',l.recipient_binding,'deliveryMode',l.delivery_mode,'token',d.token,'environment',d.environment,'topic',d.topic,'language',d.language,
   'titleEn',c.title_en,'bodyEn',c.body_en,'titleAr',c.title_ar,'bodyAr',c.body_ar,'destination',c.destination,'expiresAt',extract(epoch from c.expires_at)::bigint)),'[]')into result
   from leased l join private.announcement_campaigns c on c.id=l.campaign_id join private.customer_push_devices d on d.id=l.device_id;
  return result;
 elsif p_action='validate'then
  return to_jsonb(exists(select 1 from private.announcement_deliveries d where d.id=(p_data->>'id')::uuid and d.lease_id=(p_data->>'lease')::uuid and d.state='sending'and d.leased_until>now()and runtime.enabled and d.delivery_mode=runtime.mode and private.announcement_delivery_allowed(d.id)));
 elsif p_action='finish'then
  select * into j from private.announcement_deliveries where id=(p_data->>'id')::uuid and lease_id=(p_data->>'lease')::uuid and state='sending'for update;
  if not found then return 'false'::jsonb;end if;
  status:=(p_data->>'status')::integer;reason:=left(coalesce(p_data->>'reason',''),80);
  if reason='NoLongerEligible'then update private.announcement_deliveries set state='skipped',last_error=reason,finished_at=clock_timestamp(),leased_until=null where id=j.id;
  elsif status=200 then update private.announcement_deliveries set state=case when j.delivery_mode='capture'then'captured'else'accepted'end,provider_status=status,provider_id=left(p_data->>'providerId',100),finished_at=clock_timestamp(),leased_until=null where id=j.id;
  elsif status in(429,500,503)and j.attempts<3 then update private.announcement_deliveries set state='pending',available_at=now()+make_interval(secs=>30*power(2,j.attempts)::integer),last_error=reason,provider_status=status,leased_until=null where id=j.id;
  else
   update private.announcement_deliveries set state=case when status=0 then'unknown'else'failed'end,provider_status=status,last_error=reason,finished_at=clock_timestamp(),leased_until=null where id=j.id;
   if status=410 or reason in('BadDeviceToken','Unregistered','DeviceTokenNotForTopic')then
    update private.customer_push_devices set permission=false,token=null where id=j.device_id and extensions.digest(token,'sha256')=j.token_hash;
   end if;
  end if;
  return 'true'::jsonb;
 end if;
 raise exception 'INVALID_REQUEST';
end $$;

notify pgrst,'reload schema';
commit;
