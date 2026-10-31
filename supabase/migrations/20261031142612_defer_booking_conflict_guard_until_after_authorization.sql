-- RLS and ordinary row validation must reject unauthorized writes before a
-- privileged schedule check can reveal whether an appointment/barber exists.
-- AFTER triggers still run in the writing transaction: a conflict rolls back
-- the entire statement, its side effects and its per-barber serialization row.
drop trigger guard_bookings_against_new_overlaps on public.bookings;
create trigger guard_bookings_against_new_overlaps
after insert or update of barber_id, date, time, duration, status on public.bookings
for each row execute function private.guard_booking_schedule();
