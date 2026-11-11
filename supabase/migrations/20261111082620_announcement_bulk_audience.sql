begin;
-- Bulk audience queries join eligibility once; per-delivery safety still rechecks it.
create view private.announcement_eligible_devices as
 select d.id,d.account_id,d.session_id,d.registration_version,d.token
 from private.customer_push_devices d
 join private.announcement_devices cap on cap.device_id=d.id and cap.account_id=d.account_id and cap.session_id=d.session_id and cap.registration_version=d.registration_version
 join private.announcement_preferences ap on ap.account_id=d.account_id and ap.enabled
 join private.customer_accounts ca on ca.user_id=d.account_id
 join public.customers c on c.id=ca.customer_id and c.status='active'
 join auth.users u on u.id=d.account_id and u.raw_app_meta_data->>'role' in('customer','manager','barber')and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
 join auth.sessions s on s.id=d.session_id and s.user_id=d.account_id and(s.not_after is null or s.not_after>now())
 left join private.customer_push_preferences pref on pref.account_id=d.account_id
 join private.customer_push_runtime runtime on runtime.singleton
 where d.enabled and d.permission and d.notifications_enabled and coalesce(pref.notifications_enabled,true)
 and d.topic=runtime.topic and d.environment=any(runtime.environments)
 and length(d.token)between 32 and 512 and d.token~'^[0-9a-f]+$'and length(d.token)%2=0;
revoke all on private.announcement_eligible_devices from public,anon,authenticated;
grant select on private.announcement_eligible_devices to service_role;
create or replace function private.announcement_device_allowed(p_device uuid,p_account uuid)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.announcement_eligible_devices where id=p_device and account_id=p_account);
$$;
create or replace function private.announcement_audience(p_filters jsonb)returns table(account_id uuid,name text,email text,role text,device_count bigint,exclusion text)
language sql stable security definer set search_path='' as $$
 with accounts as(
  select ca.user_id id,c.name,coalesce(u.email,'')email,u.raw_app_meta_data->>'role'role,c.status,
   u.deleted_at,u.banned_until,coalesce((select ap.enabled from private.announcement_preferences ap where ap.account_id=ca.user_id),false) opted_in
  from private.customer_accounts ca join public.customers c on c.id=ca.customer_id join auth.users u on u.id=ca.user_id
  where u.raw_app_meta_data->>'role'in('customer','manager','barber')
   and(coalesce(jsonb_array_length(p_filters->'roles'),0)=0 or (u.raw_app_meta_data->>'role')in(select jsonb_array_elements_text(p_filters->'roles')))
   and(coalesce(jsonb_array_length(p_filters->'userIds'),0)=0 or ca.user_id in(select value::uuid from jsonb_array_elements_text(p_filters->'userIds')))
   and not ca.user_id in(select value::uuid from jsonb_array_elements_text(coalesce(p_filters->'excludeIds','[]')))
   and(coalesce(p_filters->>'query','')=''or position(lower(p_filters->>'query')in lower(c.name||' '||coalesce(u.email,'')||' '||coalesce(c.phone,'')))>0)
   and(not(coalesce(p_filters->>'upcoming','false')='true'or coalesce(p_filters->>'dateFrom','')<>''or coalesce(p_filters->>'dateTo','')<>''
     or coalesce(jsonb_array_length(p_filters->'shopIds'),0)>0 or coalesce(p_filters->>'governorateId','')<>''or coalesce(p_filters->>'city','')<>'')
    or exists(select 1 from private.customer_booking_owners o join public.bookings b on b.id=o.booking_id join public.branches s on s.id=b.branch_id
     where o.account_user_id=ca.user_id and b.status in('pending','confirmed','completed')
      and(coalesce(p_filters->>'upcoming','false')<>'true'or(b.status in('pending','confirmed')and(b.date+b.time)at time zone'Asia/Kuwait'>now()))
      and(coalesce(p_filters->>'dateFrom','')=''or b.date>=(p_filters->>'dateFrom')::date)
      and(coalesce(p_filters->>'dateTo','')=''or b.date<=(p_filters->>'dateTo')::date)
      and(coalesce(jsonb_array_length(p_filters->'shopIds'),0)=0 or s.id in(select value::uuid from jsonb_array_elements_text(p_filters->'shopIds')))
      and(coalesce(p_filters->>'governorateId','')=''or s.governorate_id=(p_filters->>'governorateId')::integer)
      and(coalesce(p_filters->>'city','')=''or s.city=p_filters->>'city')))
 ),device_counts as(select account_id,count(*)devices from private.announcement_eligible_devices group by account_id),
 counts as(select a.*,coalesce(d.devices,0)devices from accounts a left join device_counts d on d.account_id=a.id)
 select id,name,email,role,devices,case when deleted_at is not null or(banned_until is not null and banned_until>now())or status<>'active'then'account_inactive'
  when not opted_in then'opted_out'when devices=0 then'no_eligible_device'else null end from counts;
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
  insert into private.announcement_campaigns(created_by,created_session,title_en,body_en,title_ar,body_ar,destination,filters,delivery_mode)
   values(actor,sid,btrim(p_data->>'titleEn'),btrim(p_data->>'bodyEn'),btrim(coalesce(p_data->>'titleAr','')),btrim(coalesce(p_data->>'bodyAr','')),coalesce(p_data->>'destination','none'),filters,runtime.mode)returning * into campaign;
  insert into private.announcement_targets(campaign_id,account_id,exclusion)select campaign.id,a.account_id,a.exclusion from private.announcement_audience(filters)a;
  insert into private.announcement_deliveries(campaign_id,target_id,device_id,registration_version,token_hash,recipient_binding)
   select campaign.id,t.id,d.id,d.registration_version,extensions.digest(d.token,'sha256'),cap.binding from private.announcement_targets t
   join private.announcement_eligible_devices d on d.account_id=t.account_id join private.announcement_devices cap on cap.device_id=d.id where t.campaign_id=campaign.id and t.exclusion is null;
  return jsonb_build_object('campaign',private.announcement_summary(campaign.id),'delivery',jsonb_build_object('enabled',runtime.enabled,'mode',runtime.mode));
 elsif p_action='send'then
  select * into campaign from private.announcement_campaigns where id=(p_data->>'campaignId')::uuid for update;
  if not found or campaign.created_by is distinct from actor or campaign.created_session is distinct from sid then raise exception 'FORBIDDEN';end if;
  if campaign.state='queued'then return jsonb_build_object('campaign',private.announcement_summary(campaign.id));end if;
  if not runtime.enabled then raise exception 'DELIVERY_DISABLED';end if;
  if campaign.delivery_mode is distinct from runtime.mode then raise exception 'PREVIEW_EXPIRED';end if;
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
create or replace function private.admin_push_worker(p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare runtime private.announcement_runtime;result jsonb;saved_delivery private.announcement_deliveries;status integer;reason text;
begin
 select * into runtime from private.announcement_runtime where singleton;
 if p_action='configuration'then return private.customer_push_configuration()||jsonb_build_object('announcementEnabled',runtime.enabled,'deliveryMode',runtime.mode,'announcementApiUrl',runtime.api_url);end if;
 if p_action='configure'then
  if jsonb_typeof(p_data->'enabled')is distinct from'boolean'or p_data->>'mode'not in('capture','apns')or p_data->>'apiUrl'is distinct from(select api_url from private.customer_push_runtime where singleton)then raise exception 'INVALID_REQUEST';end if;
  update private.announcement_runtime set enabled=(p_data->>'enabled')::boolean,mode=p_data->>'mode',api_url=p_data->>'apiUrl'where singleton;return jsonb_build_object('configured',true);
 end if;
 if not runtime.enabled and p_action<>'finish'then raise exception 'DELIVERY_DISABLED';end if;
 if p_action='continue'then
  if exists(select 1 from private.announcement_deliveries d join private.announcement_campaigns c on c.id=d.campaign_id where c.state='queued'and d.state='pending'and d.available_at<=now())then perform private.kick_admin_push();end if;
  return 'true'::jsonb;
 end if;
 if p_action='claim'then
  -- An expired lease may have reached Apple. Never resend an uncertain delivery.
  update private.announcement_deliveries set state='unknown',last_error='LeaseExpired',finished_at=clock_timestamp()where state='sending'and leased_until<now();
  with candidates as(select d.id from private.announcement_deliveries d join private.announcement_campaigns c on c.id=d.campaign_id
   where c.state='queued'and d.state='pending'and d.available_at<=now()order by d.available_at,d.id for update of d skip locked limit greatest(1,least(coalesce((p_data->>'limit')::integer,20),20))),
  checked as materialized(select id,private.announcement_delivery_allowed(id)allowed from candidates),
  leased as(update private.announcement_deliveries d set
   state=case when c.allowed then'sending'else'skipped'end,
   delivery_mode=runtime.mode,attempts=attempts+case when c.allowed then 1 else 0 end,
   lease_id=case when c.allowed then gen_random_uuid()else null end,
   leased_until=case when c.allowed then now()+interval '2 minutes'else null end,
   finished_at=case when c.allowed then null else clock_timestamp()end,
   last_error=case when c.allowed then null else'NoLongerEligible'end
   from checked c where d.id=c.id returning d.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'lease',l.lease_id,'campaignId',c.id,'recipientBinding',l.recipient_binding,'deliveryMode',l.delivery_mode,'token',d.token,'environment',d.environment,'topic',d.topic,'language',d.language,
   'titleEn',c.title_en,'bodyEn',c.body_en,'titleAr',c.title_ar,'bodyAr',c.body_ar,'destination',c.destination,'expiresAt',extract(epoch from c.expires_at)::bigint)),'[]')into result
   from leased l join private.announcement_campaigns c on c.id=l.campaign_id join private.customer_push_devices d on d.id=l.device_id where l.state='sending';
  return result;
 elsif p_action='validate'then
  return to_jsonb(exists(select 1 from private.announcement_deliveries d where d.id=(p_data->>'id')::uuid and d.lease_id=(p_data->>'lease')::uuid and d.state='sending'and d.leased_until>now()and runtime.enabled and d.delivery_mode=runtime.mode and private.announcement_delivery_allowed(d.id)));
 elsif p_action='finish'then
  select * into saved_delivery from private.announcement_deliveries where id=(p_data->>'id')::uuid and lease_id=(p_data->>'lease')::uuid and state='sending'for update;
  if not found then return 'false'::jsonb;end if;
  status:=(p_data->>'status')::integer;reason:=left(coalesce(p_data->>'reason',''),80);
  if reason='NoLongerEligible'then update private.announcement_deliveries set state='skipped',last_error=reason,finished_at=clock_timestamp(),leased_until=null where id=saved_delivery.id;
  elsif status=200 then update private.announcement_deliveries set state=case when saved_delivery.delivery_mode='capture'then'captured'else'accepted'end,provider_status=status,provider_id=left(p_data->>'providerId',100),finished_at=clock_timestamp(),leased_until=null where id=saved_delivery.id;
  elsif status in(429,500,503)and saved_delivery.attempts<3 then update private.announcement_deliveries set state='pending',available_at=now()+make_interval(secs=>30*power(2,saved_delivery.attempts)::integer),last_error=reason,provider_status=status,leased_until=null where id=saved_delivery.id;
  else
   update private.announcement_deliveries set state=case when status=0 then'unknown'else'failed'end,provider_status=status,last_error=reason,finished_at=clock_timestamp(),leased_until=null where id=saved_delivery.id;
   if status=410 or reason in('BadDeviceToken','Unregistered','DeviceTokenNotForTopic')then
    update private.customer_push_devices set permission=false,token=null where id=saved_delivery.device_id and extensions.digest(token,'sha256')=saved_delivery.token_hash;
   end if;
  end if;
  return 'true'::jsonb;
 end if;
 raise exception 'INVALID_REQUEST';
end $$;

notify pgrst,'reload schema';
commit;
