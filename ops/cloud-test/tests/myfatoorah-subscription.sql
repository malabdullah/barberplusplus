-- Hosted Test only. Uses the dedicated card fixture and rolls back every write.
begin;
create temporary table mf_check_result(total integer);
do $test$
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
begin
 if to_regclass('private.cloud_test_emails') is null then raise exception 'TEST_ONLY'; end if;
 select x.* into strict f from myfatoorah_test.fixture x join public.branches b on b.id=x.branch_id where b.name='MyFatoorah Sandbox — card';
 if exists(select 1 from myfatoorah_test.attempts where business_id=f.business_id) then raise exception 'FIXTURE_NOT_PRISTINE'; end if;
 select id into strict sid from auth.sessions where user_id=f.manager_id order by created_at desc limit 1;
 select business_id into strict other_id from myfatoorah_test.fixture where business_id<>f.business_id order by business_id limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.manager_id,'session_id',sid,'role','authenticated','aal','aal1')::text,true);
 if not (public.myfatoorah_test_manager('read',jsonb_build_object('businessId',f.business_id))->>'eligible')::boolean then raise exception 'OWN_READ'; end if; checks:=checks+1;
 if (public.myfatoorah_test_manager('read',jsonb_build_object('businessId',other_id))->>'eligible')::boolean then raise exception 'FOREIGN_READ'; end if; checks:=checks+1;
 begin
  perform public.myfatoorah_test_manager('quote',jsonb_build_object('businessId',other_id,'count',3,'frequency','monthly'));
  raise exception 'FOREIGN_QUOTE_ALLOWED';
 exception when insufficient_privilege then checks:=checks+1; end;
 q:=public.myfatoorah_test_manager('quote',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code','MYFTEST50','paymentMethod','CARD'));
 if (q->>'totalFils')::bigint<>private.billing_price(3,'monthly')/2 or q->>'paymentMethod'<>'CARD' then raise exception 'CANONICAL_QUOTE'; end if; checks:=checks+1;
 begin
  perform public.myfatoorah_test_manager('start',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code','MYFTEST50','paymentMethod','CARD','requestId',request_id,'quote',q||'{"totalFils":1}'));
  raise exception 'TAMPER_ALLOWED';
 exception when raise_exception then if sqlerrm<>'MYFATOORAH_QUOTE_CHANGED' then raise; end if;checks:=checks+1;end;
 a:=public.myfatoorah_test_manager('start',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code','MYFTEST50','paymentMethod','CARD','requestId',request_id,'quote',q));
 aid:=(a->'attempt'->>'id')::uuid;
 saved:=public.myfatoorah_test_manager('start',jsonb_build_object('businessId',f.business_id,'count',3,'frequency','monthly','code','MYFTEST50','paymentMethod','CARD','requestId',request_id,'quote',q));
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
 insert into mf_check_result values(checks);
end $test$;
select total as checks_passed from mf_check_result;
rollback;
