-- UPayments scenarios adapted to MyFatoorah. All records are disposable and roll back.
begin;
create temp table mf_booking_matrix_checks(scenario text);
do $$
<<qa>>
declare manager uuid:=gen_random_uuid();shop uuid:=gen_random_uuid();worker uuid:=gen_random_uuid();service uuid:=gen_random_uuid();manager_session uuid:=gen_random_uuid();owner_claims text;
 bid uuid; area bigint; governorate bigint; hours jsonb; quote jsonb; data jsonb; result jsonb; changed jsonb;
 booking uuid; capability uuid; scenario text; denied boolean; secret text; ids jsonb;
begin
 perform set_config('request.jwt.claims','{}',true);
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(manager,manager||'@example.test',now(),'{"role":"manager"}');
 insert into auth.sessions(id,user_id,aal) values(manager_session,manager,'aal1');
 owner_claims:=jsonb_build_object('sub',manager,'session_id',manager_session,'role','authenticated','aal','aal1')::text;
 select id,governorate_id into area,governorate from public.areas order by id limit 1;
 select jsonb_object_agg(d,jsonb_build_object('open','09:00','close','21:00')) into hours
  from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])d;
 insert into public.branches(id,manager_id,name,status,publication_state,governorate_id,area_id,working_hours)
  values(shop,manager,'MyFatoorah Transaction Matrix','active','draft',governorate,area,hours);
 select business_id into bid from private.billing_shops where branch_id=shop;
 update private.billing_subscriptions set trial_started_at=now(),trial_ends_at=now()+interval '14 days' where business_id=bid;
 insert into public.services(id,branch_id,name,duration,price) values(service,shop,'Matrix haircut',30,5);
 insert into public.barbers(id,branch_id,name,status,management_mode,service_ids,availability,availability_approved_at)
  values(worker,shop,'Matrix managed barber','inactive','managed',array[service],
   (select jsonb_object_agg(d,jsonb_build_object('enabled',true,'start','09:00','end','21:00'))
    from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])d),now());
 update public.barbers set status='active' where id=worker;
 perform set_config('request.jwt.claims',owner_claims,true);
 perform public.manage_shop_publication(shop,'publish','draft');
 perform set_config('request.jwt.claims','{}',true);
 insert into upayments_test.booking_fixture values(shop,true);
 insert into myfatoorah_test.booking_shops values(shop,true);
 insert into upayments_test.shop_payment_methods values(shop,'both');
 insert into private.settlement_rates(shop_id,rate_bps,created_by,reason) values(shop,500,manager,'Rollback-only MyFatoorah matrix');
 insert into private.settlement_agreements(shop_id,fee_bearer,created_by,reason) values(shop,'platform',manager,'Rollback-only MyFatoorah matrix');
 foreach scenario in array array['amount-tamper','duration-tamper','policy-tamper','wrong-shop','cash-only','online-only','gateway-disabled','guest-manual-online',
  'duplicate-start','competing-hold','price-changed','duration-changed','auto-confirm-disabled','barber-inactive','shop-paused','late-capture','paid-cancellation'] loop
 begin
  booking:=gen_random_uuid();capability:=gen_random_uuid();denied:=false;
  data:=jsonb_build_object('branch_id',shop,'barber_id',worker,'service_ids',jsonb_build_array(service),'date',((now() at time zone 'Asia/Kuwait')::date+3)::text);
  quote:=public.myfatoorah_test_booking('slots',null,data);
  assert jsonb_array_length(quote->'slots')>0;
  data:=data||jsonb_build_object('id',booking,'time',quote->'slots'->>0,'expected_price',quote->>'price','expected_duration',quote->>'duration',
   'booking_policy',quote->'booking_policy','name','Matrix Guest','email',booking||'@example.test','guest_contact','email','country_code','+965','language','en');
  if scenario in ('amount-tamper','duration-tamper','policy-tamper','wrong-shop','cash-only','gateway-disabled') then
   changed:=data;
   if scenario='amount-tamper' then changed:=changed||'{"expected_price":"0.001"}';
   elsif scenario='duration-tamper' then changed:=changed||'{"expected_duration":"480"}';
   elsif scenario='policy-tamper' then changed:=changed||jsonb_build_object('booking_policy',jsonb_build_object('cancel_minutes',1,'reschedule_minutes',1));
   elsif scenario='wrong-shop' then changed:=changed||jsonb_build_object('branch_id',gen_random_uuid());
   elsif scenario='cash-only' then update upayments_test.shop_payment_methods set method='at_shop' where shop_id=shop;
   elsif scenario='gateway-disabled' then update myfatoorah_test.booking_shops set enabled=false where shop_id=shop;end if;
   begin perform public.myfatoorah_test_booking('start',booking,jsonb_build_object('booking',changed,'capability',capability));
   exception when others then denied:=sqlerrm in ('PRICE_CHANGED','BOOKING_POLICY_CHANGED','UPAYMENTS_NOT_AVAILABLE','SHOP_PAYMENT_CHANGED');end;
   assert denied;assert not exists(select 1 from upayments_test.booking_attempts where id=booking);
  elsif scenario='online-only' then
   update upayments_test.shop_payment_methods set method='online' where shop_id=shop;
   begin perform public.upayments_test_booking('book-at-shop',booking,data);exception when others then denied:=sqlerrm='SHOP_PAYMENT_CHANGED';end;
   assert denied;
  elsif scenario='guest-manual-online' then
   update public.barbers set auto_confirm_bookings=false where id=worker;
   update upayments_test.shop_payment_methods set method='online' where shop_id=shop;
   begin perform public.myfatoorah_test_booking('request-approval',booking,jsonb_build_object('booking',data));
   exception when others then denied:=sqlerrm='WALLET_FORBIDDEN';end;
   assert denied;assert not exists(select 1 from public.bookings where id=booking);
  else
   result:=public.myfatoorah_test_booking('start',booking,jsonb_build_object('booking',data,'capability',capability));
   assert result->>'state'='creating';assert not exists(select 1 from public.bookings where id=booking);
   if scenario='duplicate-start' then
    changed:=public.myfatoorah_test_booking('start',booking,jsonb_build_object('booking',data,'capability',capability));
    assert changed->>'id'=booking::text;assert (select count(*)=1 from myfatoorah_test.booking_invoices where attempt_id=booking);
    assert public.myfatoorah_test_booking('claim-create',booking)='true'::jsonb;
    assert public.myfatoorah_test_booking('claim-create',booking)='false'::jsonb;
   elsif scenario='competing-hold' then
    changed:=data||jsonb_build_object('id',gen_random_uuid());
    begin perform public.myfatoorah_test_booking('start',(changed->>'id')::uuid,jsonb_build_object('booking',changed,'capability',gen_random_uuid()));
    exception when others then denied:=sqlerrm='SLOT_UNAVAILABLE';end;assert denied;
   else
    perform public.myfatoorah_test_booking('claim-create',booking);
    perform public.myfatoorah_test_booking('attach',booking,jsonb_build_object('sessionId','123456781','checkoutUrl','https://demo.myfatoorah.com/KWT/ie/matrix'));
    if scenario='price-changed' then update public.services set price=6 where id=service;
    elsif scenario='duration-changed' then update public.services set duration=45 where id=service;
    elsif scenario='auto-confirm-disabled' then update public.barbers set auto_confirm_bookings=false where id=worker;
    elsif scenario='barber-inactive' then update public.barbers set status='inactive' where id=worker;
    elsif scenario='shop-paused' then
     perform set_config('request.jwt.claims',owner_claims,true);
     perform public.manage_shop_publication(shop,'pause','published');
     perform set_config('request.jwt.claims','{}',true);
    elsif scenario='late-capture' then update upayments_test.booking_attempts set hold_until=now()-interval '1 minute' where id=booking;end if;
    result:=public.myfatoorah_test_booking('capture',booking,jsonb_build_object('sessionId','123456781','paymentId','12345678901','externalIdentifier',booking,'currency','KWD','totalFils',5000));
    if scenario='paid-cancellation' then
     assert result->>'state'='paid';
     update public.bookings set status='cancelled' where id=booking;
     select decrypted_secret into secret from vault.decrypted_secrets where name='upayments_test_booking_sweep';
     perform public.myfatoorah_test_booking('sweep',null,jsonb_build_object('secret',secret));
     assert (select refund_state='review' from upayments_test.booking_attempts where id=booking);
     ids:=public.upayments_test_booking('sweep',null,jsonb_build_object('secret',secret));
     assert not (ids?booking::text);
     assert not exists(select 1 from private.settlement_journals j join private.settlement_receipts r on r.id=j.receipt_id where r.booking_id=booking and j.kind='refund');
     denied:=false;begin perform public.upayments_test_booking('claim-refund',booking,'{}');
     exception when others then denied:=sqlerrm='UPAYMENTS_NOT_AVAILABLE';end;assert denied;
    else
     assert result->>'state'='review' and result->>'refundState'='review';
     assert not exists(select 1 from public.bookings where id=booking);
     assert not exists(select 1 from private.settlement_receipts where booking_id=booking);
    end if;
   end if;
  end if;
  raise sqlstate 'B0001';
 exception when sqlstate 'B0001' then null;
 end;
 insert into mf_booking_matrix_checks values(scenario);
 end loop;
end $$;
select count(*) as scenario_groups_passed,jsonb_agg(scenario order by scenario) as scenarios from mf_booking_matrix_checks;
rollback;
