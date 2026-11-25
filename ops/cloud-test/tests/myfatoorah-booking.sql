begin;
do $$
<<qa>>
declare shop uuid; barber uuid; service uuid; quote jsonb; data jsonb; result jsonb;
 id uuid:=gen_random_uuid(); cap uuid:=gen_random_uuid(); denied boolean; amount bigint;
begin
 select shop_id into strict shop from myfatoorah_test.booking_shops where enabled;
 select b.id,s.id into strict barber,service from public.barbers b join public.services s on s.id=any(b.service_ids)
  where b.branch_id=shop and b.status='active' and b.auto_confirm_bookings and s.status='active' order by s.name limit 1;
 data:=jsonb_build_object('branch_id',shop,'barber_id',barber,'service_ids',jsonb_build_array(service),
  'date',((now() at time zone 'Asia/Kuwait')::date+1)::text);
 quote:=public.myfatoorah_test_booking('slots',null,data);
 assert quote->>'payment_provider'='myfatoorah' and (quote->>'online_payment')::boolean;
 assert not (quote->>'wallet_payment')::boolean;
 assert jsonb_array_length(quote->'slots')>0;
 assert not (public.upayments_test_booking('slots',null,data)->>'online_payment')::boolean;
 data:=data||jsonb_build_object('id',id,'time',quote->'slots'->>0,'expected_price',quote->>'price',
  'expected_duration',quote->>'duration','booking_policy',quote->'booking_policy','name','MyFatoorah Booking QA',
  'email','myf-booking-'||id||'@example.test','guest_contact','email','country_code','+965','language','en');
 amount:=((quote->>'price')::numeric*1000)::bigint;
 denied:=false;begin perform public.upayments_test_booking('start',id,jsonb_build_object('booking',data,'capability',cap));
 exception when others then denied:=sqlerrm='UPAYMENTS_NOT_AVAILABLE';end;assert denied;
 result:=public.myfatoorah_test_booking('start',id,jsonb_build_object('booking',data,'capability',cap));
 assert result->>'state'='creating' and result->>'provider'='myfatoorah';
 assert not exists(select 1 from public.bookings b where b.id=qa.id);
 assert (public.myfatoorah_test_booking('route',null,jsonb_build_object('capability',cap)))::boolean;
 assert public.myfatoorah_test_booking('claim-create',id,'{}')='true'::jsonb;
 assert public.myfatoorah_test_booking('claim-create',id,'{}')='false'::jsonb;
 result:=public.myfatoorah_test_booking('slots',null,data);
 assert not (result->'slots'?(data->>'time'));
 denied:=false;begin perform public.native_customer_booking('book',data);
 exception when exclusion_violation then denied:=true;end;assert denied;
 denied:=false;begin perform public.myfatoorah_test_booking('start',id,jsonb_build_object('booking',data,'capability',gen_random_uuid()));
 exception when others then denied:=sqlerrm='UPAYMENTS_FORBIDDEN';end;assert denied;
 denied:=false;begin perform public.myfatoorah_test_booking('attach',id,jsonb_build_object('sessionId','1234567','checkoutUrl','https://evil.example/pay'));
 exception when others then denied:=sqlerrm='UPAYMENTS_PROVIDER_MISMATCH';end;assert denied;
 perform public.myfatoorah_test_booking('attach',id,jsonb_build_object('sessionId','1234567','checkoutUrl','https://demo.myfatoorah.com/KWT/ie/qa'));
 denied:=false;begin perform public.myfatoorah_test_booking('capture',id,jsonb_build_object('sessionId','1234567','paymentId','123456789',
  'externalIdentifier',id,'currency','KWD','totalFils',amount-1));
 exception when others then denied:=sqlerrm='UPAYMENTS_PROVIDER_MISMATCH';end;assert denied;
 assert not exists(select 1 from public.bookings b where b.id=qa.id);
 denied:=false;begin perform public.upayments_test_booking('capture',id,'{}');
 exception when others then denied:=sqlerrm='UPAYMENTS_NOT_AVAILABLE';end;assert denied;
 result:=public.myfatoorah_test_booking('capture',id,jsonb_build_object('sessionId','1234567','paymentId','123456789',
  'externalIdentifier',id,'currency','KWD','totalFils',amount));
 assert result->>'state'='paid';
 assert (select count(*)=1 from public.bookings b where b.id=qa.id and status='confirmed');
 assert (select count(*)=1 from private.settlement_receipts r where booking_id=qa.id and amount_fils=amount and source_ref like 'myfatoorah-booking-sandbox:%');
 result:=public.myfatoorah_test_booking('capture',id,jsonb_build_object('sessionId','1234567','paymentId','123456789',
  'externalIdentifier',id,'currency','KWD','totalFils',amount));
 assert result->>'state'='paid';
 assert (select count(*)=1 from private.settlement_receipts r where booking_id=qa.id);
 assert not has_function_privilege('anon','public.myfatoorah_test_booking(text,uuid,jsonb)','execute');
 assert not has_function_privilege('authenticated','public.myfatoorah_test_booking(text,uuid,jsonb)','execute');
end $$;
select 'PASS: 24 booking/provider/hold/settlement/privilege assertions; all test writes rolled back' as result;
rollback;
