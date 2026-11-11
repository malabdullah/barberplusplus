begin;
-- Join eligible devices before aggregation, so activity-filter plans cannot rescan a full device-count aggregate for each account.
create or replace function private.announcement_audience(p_filters jsonb)returns table(account_id uuid,name text,email text,role text,device_count bigint,exclusion text)
language plpgsql stable security definer set search_path='' as $$
begin
 return query execute $audience$
 with activity as materialized(
  select o.account_user_id,count(*) bookings,count(*)filter(where b.status='completed') completed,max(b.date)filter(where b.status='completed')last_visit
  from private.customer_booking_owners o join public.bookings b on b.id=o.booking_id
  where coalesce($1->>'noBookings','false')='true'or coalesce($1->>'minCompleted','')<>''or coalesce($1->>'maxCompleted','')<>''or coalesce($1->>'lastVisitBefore','')<>''
  group by o.account_user_id
 ),accounts as materialized(
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
 ),counts as(
  select a.*,count(d.id)devices from accounts a left join private.announcement_eligible_devices d on d.account_id=a.id
  group by a.id,a.name,a.email,a.role,a.status,a.deleted_at,a.banned_until,a.opted_in
 )
 select id,name::text,email::text,role,devices,case when deleted_at is not null or(banned_until is not null and banned_until>now())or status<>'active'then'account_inactive'
  when not opted_in then'opted_out'when devices=0 then'no_eligible_device'else null end from counts
$audience$ using p_filters;
end;
$$;

commit;
