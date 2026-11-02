-- Staff deliberately select a canonical customer ID. Grant that account access
-- to the new appointment; guest phone matches never perform this association.
begin;
create function private.link_staff_customer_booking_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'authenticated'
    or coalesce(auth.jwt()->'app_metadata'->>'role','') not in ('admin','manager','barber','agent') then return null; end if;
  insert into private.customer_booking_owners(booking_id,account_user_id)
    select new.id,a.user_id from private.customer_accounts a join auth.users u on u.id=a.user_id
    join public.customers c on c.id=a.customer_id
    where a.customer_id=new.customer_id and c.status='active'
      and u.raw_app_meta_data->>'role'='customer' and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
    on conflict(booking_id) do nothing;
  return null;
end;
$$;
revoke all on function private.link_staff_customer_booking_owner() from public,anon,authenticated,service_role;
create trigger link_staff_customer_booking_owner after insert on public.bookings for each row execute function private.link_staff_customer_booking_owner();
commit;
