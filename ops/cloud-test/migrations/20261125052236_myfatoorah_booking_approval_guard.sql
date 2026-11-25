begin;
do $$ declare definition text; original text := '''approval_payment'',upayments_test.shop_payment_method(shop)<>''at_shop'' and exists'; begin
 select pg_get_functiondef('public.myfatoorah_test_booking(text,uuid,jsonb)'::regprocedure) into definition;
 if position(original in definition)=0 then raise exception 'Approval eligibility contract changed'; end if;
 execute replace(definition,original,'''approval_payment'',coalesce((result->>''wallet_payment'')::boolean,false) and upayments_test.shop_payment_method(shop)<>''at_shop'' and exists');
end $$;
notify pgrst,'reload schema';
commit;
