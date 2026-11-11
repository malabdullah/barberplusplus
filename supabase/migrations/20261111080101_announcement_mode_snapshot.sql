begin;
-- A captured preview can never become a real push after a runtime switch.
alter table private.announcement_campaigns add column delivery_mode text not null default 'capture' check(delivery_mode in('capture','apns'));
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
   join private.customer_push_devices d on d.account_id=t.account_id join private.announcement_devices cap on cap.device_id=d.id where t.campaign_id=campaign.id and t.exclusion is null and private.announcement_device_allowed(d.id,t.account_id);
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
create or replace function private.announcement_delivery_allowed(p_id uuid)returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.announcement_deliveries j join private.announcement_targets t on t.id=j.target_id
  join private.announcement_campaigns c on c.id=j.campaign_id join private.customer_push_devices d on d.id=j.device_id
  join private.announcement_devices cap on cap.device_id=d.id and cap.binding=j.recipient_binding
  join private.announcement_preferences pref on pref.account_id=t.account_id
  where j.id=p_id and c.state='queued'and c.expires_at>now()and t.account_id=d.account_id
   and d.registration_version=j.registration_version and extensions.digest(d.token,'sha256')=j.token_hash
   and c.delivery_mode=(select mode from private.announcement_runtime where singleton)and pref.enabled_since<=c.created_at and private.announcement_device_allowed(d.id,t.account_id));
$$;


commit;
