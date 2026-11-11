begin;
-- A sending/booking service must not receive SELECT access to all Auth users.
-- Return only the receipt-bound equality needed after the live-session guard.
create function private.guest_booking_email_matches(p_customer uuid,p_account uuid)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join public.customers c on c.id=p_customer
  where u.id=p_account and u.email_confirmed_at is not null and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=now())
   and u.raw_app_meta_data->>'role' in ('customer','manager','barber')
   and c.status='active' and lower(u.email)=lower(c.email));
$$;
revoke all on function private.guest_booking_email_matches(uuid,uuid)from public,anon,authenticated;
grant execute on function private.guest_booking_email_matches(uuid,uuid)to service_role;
create or replace function public.customer_claim_booking(p_booking uuid,p_account uuid,p_session uuid) returns jsonb
language plpgsql set search_path='' as $$
declare profile uuid; old_profile uuid;
begin
 select customer_id into old_profile from public.bookings where id=p_booking for update;
 if not found then raise exception 'INVALID_REQUEST';end if;
 if exists(select 1 from private.customer_booking_email_context where booking_id=p_booking and guest) then
  profile:=private.resolve_booking_customer(p_account,p_session);
  if not private.guest_booking_email_matches(old_profile,p_account)
    or exists(select 1 from private.customer_booking_owners where booking_id=p_booking and account_user_id<>p_account)
    then raise exception 'INVALID_REQUEST';end if;
  update public.bookings set customer_id=profile where id=p_booking and customer_id is distinct from profile;
 end if;
 perform private.record_customer_booking_owner(p_booking,p_account,p_session);
 return jsonb_build_object('saved',true);
end $$;
revoke all on function public.customer_claim_booking(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.customer_claim_booking(uuid,uuid,uuid)to service_role;
commit;
