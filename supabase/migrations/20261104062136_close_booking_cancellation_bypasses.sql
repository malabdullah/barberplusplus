begin;

drop policy "Managers can delete bookings in own branches" on public.bookings;

create function private.guard_booking_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  kuwait_now timestamp;
begin
  if tg_op='DELETE' then
    -- A cascading delete through a barber or branch must preserve history too.
    if auth.uid() is not null and not exists (
      select 1 from auth.users u where u.id=auth.uid() and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=now())
        and u.raw_app_meta_data->>'role'='admin'
    ) then
      raise exception 'BOOKING_DELETE_FORBIDDEN' using errcode='42501';
    end if;
    return old;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  kuwait_now := clock_timestamp() at time zone 'Asia/Kuwait';
  if new.status='no_show' then
    if tg_op='INSERT' then
      if new.date + new.time > kuwait_now then
        raise exception 'BOOKING_NO_SHOW_BEFORE_START';
      end if;
    elsif (old.status is distinct from 'no_show' or row(new.date,new.time) is distinct from row(old.date,old.time))
      and greatest(old.date + old.time, new.date + new.time) > kuwait_now then
      raise exception 'BOOKING_NO_SHOW_BEFORE_START';
    end if;
  end if;

  if tg_op='UPDATE' and old.date + old.time > kuwait_now and new.date + new.time <= kuwait_now then
    raise exception 'BOOKING_CANNOT_BE_BACKDATED';
  end if;

  return new;
end
$$;

revoke all on function private.guard_booking_history() from public,anon,authenticated,service_role;

create trigger guard_booking_history before insert or update or delete on public.bookings
for each row execute function private.guard_booking_history();

commit;
