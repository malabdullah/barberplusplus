-- Add actionable publishing reasons without relaxing readiness or permissions.
begin;
create or replace function private.shop_publication_readiness(p_shop public.branches) returns jsonb
language sql stable security definer set search_path='' as $$
 with ready_services as (
  select s.* from public.services s where s.branch_id=p_shop.id and s.status='active'
    and length(trim(s.name))>0 and s.duration between 5 and 480 and s.price between 0 and 10000
 ), ready_barbers as (
  select b.id from public.barbers b left join auth.users u on u.id=b.user_id
  where b.branch_id=p_shop.id and b.status='active' and b.availability_approved_at is not null
    and (b.management_mode='managed' and b.user_id is null and not b.manager_chair
     or b.management_mode='account' and (b.invite_status is null or b.invite_status='accepted' or b.manager_chair)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
      and (b.manager_chair and u.id=p_shop.manager_id and u.raw_app_meta_data->>'role'='manager' or not b.manager_chair and u.raw_app_meta_data->>'role'='barber'))
    and exists(select 1 from ready_services s cross join lateral jsonb_each(b.availability) h(day,hours)
      where s.id=any(b.service_ids) and h.day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
        and h.hours->>'enabled'='true'
        and h.hours->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and h.hours->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and p_shop.working_hours->h.day->>'open' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and p_shop.working_hours->h.day->>'close' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and least(h.hours->>'end',p_shop.working_hours->h.day->>'close')::time
          - greatest(h.hours->>'start',p_shop.working_hours->h.day->>'open')::time >= make_interval(mins=>private.service_duration(b.id,s.id,s.duration)))
 )
 select jsonb_build_object('ready',p_shop.status='active' and length(trim(p_shop.name))>0
   and p_shop.governorate_id is not null and p_shop.area_id is not null
   and exists(select 1 from public.areas a where a.id=p_shop.area_id and a.governorate_id=p_shop.governorate_id)
   and private.valid_schedule(p_shop.working_hours,false) and exists(select 1 from ready_barbers),
   'ready_barbers',(select count(*) from ready_barbers),
   'blockers',to_jsonb(array_remove(array[
     case when p_shop.status is distinct from 'active' then 'inactive' end,
     case when coalesce(length(trim(p_shop.name)),0)=0 then 'shop_details' end,
     case when not exists(select 1 from public.areas a where a.id=p_shop.area_id and a.governorate_id=p_shop.governorate_id) then 'location' end,
     case when private.valid_schedule(p_shop.working_hours,false) is not true then 'shop_hours' end,
     case when not exists(select 1 from ready_services) then 'services' end,
     case when exists(select 1 from ready_services) and not exists(select 1 from ready_barbers) then 'barber' end
   ]::text[],null)));

$$;


notify pgrst,'reload schema';
commit;
