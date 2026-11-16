begin;
do $migration$
declare original text;updated text;
begin
 original:=pg_get_functiondef('public.customer_android_push_dispatch(text,jsonb)'::regprocedure);
 updated:=replace(original,
  $old$select d.id,e.id,e.expires_at from private.customer_push_events e
   join private.customer_booking_owners o on o.booking_id=e.booking_id
   join private.customer_android_push_devices d on d.account_id=o.account_user_id
   where e.expires_at>clock_timestamp()and e.created_at>=d.created_at and e.occurred_at>=runtime.created_at$old$,
  $new$select device_row.id,e.id,e.expires_at from private.customer_push_events e
   join private.customer_booking_owners o on o.booking_id=e.booking_id
   join private.customer_android_push_devices device_row on device_row.account_id=o.account_user_id
   where e.expires_at>clock_timestamp()and e.created_at>=device_row.created_at and e.occurred_at>=runtime.created_at$new$);
 if updated=original then raise exception'ANDROID_CLAIM_CONTRACT_CHANGED';end if;
 execute updated;
end$migration$;
commit;
