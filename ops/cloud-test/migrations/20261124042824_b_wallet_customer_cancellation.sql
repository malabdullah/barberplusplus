begin;

-- Cancelling under a customer JWT would invoke the staff-cancellation guard.
-- Only the existing authenticated customer Edge handler can use this entry.
create function public.b_wallet_cancel_service(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout='12s' as $$
declare person uuid; booking uuid; a upayments_test.booking_attempts%rowtype;
  appointment public.bookings%rowtype; destination text;
begin
  person:=private.b_wallet_member((p_data->>'user_id')::uuid,(p_data->>'session_id')::uuid);
  booking:=(p_data->>'booking_id')::uuid;
  if person is null or booking is null or not exists(select 1 from private.b_wallet_settings where enabled) then
    raise exception 'WALLET_FORBIDDEN' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(booking::text,0));
  select * into a from upayments_test.booking_attempts where id=booking and wallet_id is not null for update;
  select * into appointment from public.bookings where id=booking and customer_id=person for update;
  if not found or a.state is distinct from 'paid' then raise exception 'BOOKING_NOT_MANAGEABLE'; end if;
  destination:=p_data->>'destination';
  if destination is null or destination not in ('gateway','wallet') or (a.wallet_fils>0 and destination<>'wallet') then
    raise exception 'WALLET_INVALID';
  end if;
  update upayments_test.booking_attempts set wallet_refund_preference=destination
    where id=booking and refund_state is null and appointment.status<>'cancelled';
  return private.customer_appointment_api('cancel-booking',p_data);
end
$$;
revoke all on function public.b_wallet_cancel_service(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.b_wallet_cancel_service(jsonb) to service_role;

create or replace function b_wallet_api.booking(p_action text,p_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout='12s' as $$
declare person uuid:=private.b_wallet_customer(); appointment public.bookings%rowtype;
  a upayments_test.booking_attempts%rowtype;
begin
  if p_action is distinct from 'view' or person is null or p_id is null
    or not exists(select 1 from private.b_wallet_settings where enabled) then
    raise exception 'WALLET_FORBIDDEN' using errcode='42501';
  end if;
  select * into appointment from public.bookings where id=p_id and customer_id=person;
  if not found then return null; end if;
  select * into a from upayments_test.booking_attempts where id=p_id and wallet_id is not null;
  return jsonb_build_object('state',case when appointment.status='cancelled'
      and appointment.online_payment_state is distinct from 'expired' then 'cancelled' else appointment.online_payment_state end,
    'payBy',appointment.online_payment_due_at,'totalFils',round(appointment.price*1000)::bigint::text,
    'refundState',a.refund_state,'refundChoice',a.state='paid' and a.wallet_fils=0,'refundToWallet',a.state='paid' and a.wallet_fils>0);
end
$$;

create or replace function private.b_wallet_customer() returns uuid
language sql stable set search_path = '' as $$
  select private.b_wallet_member(auth.uid(),nullif(auth.jwt()->>'session_id','')::uuid)
  where public.staff_factor_satisfied()
$$;
notify pgrst,'reload schema';
commit;
