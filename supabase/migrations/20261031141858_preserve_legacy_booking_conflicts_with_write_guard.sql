-- Preserve existing appointments, including historical overlaps. New active
-- reservations and schedule changes must still be checked against every row.
create table private.booking_write_locks (
  barber_id uuid primary key references public.barbers(id) on delete cascade,
  revision bigint not null default 1
);
alter table private.booking_write_locks owner to postgres;
alter table private.booking_write_locks enable row level security;
revoke all on private.booking_write_locks from public, anon, authenticated;

create function private.guard_booking_schedule() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('cancelled', 'no_show') then return new; end if;
  if tg_op = 'UPDATE' then
    if old.status not in ('cancelled', 'no_show')
      and row(new.barber_id, new.date, new.time, new.duration)
        is not distinct from row(old.barber_id, old.date, old.time, old.duration)
    then return new; end if;
  end if;

  -- A real row update serializes writers and rejects stale repeatable-read
  -- snapshots. It contains no customer details and is inaccessible to clients.
  insert into private.booking_write_locks as guard (barber_id)
    values (new.barber_id)
    on conflict (barber_id) do update set revision = guard.revision + 1;
  if exists (
    select 1 from public.bookings b
    where b.id is distinct from new.id and b.barber_id = new.barber_id
      and b.status not in ('cancelled', 'no_show')
      and tsrange(b.date + b.time, b.date + b.time + b.duration * interval '1 minute', '[)')
        && tsrange(new.date + new.time, new.date + new.time + new.duration * interval '1 minute', '[)')
  ) then
    raise exception 'Booking conflict: appointment overlaps an existing reservation'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;
alter function private.guard_booking_schedule() owner to postgres;
revoke all on function private.guard_booking_schedule() from public, anon, authenticated, service_role;

create trigger guard_bookings_against_new_overlaps
before insert or update of barber_id, date, time, duration, status on public.bookings
for each row execute function private.guard_booking_schedule();

-- Supersede the older non-serialized checks, including status reactivation.
drop trigger prevent_booking_conflicts_insert on public.bookings;
drop trigger prevent_booking_conflicts_update on public.bookings;

-- The write guard protects staff and customer writes while allowing legacy
-- records to remain unchanged. Install it before retiring the stricter index.
alter table public.bookings drop constraint if exists bookings_no_overlapping_appointments;

-- Retain the range lookup index without requiring legacy rows to be disjoint.
create index bookings_active_schedule_gist on public.bookings using gist (
  barber_id,
  tsrange(date + time, date + time + duration * interval '1 minute', '[)')
) where (status not in ('cancelled', 'no_show'));
