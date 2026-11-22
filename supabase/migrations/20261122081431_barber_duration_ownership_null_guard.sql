create or replace function public.set_barber_service_duration(p_barber uuid,p_service uuid,p_duration integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.barbers%rowtype;actor text:=private.live_staff_role();
begin
 select * into b from public.barbers where id=p_barber for update;
 if actor is null or b.id is null or not coalesce((actor='manager' and exists(select 1 from public.branches where id=b.branch_id and manager_id=auth.uid()) or actor='barber' and b.user_id=auth.uid() and not b.manager_chair),false) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if p_service is null or not coalesce(p_service=any(b.service_ids),false) or not exists(select 1 from public.services where id=p_service and branch_id=b.branch_id and status='active') then raise exception 'INVALID_SERVICE_ASSIGNMENT';end if;
 if p_duration is not null and p_duration not between 5 and 480 then raise exception 'INVALID_SERVICE_DURATION';end if;
 update public.barbers set service_durations=case when p_duration is null then service_durations-p_service::text else jsonb_set(service_durations,array[p_service::text],to_jsonb(p_duration)) end where id=b.id returning * into b;
 return b.service_durations;
end $$;

create or replace function private.guard_service_durations() returns trigger language plpgsql security definer set search_path='' as $$
declare item record; actor text:=private.live_staff_role();
begin
 if tg_op='UPDATE' and new.service_ids is distinct from old.service_ids and actor='barber' then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if tg_op='UPDATE' and new.service_durations=old.service_durations and new.service_ids=old.service_ids then return new;end if;
 if jsonb_typeof(new.service_durations)<>'object' then raise exception 'INVALID_SERVICE_DURATION';end if;
 -- Remove overrides when a manager unassigns a service.
 if tg_op='UPDATE' and new.service_ids is distinct from old.service_ids then
  select coalesce(jsonb_object_agg(key,value),'{}') into new.service_durations from jsonb_each(new.service_durations) where key=any(array(select x::text from unnest(new.service_ids)x));
 end if;
 for item in select * from jsonb_each(new.service_durations) loop
  if not coalesce(item.key=any(array(select x::text from unnest(new.service_ids)x)),false) or jsonb_typeof(item.value)<>'number' or item.value::text !~ '^[0-9]+$' then raise exception 'INVALID_SERVICE_DURATION';end if;
  if (item.value::text)::numeric not between 5 and 480 then raise exception 'INVALID_SERVICE_DURATION';end if;
 end loop;
 if auth.uid() is not null and not coalesce((actor in ('admin','agent') or actor='manager' and exists(select 1 from public.branches where id=new.branch_id and manager_id=auth.uid()) or actor='barber' and new.user_id=auth.uid() and not new.manager_chair),false) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 return new;
end $$;
