begin;
-- Scheduled announcements preserve the reviewed audience and delivery mode.
alter table private.announcement_campaigns drop constraint announcement_campaigns_state_check;
alter table private.announcement_campaigns add constraint announcement_campaigns_state_check check(state in('preview','scheduled','queued','cancelled'));
alter table private.announcement_campaigns add column scheduled_at timestamptz, add column confirmed_at timestamptz,
 add column cancelled_at timestamptz, add column cancelled_by uuid references auth.users(id) on delete set null,
 add column guard_version integer not null default 1;
alter table private.announcement_campaigns alter column guard_version set default 2;
create index announcement_campaigns_schedule on private.announcement_campaigns(scheduled_at,id)where state='scheduled';
alter table private.announcement_deliveries drop constraint announcement_deliveries_state_check;
alter table private.announcement_deliveries add constraint announcement_deliveries_state_check check(state in('pending','sending','accepted','captured','skipped','failed','unknown','cancelled'));
alter table private.announcement_devices add column eligibility_epoch bigint not null default 1;
alter table private.announcement_deliveries add column eligibility_epoch bigint not null default 0;
-- Ordinary version/language refreshes keep a reviewed delivery valid. Identity,
-- token, installation or OS-permission transitions invalidate it permanently.
create function private.announcement_device_epoch()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.account_id,new.session_id,new.token,new.environment,new.topic,new.enabled,new.permission,new.notifications_enabled,new.secret_hash)
  is distinct from row(old.account_id,old.session_id,old.token,old.environment,old.topic,old.enabled,old.permission,old.notifications_enabled,old.secret_hash)then
  update private.announcement_devices set eligibility_epoch=eligibility_epoch+1 where device_id=new.id;
 end if;
 return new;
end $$;
create trigger announcement_device_epoch after update on private.customer_push_devices for each row execute function private.announcement_device_epoch();
create table private.announcement_saved_audiences(
 id uuid primary key default gen_random_uuid(),created_by uuid not null references auth.users(id)on delete cascade,
 name text not null check(length(btrim(name))between 1 and 80),filters jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create unique index announcement_saved_audiences_name on private.announcement_saved_audiences(created_by,lower(name));
create index announcement_saved_audiences_list on private.announcement_saved_audiences(created_by,created_at desc,id);
alter table private.announcement_saved_audiences enable row level security;
revoke all on private.announcement_saved_audiences from public,anon,authenticated;
grant select,insert,update,delete on private.announcement_saved_audiences to service_role;
create function private.announcement_filters_valid(f jsonb)returns boolean language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;
begin
 if jsonb_typeof(f)is distinct from'object'or f-array['roles','userIds','excludeIds','shopIds','barberIds','governorateId','city','query','upcoming','dateFrom','dateTo','bookingStatuses','minCompleted','maxCompleted','lastVisitBefore','noBookings']<>'{}'then return false;end if;
 foreach k in array array['query','city']loop
  if f?k and(jsonb_typeof(f->k)<>'string'or length(f->>k)>120)then return false;end if;
 end loop;
 foreach k in array array['upcoming','noBookings']loop
  if f?k and jsonb_typeof(f->k)<>'boolean'then return false;end if;
 end loop;
 foreach k in array array['roles','userIds','excludeIds','shopIds','barberIds','bookingStatuses']loop
  if f?k then
   v:=f->k;
   if jsonb_typeof(v)<>'array'or jsonb_array_length(v)>500 then return false;end if;
   if exists(select 1 from jsonb_array_elements(v)x where jsonb_typeof(x)<>'string')then return false;end if;
   if k in('userIds','excludeIds','shopIds','barberIds')then perform value::uuid from jsonb_array_elements_text(v);end if;
  end if;
 end loop;
 if exists(select 1 from jsonb_array_elements_text(coalesce(f->'roles','[]'))x where x not in('customer','manager','barber'))then return false;end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(f->'bookingStatuses','[]'))x where x not in('pending','confirmed','completed','cancelled','no_show'))then return false;end if;
 foreach k in array array['dateFrom','dateTo','lastVisitBefore']loop
  if coalesce(f->>k,'')<>''then
   if jsonb_typeof(f->k)<>'string'or f->>k!~'^\d{4}-\d{2}-\d{2}$'then return false;end if;
   perform(f->>k)::date;
  end if;
 end loop;
 if coalesce(f->>'dateFrom','')<>''and coalesce(f->>'dateTo','')<>''and(f->>'dateFrom')::date>(f->>'dateTo')::date then return false;end if;
 if coalesce(f->>'governorateId','')<>''and(f->>'governorateId')::integer<=0 then return false;end if;
 foreach k in array array['minCompleted','maxCompleted']loop
  if coalesce(f->>k,'')<>''then
   if f->>k!~'^\d{1,6}$'or(f->>k)::integer>100000 then return false;end if;
  end if;
 end loop;
 if coalesce(f->>'minCompleted','')<>''and coalesce(f->>'maxCompleted','')<>''and(f->>'minCompleted')::int>(f->>'maxCompleted')::int then return false;end if;
 if f->>'noBookings'='true'and(
   f->>'upcoming'='true'or coalesce(f->>'dateFrom','')<>''or coalesce(f->>'dateTo','')<>''or coalesce(f->>'lastVisitBefore','')<>''
   or coalesce(f->>'minCompleted','')<>''or coalesce(f->>'maxCompleted','')<>''or coalesce(f->>'city','')<>''or coalesce(f->>'governorateId','')<>''
   or jsonb_array_length(coalesce(f->'shopIds','[]'))>0 or jsonb_array_length(coalesce(f->'barberIds','[]'))>0 or jsonb_array_length(coalesce(f->'bookingStatuses','[]'))>0)then return false;end if;
 return true;
exception when others then return false;
end $$;
-- Scheduling survives creator logout, but not removal of their admin authority.
create function private.announcement_author_allowed(p_user uuid)returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=p_user and u.raw_app_meta_data->>'role'='admin'and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
 and exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified'and f.factor_type='totp'));
$$;
create or replace function private.announcement_audience(p_filters jsonb)returns table(account_id uuid,name text,email text,role text,device_count bigint,exclusion text)
language plpgsql stable security definer set search_path='' as $$
begin
 return query execute $audience$
 with activity as(
  select o.account_user_id,count(*) bookings,count(*)filter(where b.status='completed') completed,max(b.date)filter(where b.status='completed')last_visit
  from private.customer_booking_owners o join public.bookings b on b.id=o.booking_id
  where coalesce($1->>'noBookings','false')='true'or coalesce($1->>'minCompleted','')<>''or coalesce($1->>'maxCompleted','')<>''or coalesce($1->>'lastVisitBefore','')<>''
  group by o.account_user_id
 ),accounts as(
  select ca.user_id id,c.name,coalesce(u.email,'')email,u.raw_app_meta_data->>'role'role,c.status,
   u.deleted_at,u.banned_until,coalesce((select ap.enabled from private.announcement_preferences ap where ap.account_id=ca.user_id),false) opted_in
  from private.customer_accounts ca join public.customers c on c.id=ca.customer_id join auth.users u on u.id=ca.user_id left join activity act on act.account_user_id=ca.user_id
  where u.raw_app_meta_data->>'role'in('customer','manager','barber')
   and(coalesce(jsonb_array_length($1->'roles'),0)=0 or (u.raw_app_meta_data->>'role')in(select jsonb_array_elements_text($1->'roles')))
   and(coalesce(jsonb_array_length($1->'userIds'),0)=0 or ca.user_id in(select value::uuid from jsonb_array_elements_text($1->'userIds')))
   and not ca.user_id in(select value::uuid from jsonb_array_elements_text(coalesce($1->'excludeIds','[]')))
   and(coalesce($1->>'noBookings','false')<>'true'or coalesce(act.bookings,0)=0)
   and(coalesce($1->>'minCompleted','')=''or coalesce(act.completed,0)>=($1->>'minCompleted')::int)
   and(coalesce($1->>'maxCompleted','')=''or coalesce(act.completed,0)<=($1->>'maxCompleted')::int)
   and(coalesce($1->>'lastVisitBefore','')=''or act.last_visit<($1->>'lastVisitBefore')::date)
   and(coalesce($1->>'query','')=''or position(lower($1->>'query')in lower(c.name||' '||coalesce(u.email,'')||' '||coalesce(c.phone,'')))>0)
   and(not(coalesce($1->>'upcoming','false')='true'or coalesce($1->>'dateFrom','')<>''or coalesce($1->>'dateTo','')<>''
     or coalesce(jsonb_array_length($1->'shopIds'),0)>0 or coalesce($1->>'governorateId','')<>''or coalesce($1->>'city','')<>''or jsonb_array_length(coalesce($1->'barberIds','[]'))>0 or jsonb_array_length(coalesce($1->'bookingStatuses','[]'))>0)
    or exists(select 1 from private.customer_booking_owners o join public.bookings b on b.id=o.booking_id join public.branches s on s.id=b.branch_id
     where o.account_user_id=ca.user_id and b.status in(select jsonb_array_elements_text(case when jsonb_array_length(coalesce($1->'bookingStatuses','[]'))>0 then $1->'bookingStatuses'else '["pending","confirmed","completed"]'::jsonb end))
      and(jsonb_array_length(coalesce($1->'barberIds','[]'))=0 or b.barber_id in(select value::uuid from jsonb_array_elements_text($1->'barberIds')))
      and(coalesce($1->>'upcoming','false')<>'true'or(b.status in('pending','confirmed')and(b.date+b.time)at time zone'Asia/Kuwait'>now()))
      and(coalesce($1->>'dateFrom','')=''or b.date>=($1->>'dateFrom')::date)
      and(coalesce($1->>'dateTo','')=''or b.date<=($1->>'dateTo')::date)
      and(coalesce(jsonb_array_length($1->'shopIds'),0)=0 or s.id in(select value::uuid from jsonb_array_elements_text($1->'shopIds')))
      and(coalesce($1->>'governorateId','')=''or s.governorate_id=($1->>'governorateId')::integer)
      and(coalesce($1->>'city','')=''or s.city=$1->>'city')))
 ),device_counts as(select account_id,count(*)devices from private.announcement_eligible_devices group by account_id),
 counts as(select a.*,coalesce(d.devices,0)devices from accounts a left join device_counts d on d.account_id=a.id)
 select id,name::text,email::text,role,devices,case when deleted_at is not null or(banned_until is not null and banned_until>now())or status<>'active'then'account_inactive'
  when not opted_in then'opted_out'when devices=0 then'no_eligible_device'else null end from counts
$audience$ using p_filters;
end;
$$;

create or replace function private.announcement_summary(p_campaign uuid)returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'titleEn',c.title_en,'bodyEn',c.body_en,'titleAr',c.title_ar,'bodyAr',c.body_ar,'destination',c.destination,
  'createdBy',c.created_by,'createdByName',(select coalesce(u.raw_user_meta_data->>'name',u.email,'')from auth.users u where u.id=c.created_by),'state',c.state,'createdAt',c.created_at,'scheduledAt',c.scheduled_at,'confirmedAt',c.confirmed_at,'cancelledAt',c.cancelled_at,'queuedAt',c.queued_at,'previewExpiresAt',c.preview_expires_at,'expiresAt',c.expires_at,
  'matchedUsers',(select count(*)from private.announcement_targets t where t.campaign_id=c.id),
  'eligibleUsers',(select count(*)from private.announcement_targets t where t.campaign_id=c.id and t.exclusion is null),
  'excludedUsers',(select count(*)from private.announcement_targets t where t.campaign_id=c.id and t.exclusion is not null),
  'devices',(select count(*)from private.announcement_deliveries d where d.campaign_id=c.id),
  'results',(select coalesce(jsonb_object_agg(state,n),'{}')from(select state,count(*)n from private.announcement_deliveries d where d.campaign_id=c.id group by state)x))
 from private.announcement_campaigns c where c.id=p_campaign;
$$;

create or replace function private.announcement_delivery_allowed(p_id uuid)returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.announcement_deliveries j join private.announcement_targets t on t.id=j.target_id
  join private.announcement_campaigns c on c.id=j.campaign_id join private.customer_push_devices d on d.id=j.device_id
  join private.announcement_devices cap on cap.device_id=d.id and cap.binding=j.recipient_binding
  join private.announcement_preferences pref on pref.account_id=t.account_id
  left join private.customer_push_preferences master on master.account_id=t.account_id
  where j.id=p_id and c.state='queued'and c.expires_at>now()and private.announcement_author_allowed(c.created_by)and t.account_id=d.account_id
   and (case when c.guard_version=1 then d.registration_version=j.registration_version else cap.eligibility_epoch=j.eligibility_epoch end) and extensions.digest(d.token,'sha256')=j.token_hash
   and c.delivery_mode=(select mode from private.announcement_runtime where singleton)and coalesce((master.preference_enabled_since->>'enabled')::timestamptz,'-infinity'::timestamptz)<=c.created_at
   and coalesce((d.preference_enabled_since->>'enabled')::timestamptz,'-infinity'::timestamptz)<=c.created_at
   and pref.enabled_since<=c.created_at and private.announcement_device_allowed(d.id,t.account_id));
$$;


create or replace function private.admin_push_api(p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(p_data->>'user_id')::uuid;sid uuid:=(p_data->>'session_id')::uuid;campaign private.announcement_campaigns;filters jsonb;
 page integer:=coalesce((p_data->>'page')::integer,1);rows jsonb;total bigint;runtime private.announcement_runtime;scheduled timestamptz;preset private.announcement_saved_audiences;
begin
 perform private.require_announcement_admin(actor,sid);
 if page not between 1 and 10000 or length(coalesce(p_data->>'query',''))>120 then raise exception 'INVALID_REQUEST';end if;
 select * into runtime from private.announcement_runtime where singleton;
 if p_action='audiences'then
  select count(*)into total from private.announcement_saved_audiences where created_by=actor;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select a.id,a.name,a.filters from private.announcement_saved_audiences a where a.created_by=actor order by a.created_at desc,a.id limit 25 offset(page-1)*25)x;
  return jsonb_build_object('audiences',rows,'total',total,'page',page,'pageSize',25);
 elsif p_action='saveAudience'then
  filters:=p_data->'filters';
  if not private.announcement_filters_valid(filters)or filters?'userIds'or filters?'excludeIds'or length(btrim(coalesce(p_data->>'name','')))not between 1 and 80 then raise exception 'INVALID_REQUEST';end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,719));
  if(select count(*)from private.announcement_saved_audiences where created_by=actor)>=100 then raise exception 'SAVED_AUDIENCE_LIMIT';end if;
  begin
   insert into private.announcement_saved_audiences(created_by,name,filters)values(actor,btrim(p_data->>'name'),filters)returning * into preset;
  exception when unique_violation then raise exception 'AUDIENCE_NAME_EXISTS';end;
  return jsonb_build_object('id',preset.id,'name',preset.name,'filters',preset.filters);
 elsif p_action='deleteAudience'then
  delete from private.announcement_saved_audiences where id=(p_data->>'audienceId')::uuid and created_by=actor returning * into preset;
  if not found then raise exception 'NOT_FOUND';end if;
  return jsonb_build_object('deleted',true);
 elsif p_action='barbers'then
  select count(*)into total from public.barbers b where(coalesce(p_data->>'query','')=''or position(lower(p_data->>'query')in lower(b.name))>0);
  select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select b.id,b.name,b.branch_id as "shopId",s.name as "shopName"from public.barbers b left join public.branches s on s.id=b.branch_id where coalesce(p_data->>'query','')=''or position(lower(p_data->>'query')in lower(b.name))>0 order by b.name,b.id limit 25 offset(page-1)*25)x;
  return jsonb_build_object('barbers',rows,'total',total,'page',page,'pageSize',25);
 elsif p_action='options'then
  return jsonb_build_object('governorates',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'nameEn',name_en,'nameAr',name_ar)order by id),'[]')from public.governorates),
   'cities',(select coalesce(jsonb_agg(jsonb_build_object('city',city,'governorateId',governorate_id)order by city),'[]')from(select distinct city,governorate_id from public.branches where city is not null)x),
   'shops',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'nameAr',name_ar,'city',city,'governorateId',governorate_id)order by name,id),'[]')from(select id,name,name_ar,city,governorate_id from public.branches where coalesce(p_data->>'query','')=''or position(lower(p_data->>'query')in lower(name||' '||coalesce(name_ar,'')||' '||coalesce(city,'')))>0 order by name,id limit 25 offset(page-1)*25)x),
   'shopTotal',(select count(*)from public.branches where coalesce(p_data->>'query','')=''or position(lower(p_data->>'query')in lower(name||' '||coalesce(name_ar,'')||' '||coalesce(city,'')))>0),
   'delivery',jsonb_build_object('enabled',runtime.enabled,'mode',runtime.mode));
 elsif p_action in('users','preview')then
  filters:=coalesce(p_data->'filters','{}');
  if not private.announcement_filters_valid(filters)then raise exception 'INVALID_REQUEST';end if;
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
  if coalesce(p_data->>'scheduledAt','')<>''then
   begin scheduled:=(p_data->>'scheduledAt')::timestamptz;exception when others then raise exception 'INVALID_SCHEDULE';end;
   if p_data->>'scheduledAt'!~'([zZ]|[+-][0-9]{2}:[0-9]{2})$'or scheduled<clock_timestamp()+interval '1 minute'or scheduled>clock_timestamp()+interval '365 days'then raise exception 'INVALID_SCHEDULE';end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,718));
  if(select count(*)from private.announcement_campaigns where created_by=actor and created_at>now()-interval '1 hour')>=60 then raise exception 'RATE_LIMITED';end if;
  if(select count(*)from private.announcement_audience(filters))>50000 then raise exception 'AUDIENCE_TOO_LARGE';end if;
  insert into private.announcement_campaigns(created_by,created_session,title_en,body_en,title_ar,body_ar,destination,filters,delivery_mode,scheduled_at,expires_at)
   values(actor,sid,btrim(p_data->>'titleEn'),btrim(p_data->>'bodyEn'),btrim(coalesce(p_data->>'titleAr','')),btrim(coalesce(p_data->>'bodyAr','')),coalesce(p_data->>'destination','none'),filters,runtime.mode,scheduled,coalesce(scheduled,clock_timestamp())+interval '24 hours')returning * into campaign;
  insert into private.announcement_targets(campaign_id,account_id,exclusion)select campaign.id,a.account_id,a.exclusion from private.announcement_audience(filters)a;
  insert into private.announcement_deliveries(campaign_id,target_id,device_id,registration_version,token_hash,recipient_binding,eligibility_epoch)
   select campaign.id,t.id,d.id,d.registration_version,extensions.digest(d.token,'sha256'),cap.binding,cap.eligibility_epoch from private.announcement_targets t
   join private.announcement_eligible_devices d on d.account_id=t.account_id join private.announcement_devices cap on cap.device_id=d.id where t.campaign_id=campaign.id and t.exclusion is null;
  return jsonb_build_object('campaign',private.announcement_summary(campaign.id),'delivery',jsonb_build_object('enabled',runtime.enabled,'mode',runtime.mode));
 elsif p_action='send'then
  select * into campaign from private.announcement_campaigns where id=(p_data->>'campaignId')::uuid for update;
  if not found or campaign.created_by is distinct from actor or campaign.created_session is distinct from sid then raise exception 'FORBIDDEN';end if;
  if campaign.state in('queued','scheduled')then return jsonb_build_object('campaign',private.announcement_summary(campaign.id));end if;
  if campaign.state<>'preview'then raise exception 'INVALID_REQUEST';end if;
  if not runtime.enabled then raise exception 'DELIVERY_DISABLED';end if;
  if campaign.delivery_mode is distinct from runtime.mode then raise exception 'PREVIEW_EXPIRED';end if;
  if campaign.preview_expires_at<=clock_timestamp()then raise exception 'PREVIEW_EXPIRED';end if;
  if not exists(select 1 from private.announcement_deliveries where campaign_id=campaign.id)then raise exception 'NO_RECIPIENTS';end if;
  if p_data->'confirmed'is distinct from 'true'::jsonb then raise exception 'CONFIRMATION_REQUIRED';end if;
  if campaign.scheduled_at is not null and campaign.scheduled_at<=clock_timestamp()then raise exception 'INVALID_SCHEDULE';end if;
  update private.announcement_campaigns set state=case when scheduled_at is null then'queued'else'scheduled'end,
   confirmed_at=clock_timestamp(),queued_at=case when scheduled_at is null then clock_timestamp()else null end,
   expires_at=coalesce(scheduled_at,clock_timestamp())+interval '24 hours'where id=campaign.id;
  perform private.kick_admin_push();return jsonb_build_object('campaign',private.announcement_summary(campaign.id));
 elsif p_action='cancel'then
  if p_data->'confirmed'is distinct from'true'::jsonb then raise exception 'CONFIRMATION_REQUIRED';end if;
  select * into campaign from private.announcement_campaigns where id=(p_data->>'campaignId')::uuid for update;
  if not found or campaign.state='preview'then raise exception 'NOT_FOUND';end if;
  if campaign.state='queued'and not exists(select 1 from private.announcement_deliveries where campaign_id=campaign.id and state in('pending','sending'))then raise exception 'ALREADY_FINISHED';end if;
  update private.announcement_campaigns set state='cancelled',cancelled_at=coalesce(cancelled_at,clock_timestamp()),cancelled_by=coalesce(cancelled_by,actor)where id=campaign.id;
  update private.announcement_deliveries set state='cancelled',last_error='CancelledByAdmin',finished_at=clock_timestamp()where campaign_id=campaign.id and state='pending';
  return jsonb_build_object('campaign',private.announcement_summary(campaign.id));
 elsif p_action='duplicate'then
  select * into campaign from private.announcement_campaigns where id=(p_data->>'campaignId')::uuid and state<>'preview';
  if not found then raise exception 'NOT_FOUND';end if;
  return jsonb_build_object('draft',jsonb_build_object('titleEn',campaign.title_en,'bodyEn',campaign.body_en,'titleAr',campaign.title_ar,'bodyAr',campaign.body_ar,'destination',campaign.destination,'filters',campaign.filters),
   'users',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(c.name,u.email,''),'email',u.email)),'[]')from auth.users u left join private.customer_accounts ca on ca.user_id=u.id left join public.customers c on c.id=ca.customer_id where u.id in(select value::uuid from jsonb_array_elements_text(coalesce(campaign.filters->'userIds','[]'))union select value::uuid from jsonb_array_elements_text(coalesce(campaign.filters->'excludeIds','[]')))));
 elsif p_action='history'then
  select count(*)into total from private.announcement_campaigns where state in('scheduled','queued','cancelled');
  select coalesce(jsonb_agg(private.announcement_summary(x.id)),'[]')into rows from(select id from private.announcement_campaigns where state in('scheduled','queued','cancelled')order by created_at desc,id desc limit 25 offset(page-1)*25)x;
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
  update private.announcement_campaigns set state='queued',queued_at=clock_timestamp()where state='scheduled'and scheduled_at<=clock_timestamp();
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
  perform 1 from private.announcement_campaigns where id=(select campaign_id from private.announcement_deliveries where id=(p_data->>'id')::uuid)for update;
  select * into saved_delivery from private.announcement_deliveries where id=(p_data->>'id')::uuid and lease_id=(p_data->>'lease')::uuid and state='sending'for update;
  if not found then return 'false'::jsonb;end if;
  status:=(p_data->>'status')::integer;reason:=left(coalesce(p_data->>'reason',''),80);
  if reason='NoLongerEligible'then update private.announcement_deliveries set state='skipped',last_error=reason,finished_at=clock_timestamp(),leased_until=null where id=saved_delivery.id;
  elsif status=200 then update private.announcement_deliveries set state=case when saved_delivery.delivery_mode='capture'then'captured'else'accepted'end,provider_status=status,provider_id=left(p_data->>'providerId',100),finished_at=clock_timestamp(),leased_until=null where id=saved_delivery.id;
  elsif status in(429,500,503)and exists(select 1 from private.announcement_campaigns where id=saved_delivery.campaign_id and state='cancelled')then
   update private.announcement_deliveries set state='cancelled',last_error='CancelledByAdmin',finished_at=clock_timestamp(),leased_until=null where id=saved_delivery.id;
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


-- Private routines are service-only even where default function privileges differ.
revoke all on function private.announcement_device_epoch(),private.announcement_filters_valid(jsonb),private.announcement_author_allowed(uuid) from public,anon,authenticated;
grant execute on function private.announcement_filters_valid(jsonb),private.announcement_author_allowed(uuid) to service_role;
notify pgrst,'reload schema';
commit;
