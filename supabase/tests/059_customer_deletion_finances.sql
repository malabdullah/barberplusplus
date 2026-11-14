-- New disposable identities only; every record and configuration change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(1);
create temp table deletion_finance_checks(label text);
create function pg_temp.check_deletion_finance(ok boolean,label text)returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'DELETION_FINANCE_ASSERT: %',label;end if;
 insert into deletion_finance_checks values(label);end $$;
do $test$
#variable_conflict use_variable
declare
 u uuid:=gen_random_uuid();m uuid:=gen_random_uuid();o uuid:=gen_random_uuid();ms uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();
 c uuid:=gen_random_uuid();oc uuid:=gen_random_uuid();shop uuid:=gen_random_uuid();chair uuid:=gen_random_uuid();svc uuid:=gen_random_uuid();
 past uuid:=gen_random_uuid();future uuid:=gen_random_uuid();other_booking uuid:=gen_random_uuid();job uuid:=gen_random_uuid();
 payment uuid;refund uuid;correction uuid;deposit uuid;other_payment uuid;expense uuid;expense_payment uuid;run uuid;
 claims text;today date:=(clock_timestamp()at time zone'Asia/Kuwait')::date;
 value jsonb;data jsonb;first_request jsonb;scope jsonb;preview jsonb;before_report jsonb;after_report jsonb;op jsonb;reply jsonb;
 fingerprint text;monetary_before jsonb;denied boolean;
begin
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values
 (u,u||'@example.test',now(),'{"role":"customer","deletion_qa":true}'),
 (m,m||'@example.test',now(),'{"role":"manager","deletion_qa":true}'),
 (o,o||'@example.test',now(),'{"role":"customer","deletion_qa":true}');
 insert into auth.sessions(id,user_id)values(sid,u),(ms,m);
 insert into public.customers(id,name,email)values(c,'Private deletion finance name',u||'@example.test'),(oc,'Other customer',o||'@example.test');
 insert into private.customer_accounts(user_id,customer_id)values(u,c),(o,oc);
 insert into public.branches(id,manager_id,name,status)values(shop,m,'Deletion finance fixture','active');
 insert into public.services(id,branch_id,name,duration,price)values(svc,shop,'Fixture cut',30,10);
 insert into public.barbers(id,branch_id,name,status,service_ids)values(chair,shop,'Fixture barber','active',array[svc]);
 insert into public.bookings(id,branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type,notes)values
 (past,shop,chair,c,today-2,'10:00',array[svc],30,10,'completed','customer','Private past note'),
 (future,shop,chair,c,today+2,'10:00',array[svc],30,15,'confirmed','customer','Private future note'),
 (other_booking,shop,chair,oc,today-2,'11:00',array[svc],30,5,'completed','customer','Other note');
 claims:=jsonb_build_object('sub',m,'session_id',ms,'role','authenticated','aal','aal1')::text;
 perform set_config('request.jwt.claims',claims,true);
 first_request:=jsonb_build_object('shopId',shop,'requestId',gen_random_uuid(),'bookingId',past,'kind','receipt','amountFils','6000','date',today,'method','cash','reference','Private customer reference','reason','Private customer name');
 value:=public.manager_finances('record',first_request);payment:=(value->>'id')::uuid;
 data:=first_request||jsonb_build_object('requestId',gen_random_uuid(),'kind','refund','amountFils','1000','reason','Private refund note');
 refund:=(public.manager_finances('record',data)->>'id')::uuid;
 correction:=(public.manager_finances('reverse',jsonb_build_object('shopId',shop,'requestId',gen_random_uuid(),'entryId',refund,'date',today,'reason','Private correction note'))->>'id')::uuid;
 deposit:=(public.manager_finances('record',first_request||jsonb_build_object('requestId',gen_random_uuid(),'bookingId',future,'amountFils','3000'))->>'id')::uuid;
 other_payment:=(public.manager_finances('record',first_request||jsonb_build_object('requestId',gen_random_uuid(),'bookingId',other_booking,'amountFils','1000','reference','Other reference','reason','Other reason'))->>'id')::uuid;
 expense:=(public.manager_finances('expense',jsonb_build_object('shopId',shop,'requestId',gen_random_uuid(),'amountFils','2000','category','supplies','description','Unrelated supplies','date',today))->>'id')::uuid;
 expense_payment:=(public.manager_finances('record',jsonb_build_object('shopId',shop,'requestId',gen_random_uuid(),'expenseId',expense,'kind','expense_payment','amountFils','500','date',today,'method','cash','reference','Supplier reference','reason','Supplier reason'))->>'id')::uuid;
 before_report:=public.manager_finances('generate',jsonb_build_object('from',today-3,'to',today));run:=(before_report->>'id')::uuid;
 op:=public.staff_reports('build',public.staff_reports('create',jsonb_build_object('preset','custom','from',today-3,'to',today,'type','overview')));
 perform pg_temp.check_deletion_finance(op->>'state'='ready','operational report builds before erasure');
 select jsonb_agg(to_jsonb(e)-'reference'-'reason'order by id)into monetary_before from private.shop_finance_entries e where booking_id in(past,future);
 perform pg_temp.check_deletion_finance(exists(select 1 from private.shop_finance_rows where run_id=run and payload->>'paymentReference'='Private customer reference'),'financial snapshot originally contains scoped free text');
 perform set_config('request.jwt.claims','{}',true);
 update private.customer_deletion_runtime set deployment_environment='cloud-test',test_mode=true,function_url='https://qvkucvcjmojjbphlzlks.supabase.co/functions/v1/customer-account-deletion',allowed_test_users=array[u]where singleton;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 scope:=jsonb_build_object('id',job,'user_id',u,'session_id',sid,'receipt_hash',repeat('a',64),'receipt_box','synthetic-recovery','code_hash',repeat('b',64));
 preview:=public.customer_deletion_service('preview',scope);
 perform public.customer_deletion_service('start',scope);
 perform public.customer_deletion_service('verify',scope);
 value:=public.customer_deletion_service('confirm',scope||jsonb_build_object('digest',preview->>'digest','confirmCancellation',true));
 perform pg_temp.check_deletion_finance(value->>'state'='cleanup_pending','erasure enters durable cleanup');
 perform pg_temp.check_deletion_finance((select jsonb_agg(to_jsonb(e)-'reference'-'reason'order by id)from private.shop_finance_entries e where booking_id in(past,future))=monetary_before,'every accounting amount date method actor and correction link preserved');
 perform pg_temp.check_deletion_finance(not exists(select 1 from private.shop_finance_entries where booking_id in(past,future)and(reference<>''or reason<>'')),'payment refund deposit and reversal text removed');
 perform pg_temp.check_deletion_finance((select reference='Other reference'and reason='Other reason'from private.shop_finance_entries where id=other_payment),'other customer ledger text preserved');
 perform pg_temp.check_deletion_finance((select reference='Supplier reference'and reason='Supplier reason'from private.shop_finance_entries where id=expense_payment),'expense ledger text preserved');
 perform pg_temp.check_deletion_finance((select amount_fils=2000 and description='Unrelated supplies'from private.shop_finance_expenses where id=expense),'expense amounts and description preserved');
 perform pg_temp.check_deletion_finance(not exists(select 1 from private.shop_finance_rows where run_id=run and payload::text like '%Private%'),'existing financial snapshot text redacted');
 perform pg_temp.check_deletion_finance((select result=before_report from private.shop_finance_runs where id=run),'frozen report totals preserved');
 perform pg_temp.check_deletion_finance((select count(*)from private.shop_finance_requests where id in(payment,refund,correction,deposit)and request ? '_deletedCustomerHash')=4,'customer request caches contain one-way retry fingerprints only');
 perform pg_temp.check_deletion_finance((select request #>> '{data,reference}'='Other reference'from private.shop_finance_requests where id=other_payment),'other customer request cache preserved');
 perform pg_temp.check_deletion_finance((select state='failed'and error_code='REPORT_SOURCE_DELETED'and result is null from private.staff_report_runs where id=(op->>'id')::uuid),'operational snapshot invalidated after source erasure');
 perform pg_temp.check_deletion_finance(not exists(select 1 from private.staff_report_rows where run_id=(op->>'id')::uuid and payload::text like '%Private deletion finance name%'),'operational detail is anonymous');
 perform pg_temp.check_deletion_finance((select status='cancelled'and customer_deleted_at is not null from public.bookings where id=future),'future paid booking cancelled without deleting its deposit');
 perform pg_temp.check_deletion_finance((select status='completed'and price=10 and duration=30 from public.bookings where id=past),'completed sale survives unchanged');
 perform pg_temp.check_deletion_finance(not exists(select 1 from auth.sessions where user_id=u),'deleted customer sessions revoked');
 perform pg_temp.check_deletion_finance(exists(select 1 from auth.sessions where id=ms),'manager session remains live');
 perform set_config('request.jwt.claims',claims,true);
 perform pg_temp.check_deletion_finance(public.manager_finances('record',first_request)=jsonb_build_object('id',payment),'lost-response retry still returns original payment');
 denied:=false;begin perform public.manager_finances('record',first_request||'{"amountFils":"5000"}');exception when others then assert sqlerrm='FINANCE_DUPLICATE',sqlerrm;denied:=true;end;
 perform pg_temp.check_deletion_finance(denied,'changed retry rejected without a second payment');
 after_report:=public.manager_finances('generate',jsonb_build_object('from',today-3,'to',today));
 perform pg_temp.check_deletion_finance(after_report->'summary'->>'salesFils'=before_report->'summary'->>'salesFils','regenerated financial sales unchanged');
 perform pg_temp.check_deletion_finance(after_report->'summary'->>'netReceiptsFils'=before_report->'summary'->>'netReceiptsFils','regenerated receipts and refunds unchanged');
 perform pg_temp.check_deletion_finance(after_report->'summary'->>'cashFlowFils'=before_report->'summary'->>'cashFlowFils','regenerated cash flow unchanged');
 perform pg_temp.check_deletion_finance(after_report->'summary'->>'creditFils'='3000','cancelled deposit remains a refund liability');
 data:=jsonb_build_object('shopId',shop,'requestId',gen_random_uuid(),'bookingId',future,'kind','refund','amountFils','1000','date',today,'method','cash','reference','Private reintroduced reference','reason','Private reintroduced reason');
 reply:=public.manager_finances('record',data);
 perform pg_temp.check_deletion_finance((select reference=''and reason=''and signed_fils=-1000 from private.shop_finance_entries where id=(reply->>'id')::uuid),'later refund allowed without reintroducing personal text');
 perform pg_temp.check_deletion_finance(public.manager_finances('record',data)=reply,'later refund exact retry remains idempotent');
 perform pg_temp.check_deletion_finance((select request ? '_deletedCustomerHash'and not(request::text like '%Private%')from private.shop_finance_requests where id=(reply->>'id')::uuid),'later refund cache contains no original request text');
 data:=first_request||jsonb_build_object('requestId',gen_random_uuid(),'amountFils','1000');reply:=public.manager_finances('record',data);
 perform pg_temp.check_deletion_finance((select reference=''and reason=''and signed_fils=1000 from private.shop_finance_entries where id=(reply->>'id')::uuid),'outstanding completed sale can still receive payment anonymously');
 perform pg_temp.check_deletion_finance(public.manager_finances('record',data)=reply,'later receipt exact retry remains idempotent');
 after_report:=public.staff_reports('build',public.staff_reports('create',jsonb_build_object('preset','custom','from',today-3,'to',today,'type','overview')));
 perform pg_temp.check_deletion_finance(after_report->>'state'='ready'and after_report->'result'->'summary'->>'salesFils'=op->'result'->'summary'->>'salesFils','regenerated operational sales remain correct');
 perform pg_temp.check_deletion_finance(not has_function_privilege('service_role','private.scrub_deleted_customer_finances(uuid[])','execute'),'no standalone service bypass to finance erasure');
 perform pg_temp.check_deletion_finance(not has_function_privilege('authenticated','private.scrub_deleted_customer_finances(uuid[])','execute'),'customer and staff cannot directly invoke privacy helper');
 perform pg_temp.check_deletion_finance(exists(select 1 from auth.users where id=o)and exists(select 1 from public.customers where id=oc and name='Other customer'),'other account and profile remain intact');
end $test$;
select ok(count(*)>=30,'deletion preserves accounting and report totals, removes linked text, protects retries, and isolates other accounts')from deletion_finance_checks;
select *from finish();
rollback;
