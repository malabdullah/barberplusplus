begin;
-- Keep cancellation history independent of the appointment's future start date.
-- Additive metadata only: existing ownership, policies and push preferences remain.
alter table public.bookings add column if not exists cancelled_at timestamptz;

-- Existing rows are not rewritten (and old notifications are not re-enqueued).
-- Read projections use the best previously recorded timestamp for legacy rows.
create or replace function private.stamp_booking_cancellation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status='cancelled' then
    if tg_op='INSERT' then new.cancelled_at:=clock_timestamp();
    elsif old.status is distinct from 'cancelled' then new.cancelled_at:=clock_timestamp();
    else new.cancelled_at:=old.cancelled_at;
    end if;
  else new.cancelled_at:=null;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_booking_cancellation() from public,anon,authenticated,service_role;
do $trigger$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.bookings'::regclass and tgname='stamp_booking_cancellation') then
  create trigger stamp_booking_cancellation before insert or update on public.bookings
for each row execute function private.stamp_booking_cancellation();
 end if;
end $trigger$;

-- Patch only the public response projections in the currently installed
-- routines. In particular, retain newer password guards and preference cutoffs.
do $$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('public.customer_account_api(text,jsonb)'::regprocedure);
  needle:=$target$'staff_cancellation', case$target$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected customer history projection'; end if;
  if position('cancelled_at' in definition)=0 then execute replace(definition,needle,$target$'cancelled_at',case when b.status='cancelled' then coalesce(b.cancelled_at,
          case when b.staff_cancellation->>'at' ~ '^\d{4}-\d{2}-\d{2}T' then (b.staff_cancellation->>'at')::timestamptz end,b.updated_at,b.created_at) end,
        'staff_cancellation', case$target$);end if;

  definition:=pg_get_functiondef('private.customer_appointment_api(text,jsonb)'::regprocedure);
  needle:=$target$'status',target.status,$target$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>3 then raise exception 'Unexpected appointment-change projection'; end if;
  if position('cancelled_at' in definition)=0 then execute replace(definition,needle,$target$'status',target.status,'cancelled_at',target.cancelled_at,$target$);end if;

end;
$$;

commit;
