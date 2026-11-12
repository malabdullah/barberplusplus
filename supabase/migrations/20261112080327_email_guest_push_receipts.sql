begin;
-- Signed email receipts grant one device/booking subscription, never account access.
do $patch$
declare definition text:=pg_get_functiondef('public.customer_push_api(text,jsonb)'::regprocedure);updated text;
begin
 updated:=replace(definition,$old$      if not exists(select 1 from public.customers c where c.id=booking.customer_id and c.phone=p_data->>'receiptPhone'
          and c.country_code=p_data->>'receiptCountry') then raise exception 'FORBIDDEN'; end if;$old$,$new$      if p_data->>'receiptContact'='email' then
        if booking.created_at < clock_timestamp()-interval '1 hour'
          or not exists(select 1 from private.customer_booking_email_context ctx
            join public.customers c on c.id=ctx.customer_id
            where ctx.booking_id=booking.id and ctx.guest and ctx.customer_id=booking.customer_id
              and c.status='active' and lower(c.email)=p_data->>'receiptEmail') then raise exception 'FORBIDDEN';end if;
      elsif p_data ? 'receiptContact' then raise exception 'FORBIDDEN';
      elsif not exists(select 1 from public.customers c where c.id=booking.customer_id and c.phone=p_data->>'receiptPhone'
          and c.country_code=p_data->>'receiptCountry') then raise exception 'FORBIDDEN'; end if;$new$);
 if updated=definition then raise exception 'Guest push receipt contract changed';end if;execute updated;
end $patch$;
notify pgrst,'reload schema';
commit;
