begin;
-- Parameter-aware planning avoids a costly generic plan for optional filters.
-- Query text is fixed; customer input is bound as JSONB, never interpolated.
create or replace function private.announcement_audience(p_filters jsonb)returns table(account_id uuid,name text,email text,role text,device_count bigint,exclusion text)
language plpgsql stable security definer set search_path='' as $$
begin
 return query execute $audience$
 with accounts as(
  select ca.user_id id,c.name,coalesce(u.email,'')email,u.raw_app_meta_data->>'role'role,c.status,
   u.deleted_at,u.banned_until,coalesce((select ap.enabled from private.announcement_preferences ap where ap.account_id=ca.user_id),false) opted_in
  from private.customer_accounts ca join public.customers c on c.id=ca.customer_id join auth.users u on u.id=ca.user_id
  where u.raw_app_meta_data->>'role'in('customer','manager','barber')
   and(coalesce(jsonb_array_length($1->'roles'),0)=0 or (u.raw_app_meta_data->>'role')in(select jsonb_array_elements_text($1->'roles')))
   and(coalesce(jsonb_array_length($1->'userIds'),0)=0 or ca.user_id in(select value::uuid from jsonb_array_elements_text($1->'userIds')))
   and not ca.user_id in(select value::uuid from jsonb_array_elements_text(coalesce($1->'excludeIds','[]')))
   and(coalesce($1->>'query','')=''or position(lower($1->>'query')in lower(c.name||' '||coalesce(u.email,'')||' '||coalesce(c.phone,'')))>0)
   and(not(coalesce($1->>'upcoming','false')='true'or coalesce($1->>'dateFrom','')<>''or coalesce($1->>'dateTo','')<>''
     or coalesce(jsonb_array_length($1->'shopIds'),0)>0 or coalesce($1->>'governorateId','')<>''or coalesce($1->>'city','')<>'')
    or exists(select 1 from private.customer_booking_owners o join public.bookings b on b.id=o.booking_id join public.branches s on s.id=b.branch_id
     where o.account_user_id=ca.user_id and b.status in('pending','confirmed','completed')
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

commit;
