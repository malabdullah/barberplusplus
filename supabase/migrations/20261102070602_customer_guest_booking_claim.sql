-- Receipt possession is checked in the gateway before this service-only RPC.
-- The live account must reference the same canonical customer as the booking.
-- Do not infer ownership of any other appointment, or change contact details.
create function public.customer_claim_booking(p_booking uuid, p_account uuid, p_session uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.bookings where id=p_booking for update;
  if not found then raise exception 'INVALID_REQUEST'; end if;
  perform private.record_customer_booking_owner(p_booking,p_account,p_session);
  return jsonb_build_object('saved',true);
end;
$$;
revoke all on function public.customer_claim_booking(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.customer_claim_booking(uuid,uuid,uuid) to service_role;
