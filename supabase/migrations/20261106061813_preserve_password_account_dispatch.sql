-- Keep the booking/rating/appointment dispatcher intact; only retire the
-- ordinary-session email password-reset guard.
create or replace function public.customer_account_api(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if p_action='email-reset-guard' then raise exception 'PASSWORD_PROOF_REQUIRED'; end if;
  return (
select case
    when p_action='bookings' then coalesce((
      select jsonb_agg(item || jsonb_build_object(
        'location_url',br.location_url, 'shop_address',br.address,
        'cancellation_cutoff', case when item->>'status' in ('confirmed','pending')
          then ((b.date+b.time) at time zone 'Asia/Kuwait')-make_interval(mins=>b.cancel_notice_minutes) end,
        'reschedule_cutoff', case when item->>'status' in ('confirmed','pending')
          then ((b.date+b.time) at time zone 'Asia/Kuwait')-make_interval(mins=>b.reschedule_notice_minutes) end,
        'staff_cancellation', case when item->>'status'='cancelled' and b.staff_cancellation is not null
          then b.staff_cancellation - 'user_id' end
      ) order by ordinal)
      from jsonb_array_elements(private.customer_booking_ratings_api(p_action,p_data)) with ordinality as history(item,ordinal)
      join public.bookings b on b.id=(item->>'id')::uuid
      left join public.branches br on br.id=(item->>'branch_id')::uuid
    ),'[]'::jsonb)
    when p_action='rate-booking' then private.customer_booking_ratings_api(p_action,p_data)
    when p_action in ('appointment-slots','reschedule-booking','cancel-booking') then private.customer_appointment_api(p_action,p_data)
    else private.customer_account_api(p_action,p_data)
  end
  );
end;
$$;
revoke all on function public.customer_account_api(text,jsonb) from public,anon,authenticated;
grant execute on function public.customer_account_api(text,jsonb) to service_role;
notify pgrst,'reload schema';
