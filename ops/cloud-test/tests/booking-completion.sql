-- Hosted Test: entirely disposable accounts/data, no provider calls, rollback only.
begin;
create temp table completion_checks(label text);
create function pg_temp.check_completion(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Completion check failed: %',label;end if;
 insert into completion_checks values(label);
end $$;
create function pg_temp.completion_denied(statement text,expected text) returns boolean language plpgsql as $$begin
 execute statement;return false;exception when others then
 if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm;end if;return true;
end $$;
create function pg_temp.completion_fixture(shop uuid,barber uuid,customer uuid,service uuid,ends timestamp,state text default 'confirmed',price numeric default 5)
returns uuid language plpgsql as $$declare bid uuid:=gen_random_uuid();claims text:=current_setting('request.jwt.claims',true);begin
 perform set_config('request.jwt.claims','{}',true);
 insert into public.bookings(id,branch_id,barber_id,customer_id,service_ids,date,time,duration,price,status)
 values(bid,shop,barber,customer,array[service],(ends-interval'30 minutes')::date,(ends-interval'30 minutes')::time,30,price,state);
 perform set_config('request.jwt.claims',coalesce(claims,'{}'),true);return bid;
end $$;
do $$
#variable_conflict use_variable
declare manager uuid:=gen_random_uuid();worker_user uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();client uuid:=gen_random_uuid();
 manager_session uuid:=gen_random_uuid();worker_session uuid:=gen_random_uuid();outside_session uuid:=gen_random_uuid();client_session uuid:=gen_random_uuid();
 shop uuid:=gen_random_uuid();worker uuid:=gen_random_uuid();managed uuid:=gen_random_uuid();service uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();
 manager_claim text;worker_claim text;outside_claim text;client_claim text;bid uuid;other uuid;method text;result jsonb;paid bigint;n integer;
 now_kw timestamp:=clock_timestamp() at time zone'Asia/Kuwait'; hours jsonb; availability jsonb; area bigint; governorate bigint;
begin
 perform set_config('request.jwt.claims','{}',true);
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
 (manager,manager||'@example.test',now(),'{"role":"manager"}'),(worker_user,worker_user||'@example.test',now(),'{"role":"barber"}'),
 (outsider,outsider||'@example.test',now(),'{"role":"manager"}'),(client,client||'@example.test',now(),'{"role":"customer"}');
 insert into auth.sessions(id,user_id,aal) values(manager_session,manager,'aal1'),(worker_session,worker_user,'aal1'),(outside_session,outsider,'aal1'),(client_session,client,'aal1');
 manager_claim:=jsonb_build_object('sub',manager,'session_id',manager_session,'role','authenticated')::text;
 worker_claim:=jsonb_build_object('sub',worker_user,'session_id',worker_session,'role','authenticated')::text;
 outside_claim:=jsonb_build_object('sub',outsider,'session_id',outside_session,'role','authenticated')::text;
 client_claim:=jsonb_build_object('sub',client,'session_id',client_session,'role','authenticated')::text;
 select id,governorate_id into area,governorate from public.areas order by id limit 1;
 select jsonb_object_agg(d,jsonb_build_object('open','00:00','close','23:59')),
  jsonb_object_agg(d,jsonb_build_object('enabled',true,'start','00:00','end','23:59')) into hours,availability
  from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])d;
 insert into public.branches(id,manager_id,name,status,working_hours,area_id,governorate_id) values(shop,manager,'Completion QA','active',hours,area,governorate);
 update private.billing_subscriptions set trial_started_at=now(),trial_ends_at=now()+interval'14 days' where business_id=(select business_id from private.billing_shops where branch_id=shop);
 insert into public.services(id,branch_id,name,duration,price) values(service,shop,'Completion haircut',30,5);
 insert into public.barbers(id,branch_id,name,user_id,status,service_ids,management_mode,availability,availability_approved_at) values(worker,shop,'Completion barber',worker_user,'inactive',array[service],'account',availability,now()),(managed,shop,'Completion managed',null,'inactive',array[service],'managed',availability,now());
 update public.barbers set status='active',invite_status='accepted' where id in(worker,managed);
 perform set_config('request.jwt.claims',manager_claim,true);
 perform public.manage_shop_publication(shop,'publish','draft');
 perform set_config('request.jwt.claims','{}',true);
 insert into public.customers(id,name,email) values(customer,'Completion customer',customer||'@example.test');
 perform set_config('request.jwt.claims',manager_claim,true);
 foreach method in array array['cash','card','transfer','other','unpaid'] loop
  bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'10 days'-(array_position(array['cash','card','transfer','other','unpaid'],method)||' days')::interval);
  result:=public.staff_booking_completion('read',bid);
  perform pg_temp.check_completion(result->>'dueFils'='5000','read exact balance: '||method);
  perform public.staff_booking_completion('complete',bid,method,5000);
  perform pg_temp.check_completion((select status='completed' from public.bookings where id=bid),'completed with '||method);
  select coalesce(sum(signed_fils),0) into paid from private.shop_finance_entries where booking_id=bid;
  perform pg_temp.check_completion(paid=case when method='unpaid' then 0 else 5000 end,'correct receipt for '||method);
  perform public.staff_booking_completion('complete',bid,method,5000);
  perform pg_temp.check_completion((select count(*)=1 from private.booking_completion_payments where booking_id=bid),'idempotent audit: '||method);
  perform pg_temp.check_completion((select count(*)=case when method='unpaid' then 0 else 1 end from private.shop_finance_entries where booking_id=bid),'idempotent receipt: '||method);
 end loop;
 bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'20 days');
 perform pg_temp.check_completion(pg_temp.completion_denied(format('select public.staff_booking_completion(''complete'',%L,null,5000)',bid),'COMPLETION_METHOD_REQUIRED'),'missing method denied');
 perform pg_temp.check_completion(pg_temp.completion_denied(format('select public.staff_booking_completion(''complete'',%L,''bitcoin'',5000)',bid),'COMPLETION_METHOD_REQUIRED'),'invalid method denied');
 perform pg_temp.check_completion(pg_temp.completion_denied(format('update public.bookings set status=''completed'' where id=%L',bid),'COMPLETION_METHOD_REQUIRED'),'direct completion cannot bypass selection');
 perform pg_temp.check_completion(pg_temp.completion_denied(format('select public.staff_booking_completion(''complete'',%L,''cash'',1)',bid),'COMPLETION_PAYMENT_CHANGED'),'stale amount denied');
 insert into private.shop_finance_entries(id,shop_id,booking_id,kind,amount_fils,signed_fils,occurred_on,method,created_by)
 values(gen_random_uuid(),shop,bid,'receipt',2000,2000,now_kw::date,'cash',manager);
 perform pg_temp.check_completion(public.staff_booking_completion('read',bid)->>'dueFils'='3000','existing partial payment deducted');
 perform set_config('request.jwt.claims',worker_claim,true);
 perform public.staff_booking_completion('complete',bid,'card',3000);
 perform pg_temp.check_completion((select sum(signed_fils)=5000 and count(*)=2 from private.shop_finance_entries where booking_id=bid),'barber records remaining payment only');
 perform pg_temp.check_completion(pg_temp.completion_denied('select public.manager_finances(''options'')','FINANCE_FORBIDDEN'),'barber still cannot open finances');
 perform set_config('request.jwt.claims',manager_claim,true);
 bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'21 days');
 insert into private.shop_finance_entries(id,shop_id,booking_id,kind,amount_fils,signed_fils,occurred_on,method,created_by)
 values(gen_random_uuid(),shop,bid,'receipt',5000,5000,now_kw::date,'transfer',manager);
 perform public.staff_booking_completion('complete',bid,null,0);
 perform pg_temp.check_completion((select count(*)=1 from private.shop_finance_entries where booking_id=bid),'fully recorded payment not duplicated');
 bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'22 days');
 perform set_config('request.jwt.claims','{}',true);
 -- A platform-held receipt uses the released settlement schema only.
 -- Synthetic fixture inside this rollback transaction; no gateway or wallet.
 insert into private.settlement_rates(id,shop_id,rate_bps,created_by,reason)
 values(bid,shop,0,manager,'Completion receipt fixture');
 insert into private.settlement_agreements(id,shop_id,fee_bearer,created_by,reason)
 values(bid,shop,'platform',manager,'Completion receipt fixture');
 insert into private.settlement_receipts(shop_id,booking_id,amount_fils,commission_bps,commission_fils,rate_id,agreement_id,fee_bearer,source_ref,collected_at,created_by)
 values(shop,bid,5000,0,0,bid,bid,'platform','completion-qa:'||bid,now(),manager);
 perform set_config('request.jwt.claims',manager_claim,true);
 perform pg_temp.check_completion((public.staff_booking_completion('read',bid)->>'onlinePaid')::boolean,'online payment recognized');
 perform public.staff_booking_completion('complete',bid,'cash',0);
 perform pg_temp.check_completion((select c.method='online' from private.booking_completion_payments c where booking_id=bid) and not exists(select 1 from private.shop_finance_entries where booking_id=bid),'online payment cannot become cash receipt');
 bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw+interval'1 day');
 perform pg_temp.check_completion(pg_temp.completion_denied(format('select public.staff_booking_completion(''read'',%L)',bid),'BOOKING_NOT_FINISHED'),'future completion denied');
 bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'23 days','pending');
 perform pg_temp.check_completion(pg_temp.completion_denied(format('select public.staff_booking_completion(''read'',%L)',bid),'COMPLETION_NOT_CONFIRMED'),'pending completion denied');
 bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'24 days','cancelled');
 perform pg_temp.check_completion(pg_temp.completion_denied(format('select public.staff_booking_completion(''read'',%L)',bid),'COMPLETION_NOT_CONFIRMED'),'cancelled completion denied');
 bid:=pg_temp.completion_fixture(shop,managed,customer,service,now_kw-interval'25 days');
 perform set_config('request.jwt.claims',worker_claim,true);
 perform pg_temp.check_completion(pg_temp.completion_denied(format('select public.staff_booking_completion(''read'',%L)',bid),'COMPLETION_FORBIDDEN'),'barber cannot access another barber booking');
 perform set_config('request.jwt.claims',outside_claim,true);
 perform pg_temp.check_completion(pg_temp.completion_denied(format('select public.staff_booking_completion(''read'',%L)',bid),'COMPLETION_FORBIDDEN'),'foreign manager denied');
 perform set_config('request.jwt.claims',client_claim,true);
 perform pg_temp.check_completion(pg_temp.completion_denied(format('select public.staff_booking_completion(''read'',%L)',bid),'COMPLETION_FORBIDDEN'),'customer denied');
 perform set_config('request.jwt.claims',manager_claim,true);
 perform public.staff_booking_completion('complete',bid,'cash',5000);
 perform pg_temp.check_completion((select status='completed' from public.bookings where id=bid),'manager completes managed barber appointment');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'role','authenticated')::text,true);
 perform pg_temp.check_completion(pg_temp.completion_denied(format('select public.staff_booking_completion(''read'',%L)',bid),'COMPLETION_FORBIDDEN'),'missing live session denied');
 perform set_config('request.jwt.claims',manager_claim,true);
 bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'26 days');
 perform set_config('request.jwt.claims','{}',true);
 update public.bookings set price=0 where id=bid;
 perform set_config('request.jwt.claims',manager_claim,true);
 perform public.staff_booking_completion('complete',bid,null,0);
 perform pg_temp.check_completion((select c.method='free' from private.booking_completion_payments c where booking_id=bid) and not exists(select 1 from private.shop_finance_entries where booking_id=bid),'zero price creates no receipt');
 -- Scheduler checks use only this transaction's disposable overdue appointments.
 perform set_config('request.jwt.claims','{}',true);
 bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'23 hours');
 other:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'25 hours');
 perform private.notify_overdue_bookings();
 perform pg_temp.check_completion(not exists(select 1 from public.notifications where entity_id=bid and metadata->>'completionOverdue'='true'),'no reminder before 24 hours');
 perform pg_temp.check_completion((select count(*)=2 from public.notifications where entity_id=other and metadata->>'completionOverdue'='true'),'overdue reminder delivered to manager and assigned barber');
 perform private.notify_overdue_bookings();
 perform pg_temp.check_completion((select count(*)=2 from public.notifications where entity_id=other and metadata->>'completionOverdue'='true'),'scheduler retry does not duplicate reminders');
 perform pg_temp.check_completion((select status='confirmed' from public.bookings where id=other),'reminder never auto-completes booking');
 update public.bookings set status='cancelled' where id=bid;
 perform pg_temp.check_completion(not exists(select 1 from private.booking_completion_reminders where booking_id=bid),'cancellation removes queued reminder');
 bid:=pg_temp.completion_fixture(shop,managed,customer,service,now_kw-interval'27 hours');
 perform private.notify_overdue_bookings();
 perform pg_temp.check_completion((select count(*)=1 from public.notifications where entity_id=bid and metadata->>'completionOverdue'='true'),'managed barber reminder goes to manager only');
 bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'28 hours');
 update public.bookings set date=(now_kw+interval'2 days')::date where id=bid;
 perform private.notify_overdue_bookings();
 perform pg_temp.check_completion(not exists(select 1 from public.notifications where entity_id=bid and metadata->>'completionOverdue'='true')
  and exists(select 1 from private.booking_completion_reminders where booking_id=bid and delivered_at is null and scheduled_at>now()),'reschedule defers reminder to the new appointment end');
 bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'29 hours');
 insert into public.user_notification_preferences(user_id,booking_updates) values(worker_user,false) on conflict(user_id) do update set booking_updates=false;
 perform private.notify_overdue_bookings();
 perform pg_temp.check_completion((select count(*)=1 from public.notifications where entity_id=bid and metadata->>'completionOverdue'='true')
  and exists(select 1 from public.notifications where entity_id=bid and recipient_user_id=manager),'reminder respects barber notification preference');
 perform set_config('request.jwt.claims',worker_claim,true);
 bid:=pg_temp.completion_fixture(shop,worker,customer,service,now_kw-interval'30 days');
 update auth.sessions set not_after=now()-interval'1 minute' where id=worker_session;
 perform pg_temp.check_completion(pg_temp.completion_denied(format('select public.staff_booking_completion(''read'',%L)',bid),'COMPLETION_FORBIDDEN'),'expired staff session denied');
 perform pg_temp.check_completion(not has_function_privilege('anon','public.staff_booking_completion(text,uuid,text,bigint)','execute') and not has_function_privilege('authenticated','private.notify_overdue_bookings()','execute'),'private scheduler and anonymous mutation blocked');
end $$;
select count(*) as passed,array_agg(label order by label) as checks from completion_checks;
rollback;
