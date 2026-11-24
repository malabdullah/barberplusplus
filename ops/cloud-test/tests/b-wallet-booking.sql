-- Hosted Test only. Uses the authorized synthetic online-pay pilot and
-- synthetic provider facts. The transaction rolls back the entire fixture.
begin;
create temp table wallet_booking_checks (label text);
create function pg_temp.wallet_check(value boolean,label text) returns void
language plpgsql as $$
begin
  if value is distinct from true then raise exception 'B-Wallet checkout: %',label; end if;
  insert into wallet_booking_checks values(label);
end
$$;
do $test$
declare
  user_id_value uuid := gen_random_uuid(); session_id_value uuid := gen_random_uuid(); customer_id_value uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid(); admin_session uuid := gen_random_uuid(); factor_id uuid := gen_random_uuid();
  shop uuid; worker uuid; service uuid; wallet uuid; today date := (now() at time zone 'Asia/Kuwait')::date;
  auth_scope jsonb; basket jsonb; quoted jsonb; booking uuid; cap uuid; attempt jsonb;
  amount bigint; tender bigint; elapsed integer; selected_slot text; chosen_date date;
  scenario text; receipt_event uuid; claim jsonb; p_amount bigint; preview jsonb; before_refund bigint;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
    (user_id_value,user_id_value||'@example.test',now(),'{"role":"customer"}'),
    (admin_id,admin_id||'@example.test',now(),'{"role":"agent"}');
  insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
    values(factor_id,admin_id,'totp','verified',now(),now());
  insert into auth.sessions(id,user_id,aal,factor_id) values
    (session_id_value,user_id_value,'aal1',null),(admin_session,admin_id,'aal2',factor_id);
  insert into public.customers(id,name,email) values (customer_id_value,'B-Wallet checkout QA',user_id_value||'@example.test');
  insert into private.customer_accounts(user_id,customer_id) values(user_id_value,customer_id_value);
  select f.shop_id,b.id,s.id into strict shop,worker,service
    from upayments_test.booking_fixture f join public.barbers b on b.branch_id=f.shop_id
    join public.services s on s.branch_id=f.shop_id and s.id=any(b.service_ids)
    where f.enabled and b.status='active' and s.status='active' and s.price>0 order by s.price,s.id limit 1;
  update private.b_wallet_settings set enabled=true,accept_new_payments=true;
  auth_scope := jsonb_build_object('account_user_id',user_id_value,'session_id',session_id_value);
  wallet := private.b_wallet_lock(customer_id_value);
  perform private.b_wallet_credit(wallet,'goodwill',50000,gen_random_uuid(),now(),now()+interval '6 months');

  foreach scenario in array array['wallet-only','split','gateway-wallet-refund','approval-paid','approval-expires','late-capture'] loop
    perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    update public.barbers set auto_confirm_bookings=scenario not in ('approval-paid','approval-expires') where id=worker;
    for elapsed in 2..8 loop
      chosen_date:=today+elapsed;
      basket:=auth_scope||jsonb_build_object('branch_id',shop,'barber_id',worker,
        'service_ids',jsonb_build_array(service),'date',chosen_date);
      quoted:=public.upayments_test_booking('slots',null,basket);
      selected_slot:=quoted->'slots'->>0;
      exit when selected_slot is not null;
    end loop;
    perform pg_temp.wallet_check(selected_slot is not null and quoted->>'wallet_payment'='true','pilot slot available for '||scenario);
    booking:=gen_random_uuid(); cap:=gen_random_uuid();
    amount:=round((quoted->>'price')::numeric*1000)::bigint;
    tender:=case when scenario in ('wallet-only','approval-paid') then amount when scenario in ('split','late-capture') then amount / 2 else 0 end;
    basket:=basket||jsonb_build_object('id',booking,'time',selected_slot,'name','Wallet checkout QA',
      'country_code','+965','email',user_id_value||'@example.test','language','en','expected_price',quoted->>'price',
      'expected_duration',quoted->>'duration','booking_policy',quoted->'booking_policy');
    if scenario in ('approval-paid','approval-expires') then
      attempt:=public.upayments_test_booking('request-approval',booking,jsonb_build_object('booking',basket));
      perform pg_temp.wallet_check(attempt->>'state'='approval_requested'
        and (select status='pending' and online_payment_state='pending_approval' from public.bookings where id=booking)
        and not exists(select 1 from upayments_test.booking_attempts where id=booking),'booking awaits approval without payment');
      perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_session,'aal','aal2','role','authenticated')::text,true);
      perform public.confirm_pending_booking(booking);
      perform pg_temp.wallet_check((select status='pending' and online_payment_state='awaiting_payment' and online_payment_due_at>clock_timestamp()
        from public.bookings where id=booking),'staff approval requests payment and reserves slot');
      perform pg_temp.wallet_check(exists(select 1 from private.customer_booking_email_jobs where booking_id=booking and kind='payment_due'),'approval email queued');
      perform set_config('request.jwt.claims','{"role":"service_role"}',true);
      if scenario='approval-expires' then
        perform set_config('barber.b_wallet_operation',booking::text,true);
        update public.bookings set online_payment_due_at=now()-interval '1 minute' where id=booking;
        perform set_config('barber.b_wallet_operation','',true);
        perform private.b_wallet_expire_approvals();
        perform pg_temp.wallet_check((select status='cancelled' and online_payment_state='expired' from public.bookings where id=booking),'unpaid slot released at deadline');
        continue;
      end if;
      attempt:=public.upayments_test_booking('approval-checkout',booking,auth_scope||jsonb_build_object('capability',cap,'wallet_fils',tender));
    else
      attempt:=public.upayments_test_booking('start',booking,jsonb_build_object('booking',basket,'capability',cap,'wallet_fils',tender));
    end if;
    perform pg_temp.wallet_check((attempt->>'externalFils')::bigint=amount-tender,'exact external remainder for '||scenario);
    if tender=amount then
      attempt:=public.upayments_test_booking('wallet-capture',booking,'{}');
    else
      perform public.upayments_test_booking('attach',booking,jsonb_build_object('sessionId',booking::text,'checkoutUrl','https://sandbox.upayments.com'));
      if scenario='late-capture' then update upayments_test.booking_attempts set hold_until=now()-interval '1 minute' where id=booking; end if;
      claim:=jsonb_build_object('totalFils',amount-tender,'currency','KWD','sessionId',booking::text,'trackId',booking::text,'providerOrderId',booking::text,'providerRefundKey',booking::text);
      attempt:=public.upayments_test_booking('capture',booking,claim);
      perform public.upayments_test_booking('capture',booking,claim);
    end if;
    if scenario='late-capture' then
      perform pg_temp.wallet_check(attempt->>'state'='review' and not exists(select 1 from private.settlement_receipts where booking_id=booking)
        and not exists(select 1 from private.b_wallet_movements where reference=booking and kind='spend'),'late capture does not debit wallet or create a booking receivable');
      perform pg_temp.wallet_check(public.upayments_test_booking('claim-refund',booking,'{}')='true'::jsonb,'late capture queues original method refund');
      continue;
    end if;
    perform pg_temp.wallet_check(attempt->>'state'='paid' and
      (select status='confirmed' and online_payment_state='paid' from public.bookings where id=booking),'confirmed only after full payment for '||scenario);
    perform pg_temp.wallet_check((select count(*)=1 and sum(amount_fils)=amount from private.settlement_receipts where booking_id=booking),'one gross shop receipt for '||scenario);
    if scenario='wallet-only' then
      select j.id into strict receipt_event from private.settlement_journals j
        join private.settlement_receipts r on r.id=j.receipt_id where r.booking_id=booking and j.kind='receipt';
      begin
        insert into private.settlement_journals(shop_id,receipt_id,kind,amount_fils,created_by,occurred_at)
          select shop,id,'refund',amount,admin_id,now() from private.settlement_receipts where booking_id=booking;
        raise exception 'unexpected manual refund';
      exception when raise_exception then
        perform pg_temp.wallet_check(sqlerrm='SETTLEMENT_WALLET_MANAGED','manual settlement refund cannot bypass wallet funding');
      end;
      begin
        insert into private.settlement_journals(shop_id,receipt_id,kind,amount_fils,created_by,occurred_at,reverses_id)
          select shop,id,'reversal',-amount,admin_id,now(),receipt_event from private.settlement_receipts where booking_id=booking;
        raise exception 'unexpected reversal';
      exception when raise_exception then
        perform pg_temp.wallet_check(sqlerrm='SETTLEMENT_WALLET_MANAGED','manual settlement reversal cannot bypass wallet funding');
      end;
    end if;
    if tender>0 then
      perform pg_temp.wallet_check((select count(*)=1 and sum(amount_fils)=-tender from private.b_wallet_movements where reference=booking and kind='spend'),'one wallet debit for '||scenario);
    end if;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',user_id_value,'session_id',session_id_value,'aal','aal1','role','authenticated')::text,true);
    perform pg_temp.wallet_check(public.b_wallet_booking('view',booking)->>'state'='paid','booking owner can see payment status');
    if scenario='approval-paid' then
      perform pg_temp.wallet_check((private.b_wallet_deletion_state(array[customer_id_value],now())->>'walletPending')::integer>0,'open paid booking blocks account deletion');
      continue;
    end if;
    perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    perform public.b_wallet_cancel_service(jsonb_build_object('user_id',user_id_value,'session_id',session_id_value,
      'booking_id',booking,'destination','wallet','expected_date',chosen_date,'expected_time',selected_slot));
    before_refund:=(private.b_wallet_summary(wallet,now(),null)->>'balanceFils')::bigint;
    perform public.upayments_test_booking('claim-refund',booking,'{}');
    perform public.upayments_test_booking('claim-refund',booking,'{}');
    p_amount:=(private.b_wallet_summary(wallet,now(),null)->>'balanceFils')::bigint;
    perform pg_temp.wallet_check(p_amount-before_refund=amount,'full refund credited exactly once for '||scenario);
    perform pg_temp.wallet_check((select refund_state='refunded' from upayments_test.booking_attempts where id=booking),'settlement refund final for '||scenario);
  end loop;
  preview:=private.deletion_preview(array[customer_id_value]);
  perform pg_temp.wallet_check(preview ? 'walletBalanceFils' and preview ? 'walletPending','wallet state is included in deletion preview');
  begin
    perform private.b_wallet_close_for_deletion(array[customer_id_value],preview->>'walletBalanceFils');
    raise exception 'Deletion unexpectedly cleared a pending payment';
  exception when raise_exception then
    if sqlerrm<>'WALLET_PENDING_ACTIVITY' then raise; end if;
  end;
end
$test$;
set constraints all immediate;
select count(*) as assertions, array_agg(label order by label) as passed from wallet_booking_checks;
rollback;
