-- All identities, bookings, receipts and flags are synthetic and roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
select plan(1);
create temp table settlement_checks(label text);
create function pg_temp.sa(ok boolean,label text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'SETTLEMENT_ASSERT: %',label;end if;insert into settlement_checks values(label);end$$;
create function pg_temp.sw(action text,data jsonb default '{}')returns jsonb language sql as $$select public.platform_settlements(action,data||jsonb_build_object('requestId',gen_random_uuid()));$$;
create function pg_temp.se(action text,data jsonb,code text,admin boolean default true)returns boolean language plpgsql as $$begin
 if admin then perform public.platform_settlements(action,data||jsonb_build_object('requestId',gen_random_uuid()));else perform public.shop_settlements(action,data);end if;
 return false;exception when others then if sqlerrm<>code then raise exception 'For % expected %, got %',action,code,sqlerrm;end if;return true;end$$;
do $test$
#variable_conflict use_variable
declare
 ad uuid:=gen_random_uuid();ag uuid:=gen_random_uuid();m uuid:=gen_random_uuid();other_m uuid:=gen_random_uuid();barber_user uuid:=gen_random_uuid();cu uuid:=gen_random_uuid();
 ads uuid:=gen_random_uuid();ags uuid:=gen_random_uuid();ms uuid:=gen_random_uuid();os uuid:=gen_random_uuid();bs uuid:=gen_random_uuid();cs uuid:=gen_random_uuid();af uuid:=gen_random_uuid();gf uuid:=gen_random_uuid();
 shop uuid:=gen_random_uuid();outside uuid:=gen_random_uuid();svc uuid:=gen_random_uuid();barber uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();
 b uuid:=gen_random_uuid();b2 uuid:=gen_random_uuid();b3 uuid:=gen_random_uuid();future uuid:=gen_random_uuid();cancelled uuid:=gen_random_uuid();small uuid:=gen_random_uuid();
 ac text;gc text;mc text;oc text;bc text;cc text;day date:=(clock_timestamp()at time zone'Asia/Kuwait')::date;
 payload jsonb;v jsonb;v2 jsonb;row jsonb;snapshot jsonb;sid uuid;sid2 uuid;receipt uuid;receipt2 uuid;future_r uuid;cancelled_r uuid;small_r uuid;pid uuid;refund uuid;new_refund uuid;event uuid;denied boolean;collection timestamptz;
 financial_before jsonb;billing_before jsonb;claims_before text;
begin
 perform pg_temp.sa(not has_table_privilege('authenticated','private.settlement_entries','SELECT'),'ledger hidden from authenticated');
 perform pg_temp.sa(not has_table_privilege('service_role','private.settlement_receipts','INSERT'),'service cannot insert money directly');
 perform pg_temp.sa(not has_function_privilege('anon','public.platform_settlements(text,jsonb)','EXECUTE'),'anonymous admin API denied');
 perform pg_temp.sa(not has_function_privilege('anon','public.shop_settlements(text,jsonb)','EXECUTE'),'anonymous manager API denied');
 perform pg_temp.sa(not has_function_privilege('authenticated','private.settlement_post(uuid,uuid,uuid,text,bigint,text,timestamptz,text,jsonb,uuid)','EXECUTE'),'clients cannot post journals');
 perform set_config('request.jwt.claims','{}',true);
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values
 (ad,ad||'@example.test',now(),'{"role":"admin"}'),(ag,ag||'@example.test',now(),'{"role":"agent"}'),
 (m,m||'@example.test',now(),'{"role":"manager"}'),(other_m,other_m||'@example.test',now(),'{"role":"manager"}'),
 (barber_user,barber_user||'@example.test',now(),'{"role":"barber"}'),(cu,cu||'@example.test',now(),'{"role":"customer"}');
 insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)values(af,ad,'totp','verified',now(),now()),(gf,ag,'totp','verified',now(),now());
 insert into auth.sessions(id,user_id,aal,factor_id)values(ads,ad,'aal2',af),(ags,ag,'aal2',gf),(ms,m,'aal1',null),(os,other_m,'aal1',null),(bs,barber_user,'aal1',null),(cs,cu,'aal1',null);
 ac:=jsonb_build_object('sub',ad,'session_id',ads,'role','authenticated','aal','aal2')::text;
 gc:=jsonb_build_object('sub',ag,'session_id',ags,'role','authenticated','aal','aal2')::text;
 mc:=jsonb_build_object('sub',m,'session_id',ms,'role','authenticated','aal','aal1')::text;
 oc:=jsonb_build_object('sub',other_m,'session_id',os,'role','authenticated','aal','aal1')::text;
 bc:=jsonb_build_object('sub',barber_user,'session_id',bs,'role','authenticated','aal','aal1')::text;
 cc:=jsonb_build_object('sub',cu,'session_id',cs,'role','authenticated','aal','aal1')::text;
 insert into public.branches(id,name,manager_id,status,city,governorate_id,area_id)values
 (shop,'Settlement isolated QA',m,'active','QA City',(select governorate_id from public.areas order by id limit 1),(select id from public.areas order by id limit 1)),
 (outside,'Settlement other QA',other_m,'active','QA City',(select governorate_id from public.areas order by id limit 1),(select id from public.areas order by id limit 1));
 insert into private.billing_access_grants(business_id,kind,starts_at,ends_at,reason,actor_id)
 select business_id,'full',clock_timestamp()-interval'1 hour',clock_timestamp()+interval'1 day','Settlement transactional QA',ad from private.billing_shops where branch_id in(shop,outside);
 insert into public.services(id,branch_id,name,duration,price)values(svc,shop,'Settlement QA service',30,100);
 insert into public.barbers(id,branch_id,name,status,management_mode,service_ids)values(barber,shop,'Settlement managed QA','active','managed',array[svc]);
 perform set_config('request.jwt.claims',mc,true);
 update public.barbers set availability=(select jsonb_object_agg(d,jsonb_build_object('enabled',true,'start','09:00','end','21:00'))from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])d)where id=barber;
 perform public.manage_shop_publication(shop,'publish','draft');
 perform set_config('request.jwt.claims','{}',true);
 insert into public.customers(id,name)values(customer,'Private synthetic name');
 insert into public.bookings(id,branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type)values
 (b,shop,barber,customer,day-2,'09:00',array[svc],30,100,'completed','customer'),
 (b2,shop,barber,customer,day-2,'10:00',array[svc],30,100,'completed','customer'),
 (b3,shop,barber,customer,day-2,'13:00',array[svc],30,100,'completed','customer'),
 (future,shop,barber,customer,day+2,'09:00',array[svc],30,100,'confirmed','customer'),
 (cancelled,shop,barber,customer,day-2,'11:00',array[svc],30,100,'cancelled','customer'),
 (small,shop,barber,customer,day-2,'12:00',array[svc],30,0.003,'completed','customer');
 select jsonb_build_array((select count(*)from private.shop_finance_entries),(select count(*)from private.shop_finance_runs))into financial_before;
 select to_jsonb(x)into billing_before from private.billing_subscriptions x where business_id=(select business_id from private.billing_shops where branch_id=shop);
 perform set_config('request.jwt.claims',ac,true);
 update private.settlement_runtime set enabled=false;
 perform pg_temp.sa(pg_temp.se('shops','{}','SETTLEMENT_DISABLED'),'runtime fails closed');
 update private.settlement_runtime set enabled=true;
 perform pg_temp.sa((select count(*)from private.settlement_receipts where shop_id=shop)=0,'no opening balance or backfill');
 perform pg_temp.sa(pg_temp.se('record-receipt',jsonb_build_object('shopId',shop,'bookingId',b,'amountFils','100000','reference','missing-policy','collectedAt',clock_timestamp()),'SETTLEMENT_POLICY_REQUIRED'),'unset commission and fee agreement fail closed');
 perform pg_temp.sw('save-policy','{"rateBps":500,"reason":"Explicit QA commission"}');
 perform pg_temp.sw('save-policy',jsonb_build_object('shopId',shop,'rateBps',null,'feeBearer','shop','reason','QA fee agreement'));
 perform pg_temp.sw('save-beneficiary',jsonb_build_object('shopId',shop,'payeeName','QA Beneficiary','beneficiaryRef','QA-verified-bank-id','ibanLastFour','1234','reason','QA bank verification'));
 collection:=clock_timestamp();
 payload:=jsonb_build_object('shopId',shop,'bookingId',b,'amountFils','100000','feeFils','1000','reference',b::text,'collectedAt',collection,'settledAt',collection,'requestId',gen_random_uuid());
 v:=public.platform_settlements('record-receipt',payload);receipt:=(v->>'id')::uuid;
 perform pg_temp.sa(public.platform_settlements('record-receipt',payload)=v,'identical retry returns same receipt');
 perform pg_temp.sa(pg_temp.se('record-receipt',payload||'{"amountFils":"1"}','SETTLEMENT_OVERPAYMENT'),'cannot collect over booking price');
 denied:=false;begin perform public.platform_settlements('record-receipt',payload||'{"amountFils":"1"}');exception when others then denied:=sqlerrm='SETTLEMENT_RETRY_CHANGED';end;
 perform pg_temp.sa(denied,'idempotent request cannot change payload');
 row:=private.settlement_receipt_json((select r from private.settlement_receipt_state r where id=receipt));
 perform pg_temp.sa(row->>'netFils'='94000'and row->>'commissionFils'='5000','100 less 5 percent and 1 fee gives 94');
 perform pg_temp.sa((row->>'eligible')::boolean,'completed ended settled known-fee receipt eligible');
 perform pg_temp.sa(not(row::text~'Private synthetic|email|phone|customerName'),'receipt excludes customer PII');
 perform pg_temp.sa(pg_temp.se('record-receipt',payload||jsonb_build_object('bookingId',b2,'requestId',gen_random_uuid()),'SETTLEMENT_DUPLICATE'),'receipt external reference unique');
 perform pg_temp.sa(pg_temp.se('record-receipt',payload||jsonb_build_object('shopId',outside,'requestId',gen_random_uuid()),'SETTLEMENT_BOOKING_REQUIRED'),'cannot attach receipt to another shop');
 perform pg_temp.sa(pg_temp.se('record-receipt',payload||jsonb_build_object('bookingId',b2,'amountFils','0','reference','zero','requestId',gen_random_uuid()),'SETTLEMENT_INVALID'),'zero receipt denied');
 perform pg_temp.sa(pg_temp.se('record-receipt',payload||jsonb_build_object('bookingId',b2,'amountFils','1.5','reference','fraction','requestId',gen_random_uuid()),'SETTLEMENT_INVALID'),'fractional fils denied');
 perform pg_temp.sa(pg_temp.se('record-receipt',payload||jsonb_build_object('bookingId',b2,'collectedAt',clock_timestamp()+interval'1 day','reference','future','requestId',gen_random_uuid()),'SETTLEMENT_INVALID'),'future collection denied');
 -- A later default never changes existing receipts.
 perform pg_temp.sw('save-policy','{"rateBps":1000,"reason":"Later default"}');
 perform pg_temp.sa((select commission_fils=5000 from private.settlement_receipts where id=receipt),'commission snapshotted');
 perform pg_temp.sw('save-policy',jsonb_build_object('shopId',shop,'rateBps',500,'feeBearer','platform','reason','Shop override and platform fees'));
 collection:=clock_timestamp();
 receipt2:=(pg_temp.sw('record-receipt',jsonb_build_object('shopId',shop,'bookingId',b2,'amountFils','100000','reference',b2::text,'collectedAt',collection,'settledAt',collection))->>'id')::uuid;
 perform pg_temp.sa((select not eligible and not fee_known from private.settlement_receipt_state where id=receipt2),'unknown fees block eligibility');
 perform pg_temp.sw('record-fee',jsonb_build_object('shopId',shop,'id',receipt2,'amountFils','1000','reference','qa-platform-fee'));
 perform pg_temp.sa((select net_fils=95000 and eligible from private.settlement_receipt_state where id=receipt2),'platform bears fee without reducing shop net');
 perform pg_temp.sw('record-fee',jsonb_build_object('shopId',shop,'id',receipt2,'amountFils','-500','reference','qa-fee-credit'));
 perform pg_temp.sa(pg_temp.se('record-fee',jsonb_build_object('shopId',shop,'id',receipt2,'amountFils','-501','reference','too-large-credit'),'SETTLEMENT_INVALID'),'fee credits cannot exceed actual fees');
 collection:=clock_timestamp();
 future_r:=(pg_temp.sw('record-receipt',jsonb_build_object('shopId',shop,'bookingId',future,'amountFils','1000','feeFils','0','reference',future::text,'collectedAt',collection,'settledAt',collection))->>'id')::uuid;
 cancelled_r:=(pg_temp.sw('record-receipt',jsonb_build_object('shopId',shop,'bookingId',cancelled,'amountFils','1000','feeFils','0','reference',cancelled::text,'collectedAt',collection))->>'id')::uuid;
 perform pg_temp.sa((select not eligible from private.settlement_receipt_state where id=future_r),'future booking cannot be paid out');
 perform pg_temp.sw('settle-receipt',jsonb_build_object('shopId',shop,'id',cancelled_r,'settledAt',clock_timestamp()));
 perform pg_temp.sa((select not eligible from private.settlement_receipt_state where id=cancelled_r),'cancelled booking cannot be paid out');
 perform pg_temp.sw('hold',jsonb_build_object('shopId',shop,'id',receipt,'reason','QA dispute hold'));
 perform pg_temp.sa((select not eligible and held from private.settlement_receipt_state where id=receipt),'hold removes eligibility');
 perform pg_temp.sw('release-hold',jsonb_build_object('shopId',shop,'id',receipt,'reason','QA resolved dispute'));
 v:=pg_temp.sw('prepare-statement',jsonb_build_object('shopId',shop,'period',date_trunc('month',day)::date));sid:=(v->>'id')::uuid;
 snapshot:=public.platform_settlements('statement',jsonb_build_object('id',sid,'shopId',shop));
 perform pg_temp.sa(snapshot->>'totalFils'='189000'and snapshot->>'lineCount'='2','only two eligible receipts in monthly draft');
 perform pg_temp.sw('hold',jsonb_build_object('shopId',shop,'id',receipt,'reason','Changed after preparation'));
 perform pg_temp.sa(pg_temp.se('finalize-statement',jsonb_build_object('shopId',shop,'id',sid,'fingerprint',snapshot->>'fingerprint'),'SETTLEMENT_STALE'),'changed receipt invalidates draft');
 perform pg_temp.sw('cancel-statement',jsonb_build_object('shopId',shop,'id',sid,'reason','Replace stale draft'));
 perform pg_temp.sw('release-hold',jsonb_build_object('shopId',shop,'id',receipt,'reason','Release QA hold'));
 sid:=(pg_temp.sw('prepare-statement',jsonb_build_object('shopId',shop,'period',date_trunc('month',day)::date))->>'id')::uuid;
 snapshot:=public.platform_settlements('statement',jsonb_build_object('id',sid,'shopId',shop));
 perform pg_temp.sw('finalize-statement',jsonb_build_object('shopId',shop,'id',sid,'fingerprint',snapshot->>'fingerprint'));
 perform pg_temp.sa((select state='final'from private.settlement_statements where id=sid),'reviewed statement finalized');
 perform pg_temp.sa(pg_temp.se('prepare-statement',jsonb_build_object('shopId',shop,'period',date_trunc('month',day)::date),'SETTLEMENT_NO_ITEMS'),'final receipts not duplicated into new statement');
 pid:=(pg_temp.sw('prepare-payout',jsonb_build_object('shopId',shop,'statementId',sid,'amountFils','50000'))->>'id')::uuid;
 perform pg_temp.sa((select sum(reserved_fils)=50000 from private.settlement_receipt_state where shop_id=shop),'prepared partial transfer reserves exactly amount');
 perform pg_temp.sa(pg_temp.se('prepare-payout',jsonb_build_object('shopId',shop,'statementId',sid,'amountFils','140000'),'SETTLEMENT_INSUFFICIENT'),'reserved money cannot be allocated twice');
 perform pg_temp.sa(pg_temp.se('save-beneficiary',jsonb_build_object('shopId',shop,'payeeName','Other','beneficiaryRef','Other','ibanLastFour','9876','reason','Changed beneficiary'),'SETTLEMENT_BENEFICIARY_BUSY'),'beneficiary frozen while transfer pending');
 perform pg_temp.sa(pg_temp.se('confirm-payout',jsonb_build_object('shopId',shop,'id',pid,'amountFils','49999','reference','qa-bank-1','transferredAt',clock_timestamp()),'SETTLEMENT_TRANSFER_MISMATCH'),'bank amount must match reservation');
 perform pg_temp.sw('confirm-payout',jsonb_build_object('shopId',shop,'id',pid,'amountFils','50000','reference','qa-bank-1','transferredAt',clock_timestamp()));
 perform pg_temp.sa((select sum(paid_fils)=50000 and sum(reserved_fils)=0 from private.settlement_receipt_state where shop_id=shop),'partial bank confirmation moves reservation to paid');
 pid:=(pg_temp.sw('prepare-payout',jsonb_build_object('shopId',shop,'statementId',sid,'amountFils','139000'))->>'id')::uuid;
 perform pg_temp.sw('record-refund',jsonb_build_object('shopId',shop,'id',receipt,'amountFils','20000','reference','qa-refund-20','reason','QA customer refund'));
 perform pg_temp.sa((select net_fils=75000 and current_commission_fils=4000 from private.settlement_receipt_state where id=receipt),'partial refund reverses commission proportionally');
 perform pg_temp.sa(pg_temp.se('confirm-payout',jsonb_build_object('shopId',shop,'id',pid,'amountFils','139000','reference','qa-bank-stale','transferredAt',clock_timestamp()),'SETTLEMENT_REVIEW_REQUIRED'),'refund blocks stale prepared transfer');
 perform pg_temp.sw('cancel-payout',jsonb_build_object('shopId',shop,'id',pid,'reason','Recalculate after refund'));
 pid:=(pg_temp.sw('prepare-payout',jsonb_build_object('shopId',shop,'statementId',sid,'amountFils','120000'))->>'id')::uuid;
 perform pg_temp.sw('uncertain-payout',jsonb_build_object('shopId',shop,'id',pid,'reason','Bank timed out'));
 perform pg_temp.sa(pg_temp.se('cancel-payout',jsonb_build_object('shopId',shop,'id',pid,'reason','Cannot just release'),'SETTLEMENT_UNCERTAIN'),'unknown bank outcome remains reserved');
 perform pg_temp.sw('fail-payout',jsonb_build_object('shopId',shop,'id',pid,'reason','Bank confirmed failure'));
 perform pg_temp.sa((select sum(reserved_fils)=0 from private.settlement_receipt_state where shop_id=shop),'bank failure releases reservations');
 pid:=(pg_temp.sw('prepare-payout',jsonb_build_object('shopId',shop,'statementId',sid,'amountFils','120000'))->>'id')::uuid;
 perform pg_temp.sw('confirm-payout',jsonb_build_object('shopId',shop,'id',pid,'amountFils','120000','reference','qa-bank-2','transferredAt',clock_timestamp()));
 perform pg_temp.sw('record-refund',jsonb_build_object('shopId',shop,'id',receipt,'amountFils','10000','reference','qa-post-payout-refund','reason','Refund after settlement'));
 perform pg_temp.sa((select remaining_fils=-9500 from private.settlement_receipt_state where id=receipt),'post payout refund creates recoverable negative balance');
 perform pg_temp.sa((select total_fils=189000 from private.settlement_statements where id=sid),'final statement original total immutable after refunds');
 v:=public.platform_settlements('statement',jsonb_build_object('id',sid,'shopId',shop));
 perform pg_temp.sa(v->>'currentFils'='160500'and v->>'paidFils'='170000','statement shows adjustment separately from actual paid');
 perform pg_temp.sa(pg_temp.se('prepare-payout',jsonb_build_object('shopId',shop,'statementId',sid,'amountFils','1'),'SETTLEMENT_INSUFFICIENT'),'negative shop cannot withdraw more');
 -- Full refund rounding at fils precision; commission returns exactly to zero.
 perform pg_temp.sw('save-policy',jsonb_build_object('shopId',shop,'rateBps',3333,'reason','Small value rounding'));
 collection:=clock_timestamp();
 small_r:=(pg_temp.sw('record-receipt',jsonb_build_object('shopId',shop,'bookingId',small,'amountFils','3','feeFils','0','reference',small::text,'collectedAt',collection,'settledAt',collection))->>'id')::uuid;
 perform pg_temp.sw('record-refund',jsonb_build_object('shopId',shop,'id',small_r,'amountFils','1','reference','small-1','reason','Rounding check one'));
 perform pg_temp.sw('record-refund',jsonb_build_object('shopId',shop,'id',small_r,'amountFils','1','reference','small-2','reason','Rounding check two'));
 perform pg_temp.sw('record-refund',jsonb_build_object('shopId',shop,'id',small_r,'amountFils','1','reference','small-3','reason','Rounding check three'));
 perform pg_temp.sa((select net_fils=0 and current_commission_fils=0 from private.settlement_receipt_state where id=small_r),'three partial refunds reverse exact rounded commission');
 perform pg_temp.sa(pg_temp.se('record-refund',jsonb_build_object('shopId',shop,'id',small_r,'amountFils','1','reference','overrefund','reason','Must reject excess'),'SETTLEMENT_INVALID'),'over-refund rejected');
 select id into event from private.settlement_journals where receipt_id=small_r and external_ref='small-1';
 perform pg_temp.sa(pg_temp.se('reverse-event',jsonb_build_object('shopId',shop,'id',small_r,'eventId',event,'reason','Out of order'),'SETTLEMENT_REVERSE_LATEST_FIRST'),'refund corrections reverse latest first');
 select id into event from private.settlement_journals where receipt_id=small_r and external_ref='small-3';
 perform pg_temp.sw('reverse-event',jsonb_build_object('shopId',shop,'id',small_r,'eventId',event,'reason','QA correction'));
 perform pg_temp.sa(pg_temp.se('reverse-event',jsonb_build_object('shopId',shop,'id',small_r,'eventId',event,'reason','Duplicate correction'),'SETTLEMENT_STATE'),'correction cannot repeat');
 perform pg_temp.sa((select net_fils=1 from private.settlement_receipt_state where id=small_r),'correction restores net without deleting event');
 perform pg_temp.sa(not exists(select 1 from private.settlement_journals j join private.settlement_entries e on e.journal_id=j.id group by j.id having sum(e.signed_fils)<>0),'every journal balances exactly');
 -- New earnings recover a previous payout's refund before any cash leaves.
 perform pg_temp.sw('save-policy',jsonb_build_object('shopId',shop,'rateBps',500,'reason','New earnings policy'));
 collection:=clock_timestamp();
 perform pg_temp.sw('record-receipt',jsonb_build_object('shopId',shop,'bookingId',b3,'amountFils','100000','feeFils','0','reference',b3::text,'collectedAt',collection,'settledAt',collection));
 sid2:=(pg_temp.sw('prepare-statement',jsonb_build_object('shopId',shop,'period',date_trunc('month',day)::date))->>'id')::uuid;
 v:=public.platform_settlements('statement',jsonb_build_object('id',sid2,'shopId',shop));
 perform pg_temp.sw('finalize-statement',jsonb_build_object('shopId',shop,'id',sid2,'fingerprint',v->>'fingerprint'));
 perform pg_temp.sa(pg_temp.se('prepare-payout',jsonb_build_object('shopId',shop,'statementId',sid2,'amountFils','95001'),'SETTLEMENT_INSUFFICIENT'),'new earnings cannot bypass prior refund debt');
 pid:=(pg_temp.sw('prepare-payout',jsonb_build_object('shopId',shop,'statementId',sid2,'amountFils','85501'))->>'id')::uuid;
 perform pg_temp.sa((select sum(amount_fils)=85501 and min(amount_fils)=-9500 from private.settlement_allocations where payout_id=pid),'reservation includes negative recovery allocation');
 perform pg_temp.sw('confirm-payout',jsonb_build_object('shopId',shop,'id',pid,'amountFils','85501','reference','qa-bank-recovery','transferredAt',clock_timestamp()));
 perform pg_temp.sa((select remaining_fils=0 from private.settlement_receipt_state where id=receipt),'new payout clears old refund debt');
 perform pg_temp.sa((select sum(remaining_fils)=0 from private.settlement_receipt_state where shop_id=shop and statement_id is not null),'cash and recovery allocations reconcile finalized balances');
 denied:=false;begin update private.settlement_receipts set amount_fils=1 where id=receipt;exception when others then denied:=sqlerrm='SETTLEMENT_IMMUTABLE';end;
 perform pg_temp.sa(denied,'receipt monetary facts cannot be rewritten');
 denied:=false;begin update private.settlement_statements set total_fils=1 where id=sid;exception when others then denied:=sqlerrm='SETTLEMENT_IMMUTABLE';end;
 perform pg_temp.sa(denied,'final statement cannot be rewritten');
 denied:=false;begin update private.settlement_payouts set state='failed'where id=pid;exception when others then denied:=sqlerrm='SETTLEMENT_IMMUTABLE';end;
 perform pg_temp.sa(denied,'confirmed bank transfer cannot be rewritten');
 -- Read/write authorization, including real invoker role and live MFA checks.
 perform set_config('request.jwt.claims',gc,true);execute 'set local role authenticated';
 v:=public.platform_settlements('statement',jsonb_build_object('id',sid,'shopId',shop));execute 'reset role';
 perform pg_temp.sa(v->>'id'=sid::text,'Admin has settlement access through invoker wrapper');
 execute 'set local role authenticated';
 v:=public.platform_settlements('record-receipt',jsonb_build_object('shopId',shop,'bookingId',future,'amountFils','1','feeFils','0','reference','authenticated-commit-proof','collectedAt',clock_timestamp(),'requestId',gen_random_uuid()));
 execute 'set constraints all immediate';
 execute 'reset role';
 perform pg_temp.sa(v->>'id'is not null,'actual authenticated write validates deferred balances at commit');

 perform set_config('request.jwt.claims',mc,true);execute 'set local role authenticated';
 v:=public.shop_settlements('statement',jsonb_build_object('id',sid,'shopId',shop));execute 'reset role';
 perform pg_temp.sa(v->>'id'=sid::text,'manager reads own final statement');
 perform pg_temp.sa(pg_temp.se('settings',jsonb_build_object('shopId',shop),'SETTLEMENT_FORBIDDEN',false),'manager cannot read internal bank configuration');
 perform pg_temp.sa(pg_temp.se('record-refund',jsonb_build_object('shopId',shop),'SETTLEMENT_FORBIDDEN',false),'manager cannot write platform money');
 perform pg_temp.sa(pg_temp.se('shops','{}','SETTLEMENT_FORBIDDEN'),'manager cannot call admin wrapper');
 perform pg_temp.sa(not(public.shop_settlements('payouts',jsonb_build_object('shopId',shop))::text like '%QA-verified-bank-id%'),'bank internal reference hidden from manager');
 perform pg_temp.sa(not(public.shop_settlements('history',jsonb_build_object('shopId',shop))::text like '%QA customer refund%'),'internal reasons hidden from manager');
 perform set_config('request.jwt.claims',oc,true);
 perform pg_temp.sa(pg_temp.se('statement',jsonb_build_object('id',sid,'shopId',shop),'SETTLEMENT_FORBIDDEN',false),'other manager cannot read shop statement');
 perform set_config('request.jwt.claims',bc,true);perform pg_temp.sa(pg_temp.se('shops','{}','SETTLEMENT_FORBIDDEN',false),'barber denied');
 perform set_config('request.jwt.claims',cc,true);perform pg_temp.sa(pg_temp.se('shops','{}','SETTLEMENT_FORBIDDEN',false),'customer denied');
 perform pg_temp.sa(billing_before=(select to_jsonb(x)from private.billing_subscriptions x where business_id=(select business_id from private.billing_shops where branch_id=shop)),'subscriptions unchanged by settlements');
 perform set_config('request.jwt.claims','{}',true);update public.branches set manager_id=other_m where id=shop;perform set_config('request.jwt.claims',mc,true);
 perform pg_temp.sa(pg_temp.se('statement',jsonb_build_object('id',sid,'shopId',shop),'SETTLEMENT_FORBIDDEN',false),'old manager immediately loses access after transfer');
 perform set_config('request.jwt.claims',oc,true);
 perform pg_temp.sa(public.shop_settlements('statement',jsonb_build_object('id',sid,'shopId',shop))->>'id'=sid::text,'new manager can read existing history');
 perform pg_temp.sa((select beneficiary_ref='QA-verified-bank-id'from private.settlement_beneficiaries where shop_id=shop),'manager transfer does not redirect beneficiary');
 perform set_config('request.jwt.claims','{}',true);update auth.users set banned_until=clock_timestamp()+interval'1 hour'where id=other_m;perform set_config('request.jwt.claims',oc,true);
 perform pg_temp.sa(pg_temp.se('shops','{}','SETTLEMENT_FORBIDDEN',false),'suspended manager denied');
 perform set_config('request.jwt.claims',ac,true);
 update auth.sessions set aal='aal1',factor_id=null where id=ads;
 perform pg_temp.sa(pg_temp.se('shops','{}','SETTLEMENT_FORBIDDEN'),'Admin without live MFA denied');
 perform set_config('request.jwt.claims','{}',true);
 perform pg_temp.sa(financial_before=jsonb_build_array((select count(*)from private.shop_finance_entries),(select count(*)from private.shop_finance_runs)),'shop Finances unchanged');
 perform pg_temp.sa(not exists(select 1 from pg_constraint where conrelid in('private.settlement_receipts'::regclass,'private.settlement_journals'::regclass)and confrelid in('public.customers'::regclass,'auth.users'::regclass)),'financial preservation does not prevent identity deletion');
 set constraints all immediate;
end$test$;
select ok((select count(*)from settlement_checks)>=60,'Settlement financial and authorization checks: '||(select count(*)from settlement_checks));
select *from finish();
rollback;
