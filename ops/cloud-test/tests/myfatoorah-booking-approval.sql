begin;
do $$
<<qa>>
declare member uuid:=gen_random_uuid(); live uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid();
 admin uuid:=gen_random_uuid(); admin_session uuid:=gen_random_uuid(); factor uuid:=gen_random_uuid();
 shop uuid; worker uuid; service uuid; data jsonb; quote jsonb; result jsonb; denied boolean;
 booking uuid:=gen_random_uuid(); cap uuid:=gen_random_uuid(); amount bigint; late uuid:=gen_random_uuid(); mode text; automatic boolean;
begin
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
  (member,member||'@example.test',now(),'{"role":"customer"}'),(admin,admin||'@example.test',now(),'{"role":"agent"}');
 insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(factor,admin,'totp','verified',now(),now());
 insert into auth.sessions(id,user_id,aal,factor_id) values(live,member,'aal1',null),(admin_session,admin,'aal2',factor);
 insert into public.customers(id,name,email) values(customer,'MyFatoorah approval QA',member||'@example.test');
 insert into private.customer_accounts(user_id,customer_id) values(member,customer);
 select f.shop_id,b.id,s.id into strict shop,worker,service from myfatoorah_test.booking_shops f
  join public.barbers b on b.branch_id=f.shop_id join public.services s on s.branch_id=f.shop_id and s.id=any(b.service_ids)
  where f.enabled and b.status='active' and s.status='active' order by s.name limit 1;
 update public.barbers set auto_confirm_bookings=false where id=worker;
 data:=jsonb_build_object('branch_id',shop,'barber_id',worker,'service_ids',jsonb_build_array(service),
  'date',((now() at time zone 'Asia/Kuwait')::date+2)::text);
 quote:=public.myfatoorah_test_booking('slots',null,data);
 assert quote->>'confirmation_required'='true' and quote->>'approval_payment'='true' and quote->>'wallet_payment'='false';
 data:=data||jsonb_build_object('id',booking,'time',quote->'slots'->>0,'expected_price',quote->>'price',
  'expected_duration',quote->>'duration','booking_policy',quote->'booking_policy','name','MyFatoorah approval QA',
  'email',member||'@example.test','account_user_id',member,'session_id',live,'country_code','+965','language','en');
 amount:=((quote->>'price')::numeric*1000)::bigint;
 result:=public.myfatoorah_test_booking('request-approval',booking,jsonb_build_object('booking',data));
 assert result->>'state'='approval_requested';
 assert (select status='pending' and online_payment_state='pending_approval' from public.bookings where id=booking);
 assert not exists(select 1 from upayments_test.booking_attempts where id=booking);
 denied:=false;begin perform public.myfatoorah_test_booking('approval-checkout',booking,jsonb_build_object('capability',cap,'account_user_id',member,'session_id',live));
 exception when others then denied:=sqlerrm='WALLET_PAYMENT_WINDOW_CLOSED';end;assert denied;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'session_id',admin_session,'aal','aal2','role','authenticated')::text,true);
 perform public.confirm_pending_booking(booking);
 assert (select status='pending' and online_payment_state='awaiting_payment' from public.bookings where id=booking);
 assert exists(select 1 from private.customer_booking_email_jobs where booking_id=booking and kind='payment_due');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.myfatoorah_test_booking('approval-checkout',booking,jsonb_build_object('capability',cap,'account_user_id',member,'session_id',live));
 assert result->>'state'='creating';
 assert (select provider='myfatoorah' and wallet_id is null and wallet_fils=0 from upayments_test.booking_attempts where id=booking);
 perform public.myfatoorah_test_booking('claim-create',booking);
 perform public.myfatoorah_test_booking('attach',booking,jsonb_build_object('sessionId','12345678','checkoutUrl','https://demo.myfatoorah.com/KWT/ie/qa'));
 result:=public.myfatoorah_test_booking('capture',booking,jsonb_build_object('sessionId','12345678','paymentId','1234567890','externalIdentifier',booking,'currency','KWD','totalFils',amount));
 assert result->>'state'='paid';
 assert (select status='confirmed' and online_payment_state='paid' from public.bookings where id=booking);
 assert (select count(*)=1 from private.settlement_receipts where booking_id=booking);
 -- A delayed capture must never displace an appointment or falsely confirm.
 update public.barbers set auto_confirm_bookings=true where id=worker;
 data:=data||jsonb_build_object('id',late,'date',((now() at time zone 'Asia/Kuwait')::date+3)::text);
 quote:=public.myfatoorah_test_booking('slots',null,data);
 data:=data||jsonb_build_object('time',quote->'slots'->>0);
 perform public.myfatoorah_test_booking('start',late,jsonb_build_object('booking',data,'capability',gen_random_uuid()));
 perform public.myfatoorah_test_booking('claim-create',late);
 perform public.myfatoorah_test_booking('attach',late,jsonb_build_object('sessionId','12345679','checkoutUrl','https://demo.myfatoorah.com/KWT/ie/late'));
 update upayments_test.booking_attempts set hold_until=now()-interval '1 minute' where id=late;
 result:=public.myfatoorah_test_booking('capture',late,jsonb_build_object('sessionId','12345679','paymentId','1234567891','externalIdentifier',late,'currency','KWD','totalFils',amount));
 assert result->>'state'='review' and result->>'refundState'='review';
 assert not exists(select 1 from public.bookings where id=late);
 assert not exists(select 1 from private.settlement_receipts where booking_id=late);
 foreach mode in array array['at_shop','online','both'] loop
  foreach automatic in array array[true,false] loop
   update upayments_test.shop_payment_methods set method=mode where shop_id=shop;
   update public.barbers set auto_confirm_bookings=automatic where id=worker;
   quote:=public.myfatoorah_test_booking('slots',null,data);
   assert (quote->>'pay_at_shop')::boolean=(mode<>'online');
   assert (quote->>'online_payment')::boolean=(automatic and mode<>'at_shop');
   assert (quote->>'approval_payment')::boolean=(mode<>'at_shop');
   assert (quote->>'wallet_payment')::boolean=false;
  end loop;
 end loop;
 update public.services set price=0 where id=service;
 quote:=public.myfatoorah_test_booking('slots',null,data);
 assert not (quote->>'online_payment')::boolean and not (quote->>'approval_payment')::boolean;
end $$;
select 'PASS: manual approval, payment-due email, confirmed paid state and late-capture review; all fixtures rolled back' as result;
rollback;
