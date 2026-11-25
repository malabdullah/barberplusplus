-- Hosted Test only. Creates disposable fixtures inside this rollback transaction; no login credentials or provider calls.
begin;
create temporary table mf_check_result(total integer);
create temporary table mf_matrix_checks(scenario text);
create function pg_temp.mfa(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'MYFATOORAH_MATRIX: %',label;end if;
 insert into mf_matrix_checks values(label);
end $$;
create function pg_temp.mfe(statement text,code text) returns boolean language plpgsql as $$begin
 execute statement;return false;
 exception when others then if sqlerrm<>code then raise exception 'Expected %, got %',code,sqlerrm;end if;return true;
end $$;
do $test$
<<qa>>
declare
 f myfatoorah_test.fixture%rowtype;
 other_id uuid;
 sid uuid;
 q jsonb;
 a jsonb;
 saved jsonb;
 request_id uuid := gen_random_uuid();
 aid uuid;
 checks integer := 0;
 original_capacity integer;
 manager uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); shop uuid:=gen_random_uuid(); outside_shop uuid:=gen_random_uuid();
 manager_session uuid:=gen_random_uuid(); owner_claims text; code uuid:=gen_random_uuid(); code_text text:='MF'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 service uuid:=gen_random_uuid(); workers uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 period_start timestamptz; period_end timestamptz; capacity_quote jsonb; count_before integer; index integer;
begin
 if to_regclass('private.cloud_test_emails') is null then raise exception 'TEST_ONLY'; end if;
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
  (manager,manager||'@example.test',now(),'{"role":"manager"}'),(outsider,outsider||'@example.test',now(),'{"role":"manager"}');
 insert into auth.sessions(id,user_id,aal) values(manager_session,manager,'aal1');
 insert into public.branches(id,manager_id,name,status,publication_state) values
  (shop,manager,'MyFatoorah Matrix QA','active','draft'),(outside_shop,outsider,'MyFatoorah Outside QA','active','draft');
 insert into private.billing_discount_codes(id,code,kind,value,eligibility,payments,expires_at) values
  (code,code_text,'percent',50,'both',1,clock_timestamp()+interval '1 day');
 insert into myfatoorah_test.fixture(business_id,branch_id,manager_id,code_id,enabled)
  select business_id,branch_id,case when branch_id=shop then manager else outsider end,
   case when branch_id=shop then code end,true from private.billing_shops where branch_id in(shop,outside_shop);
 select * into strict f from myfatoorah_test.fixture where branch_id=shop;
 select business_id into strict other_id from myfatoorah_test.fixture where branch_id=outside_shop;
 sid:=manager_session;
 owner_claims:=jsonb_build_object('sub',manager,'session_id',sid,'role','authenticated','aal','aal1')::text;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.manager_id,'session_id',sid,'role','authenticated','aal','aal1')::text,true);
 if not (public.myfatoorah_test_manager('read',jsonb_build_object('businessId',f.business_id))->>'eligible')::boolean then raise exception 'OWN_READ'; end if; checks:=checks+1;
 if (public.myfatoorah_test_manager('read',jsonb_build_object('businessId',other_id))->>'eligible')::boolean then raise exception 'FOREIGN_READ'; end if; checks:=checks+1;
 begin
  perform public.myfatoorah_test_manager('quote',jsonb_build_object('businessId',other_id,'count',3,'frequency','monthly'));
  raise exception 'FOREIGN_QUOTE_ALLOWED';
 exception when insufficient_privilege then checks:=checks+1; end;

 perform pg_temp.mfa((public.myfatoorah_test_manager('quote',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','yearly'))->>'totalFils')::bigint=private.billing_price(3,'yearly'),'yearly total uses the canonical annual price');
 for index in 1..5 loop
  perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''quote'',%L::jsonb)',
   jsonb_build_object('businessId',f.business_id,'count',case when index=1 then 0 when index=2 then 101 else 3 end,'frequency',case when index=3 then 'weekly' else 'monthly' end,'paymentMethod',case when index=4 then 'BAD' else 'KNET' end)
    ||case when index=5 then '{"count":"not-a-number"}'::jsonb else '{}'::jsonb end),'MYFATOORAH_INVALID'),'invalid count/frequency/method rejected '||index);
 end loop;
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''quote'',%L::jsonb)',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code','MISSING_CODE')),'BILLING_CODE_UNAVAILABLE'),'unknown discount rejected');
 update private.billing_discount_codes set enabled=false where id=qa.code;
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''quote'',%L::jsonb)',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code',code_text)),'BILLING_CODE_UNAVAILABLE'),'disabled discount rejected');
 update private.billing_discount_codes set enabled=true,expires_at=now()-interval '1 second' where id=qa.code;
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''quote'',%L::jsonb)',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code',code_text)),'BILLING_CODE_UNAVAILABLE'),'expired discount rejected');
 update private.billing_discount_codes set expires_at=now()+interval '1 day',eligibility='monthly' where id=qa.code;
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''quote'',%L::jsonb)',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','yearly','code',code_text)),'BILLING_CODE_UNAVAILABLE'),'monthly-only discount cannot fund annual term');
 update private.billing_discount_codes set eligibility='both',kind='fixed',value=1000 where id=qa.code;
 perform pg_temp.mfa(public.myfatoorah_test_manager('quote',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code',code_text))->>'discountFils'='1000','fixed discount retains exact fils');
 update private.billing_discount_codes set kind='percent',value=100 where id=qa.code;
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''quote'',%L::jsonb)',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code',code_text)),'MYFATOORAH_ZERO_TOTAL'),'zero-charge gateway invoice refused');
 update private.billing_discount_codes set value=50 where id=qa.code;
 perform set_config('request.jwt.claims','{}',true);
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''read'',%L::jsonb)',jsonb_build_object('businessId',f.business_id)),'MYFATOORAH_FORBIDDEN'),'missing live manager session denied');
 perform set_config('request.jwt.claims',owner_claims,true);
 update auth.sessions set not_after=now()-interval '1 minute' where id=sid;
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''read'',%L::jsonb)',jsonb_build_object('businessId',f.business_id)),'MYFATOORAH_FORBIDDEN'),'expired manager session denied');
 update auth.sessions set not_after=null where id=sid;
 q:=public.myfatoorah_test_manager('quote',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code',code_text,'paymentMethod','CARD'));
 if (q->>'totalFils')::bigint<>private.billing_price(3,'monthly')/2 or q->>'paymentMethod'<>'CARD' then raise exception 'CANONICAL_QUOTE'; end if; checks:=checks+1;
 begin
  perform public.myfatoorah_test_manager('start',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code',code_text,'paymentMethod','CARD','requestId',request_id,'quote',q||'{"totalFils":1}'));
  raise exception 'TAMPER_ALLOWED';
 exception when raise_exception then if sqlerrm<>'MYFATOORAH_QUOTE_CHANGED' then raise; end if;checks:=checks+1;end;
 a:=public.myfatoorah_test_manager('start',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code',code_text,'paymentMethod','CARD','requestId',request_id,'quote',q));
 aid:=(a->'attempt'->>'id')::uuid;
 saved:=public.myfatoorah_test_manager('start',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code',code_text,'paymentMethod','CARD','requestId',request_id,'quote',q));
 if saved->'attempt'->>'id'<>aid::text then raise exception 'DUPLICATE_START'; end if;checks:=checks+1;
 if not public.myfatoorah_test_provider('claim-create',aid,'{}')::boolean then raise exception 'CLAIM'; end if;checks:=checks+1;
 if public.myfatoorah_test_provider('claim-create',aid,'{}')::boolean then raise exception 'DOUBLE_CLAIM'; end if;checks:=checks+1;
 perform public.myfatoorah_test_provider('attach',aid,'{"sessionId":"123456789","checkoutUrl":"https://demo.myfatoorah.com/KWT/ie/test"}');
 begin
  perform public.myfatoorah_test_provider('capture',aid,jsonb_build_object('orderId',aid,'sessionId','123456789','trackId','999999999','currency','KWD','totalFils',1));raise exception 'TAMPER_CAPTURE_ALLOWED';
 exception when raise_exception then if sqlerrm<>'MYFATOORAH_PROVIDER_MISMATCH' then raise;end if;checks:=checks+1;end;
 a:=public.myfatoorah_test_provider('capture',aid,jsonb_build_object('orderId',aid,'sessionId','123456789','trackId','999999999','currency','KWD','totalFils',q->'totalFils'));
 if a->>'state'<>'paid' or a->>'invoiceId' is null then raise exception 'CAPTURE';end if;checks:=checks+1;
 perform public.myfatoorah_test_provider('capture',aid,jsonb_build_object('orderId',aid,'sessionId','123456789','trackId','999999999','currency','KWD','totalFils',q->'totalFils'));
 if (select count(*) from private.billing_invoices where business_id=f.business_id)<>1 then raise exception 'DUPLICATE_RECEIPT';end if;checks:=checks+1;
 if (select paid_capacity from private.billing_subscriptions where business_id=f.business_id)<>3 then raise exception 'CAPACITY';end if;checks:=checks+1;
 q:=public.myfatoorah_test_manager('quote',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',4,'paymentMethod','KNET'));
 if q->>'kind'<>'capacity' or (q->>'totalFils')::bigint<=0 or (q->>'fromCapacity')::integer<>3 then raise exception 'PRORATION';end if;checks:=checks+1;
 if has_function_privilege('anon','public.myfatoorah_test_manager(text,jsonb)','execute') then raise exception 'ANON';end if;checks:=checks+1;
 if has_function_privilege('authenticated','public.myfatoorah_test_provider(text,uuid,jsonb)','execute') then raise exception 'BROWSER_CAPTURE';end if;checks:=checks+1;
 if has_table_privilege('authenticated','myfatoorah_test.attempts','select') or has_table_privilege('service_role','myfatoorah_test.attempts','update') then raise exception 'DIRECT_TABLE';end if;checks:=checks+1;

 perform pg_temp.mfa(checks=16,'sixteen original subscription/ownership/idempotency/privilege checks');
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''quote'',%L::jsonb)',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly')),'MYFATOORAH_TERM_ACTIVE'),'active term cannot be replaced by another subscription');
 perform set_config('request.jwt.claims','{}',true);
 insert into public.services(id,branch_id,name,duration,price) values(service,shop,'Matrix haircut',30,5);
 for index in 1..4 loop
  insert into public.barbers(id,branch_id,name,status,management_mode,service_ids,availability,availability_approved_at)
   values(workers[index],shop,'Matrix barber '||index,'inactive','managed',array[service],'{"monday":{"enabled":true,"start":"09:00","end":"17:00"}}',now());
 end loop;
 perform set_config('request.jwt.claims',owner_claims,true);
 update public.barbers set status='active' where id=any(workers[1:3]);
 perform pg_temp.mfa(pg_temp.mfe(format('update public.barbers set status=''active'' where id=%L',workers[4]),'BILLING_CAPACITY_REQUIRED'),'fourth barber blocked before place payment');
 update private.billing_subscriptions set period_started_at=clock_timestamp()-interval '15 days',period_ends_at=clock_timestamp()+interval '15 days',renewal_requested=false where business_id=f.business_id;
 select period_started_at,period_ends_at into period_start,period_end from private.billing_subscriptions where business_id=f.business_id;
 capacity_quote:=public.myfatoorah_test_manager('quote',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',4,'paymentMethod','CARD','code',code_text));
 perform pg_temp.mfa((capacity_quote->>'totalFils')::bigint between 4999 and 5001,'half-period extra place costs about KD 5');
 perform pg_temp.mfa(capacity_quote->>'discountFils'='0','subscription discount is not reapplied to additional places');
 update myfatoorah_test.capacity_quotes set expires_at=now()-interval '1 minute' where id=(capacity_quote->>'quoteId')::uuid;
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''start'',%L::jsonb)',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',4,'paymentMethod','CARD','requestId',gen_random_uuid(),'quote',capacity_quote)),'MYFATOORAH_QUOTE_EXPIRED'),'expired capacity quote must be refreshed');
 capacity_quote:=public.myfatoorah_test_manager('quote',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',4,'paymentMethod','CARD'));
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''start'',%L::jsonb)',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',4,'paymentMethod','CARD','requestId',gen_random_uuid(),'quote',capacity_quote||'{"totalFils":1}')),'MYFATOORAH_QUOTE_CHANGED'),'modified capacity amount refused');
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''start'',%L::jsonb)',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',5,'paymentMethod','CARD','requestId',gen_random_uuid(),'quote',capacity_quote)),'MYFATOORAH_QUOTE_CHANGED'),'modified capacity count refused');
 request_id:=gen_random_uuid();
 a:=public.myfatoorah_test_manager('start',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',4,'paymentMethod','CARD','requestId',request_id,'quote',capacity_quote));
 aid:=(a->'attempt'->>'id')::uuid;
 saved:=public.myfatoorah_test_manager('start',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',4,'paymentMethod','CARD','requestId',request_id,'quote',capacity_quote));
 perform pg_temp.mfa(saved->'attempt'->>'id'=aid::text,'capacity retry returns the original attempt');
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''quote'',%L::jsonb)',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',5)),'MYFATOORAH_UNRESOLVED'),'another unresolved checkout is not opened');
 perform public.myfatoorah_test_provider('claim-create',aid,'{}');
 perform public.myfatoorah_test_provider('attach',aid,'{"sessionId":"123456788","checkoutUrl":"https://demo.myfatoorah.com/KWT/ie/capacity"}');
 a:=public.myfatoorah_test_provider('capture',aid,jsonb_build_object('orderId',aid,'sessionId','123456788','trackId','999999998','currency','KWD','totalFils',capacity_quote->'totalFils'));
 perform pg_temp.mfa(a->>'state'='paid' and (select paid_capacity=4 from private.billing_subscriptions where business_id=f.business_id),'verified capacity payment unlocks four places');
 perform public.myfatoorah_test_provider('capture',aid,jsonb_build_object('orderId',aid,'sessionId','123456788','trackId','999999998','currency','KWD','totalFils',capacity_quote->'totalFils'));
 perform pg_temp.mfa((select count(*)=2 from private.billing_invoices where business_id=f.business_id),'capacity replay does not duplicate invoice');
 perform pg_temp.mfa((select count(*)=1 from private.billing_redemptions where business_id=f.business_id),'one discount redemption remains after add-on');
 perform pg_temp.mfa((select period_started_at=period_start and period_ends_at=period_end and not renewal_requested from private.billing_subscriptions where business_id=f.business_id),'extra-place purchase preserves term dates and renewal choice');
 update public.barbers set status='active' where id=workers[4];
 perform pg_temp.mfa((select status='active' from public.barbers where id=workers[4]),'fourth barber can be activated after payment');
 begin
  capacity_quote:=public.myfatoorah_test_manager('quote',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',5,'paymentMethod','KNET'));
  a:=public.myfatoorah_test_manager('start',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',5,'paymentMethod','KNET','requestId',gen_random_uuid(),'quote',capacity_quote));
  aid:=(a->'attempt'->>'id')::uuid;
  perform public.myfatoorah_test_provider('claim-create',aid,'{}');
  perform public.myfatoorah_test_provider('attach',aid,'{"sessionId":"123456787","checkoutUrl":"https://demo.myfatoorah.com/KWT/ie/stale"}');
  update private.billing_subscriptions set period_ends_at=period_ends_at+interval '1 day' where business_id=f.business_id;
  a:=public.myfatoorah_test_provider('capture',aid,jsonb_build_object('orderId',aid,'sessionId','123456787','trackId','999999997','currency','KWD','totalFils',capacity_quote->'totalFils'));
  assert a->>'state'='review';
  assert (select count(*)=2 from private.billing_invoices where business_id=f.business_id);
  assert (select paid_capacity=4 from private.billing_subscriptions where business_id=f.business_id);
  raise sqlstate 'B0001';
 exception when sqlstate 'B0001' then null;end;
 perform pg_temp.mfa(true,'capture after a term change is quarantined without capacity or invoice');
 update private.billing_subscriptions set period_ends_at=clock_timestamp()+interval '90 seconds' where business_id=f.business_id;
 perform pg_temp.mfa(pg_temp.mfe(format('select public.myfatoorah_test_manager(''quote'',%L::jsonb)',jsonb_build_object('businessId',f.business_id,'kind','capacity','count',5)),'MYFATOORAH_CAPACITY_UNAVAILABLE'),'near-expiry capacity checkout is refused');
 insert into mf_check_result values(checks);
end $test$;
select total as baseline_checks_passed from mf_check_result;
select count(*) as matrix_groups_passed,jsonb_agg(scenario order by scenario) as scenarios from mf_matrix_checks;
rollback;
