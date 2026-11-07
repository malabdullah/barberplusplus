begin;
create or replace function public.staff_customer_lookup(p_country_code text,p_phone text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text:=private.live_staff_role(); result jsonb;
begin
 if role_name is null then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if (select count(*) from public.logs where user_id=auth.uid() and action='customer_lookup' and created_at>now()-interval '1 minute')>=30 then raise exception 'RATE_LIMITED'; end if;
 result:=private.staff_contact(p_country_code,p_phone,null);
 insert into public.logs(user_id,user_role,level,log_type,action,entity_type,message)
 values(auth.uid(),role_name,'info','action','customer_lookup','customer','Exact contact lookup');
 return result;
end $$;

create function private.valid_time_off(p_data jsonb,p_vacation boolean default false) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; start_day date; end_day date;
begin
 if p_data is null then return true; end if;
 if jsonb_typeof(p_data)<>'array' or jsonb_array_length(p_data)>200 then return false; end if;
 for item in select value from jsonb_array_elements(p_data) loop
  if jsonb_typeof(item)<>'object' or length(coalesce(item->>'reason',''))>300 then return false; end if;
  if p_vacation then
   if item->>'startDate' is null or item->>'endDate' is null then return false; end if;
   start_day:=(item->>'startDate')::date;end_day:=(item->>'endDate')::date;
   if start_day>end_day then return false; end if;
  else
   if item->>'type' is null or item->>'type' not in ('one-time','recurring') or item->>'start' is null or item->>'end' is null
    or item->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or item->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or item->>'start'>=item->>'end' then return false; end if;
   if item->>'type'='recurring' then
    if item->>'day' is null or item->>'day' not in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday') then return false; end if;
   else
    if item->>'date' is null then return false; end if;start_day:=(item->>'date')::date;
   end if;
  end if;
 end loop; return true;
exception when others then return false;
end $$;
revoke all on function private.valid_time_off(jsonb,boolean) from public,anon,authenticated,service_role;
create function private.guard_time_off() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not private.valid_time_off(new.time_offs,false) or not private.valid_time_off(new.vacations,true)
  or new.max_booking_days is null or new.max_booking_days not between 1 and 365 then raise exception 'INVALID_BARBER_HOURS'; end if;
 return new;
end $$;
revoke all on function private.guard_time_off() from public,anon,authenticated,service_role;
create trigger validate_barber_time_off before insert or update on public.barbers for each row execute function private.guard_time_off();
commit;
