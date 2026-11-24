-- Simulated provider facts only. This test does not call UPayments.
begin;
do $test$
declare
  member uuid := gen_random_uuid(); person uuid := gen_random_uuid(); live uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid(); stranger_session uuid := gen_random_uuid(); stranger_customer uuid := gen_random_uuid();
  topup uuid := gen_random_uuid(); replacement uuid := gen_random_uuid();
  identity jsonb; facts jsonb; result jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
    (member,member||'@example.test',now(),'{"role":"customer"}'),
    (stranger,stranger||'@example.test',now(),'{"role":"customer"}');
  insert into auth.sessions(id,user_id,aal) values (live,member,'aal1'), (stranger_session,stranger,'aal1');
  insert into public.customers(id,name,email) values
    (person,'Top-up QA',member||'@example.test'), (stranger_customer,'Other QA',stranger||'@example.test');
  insert into private.customer_accounts(user_id,customer_id) values(member,person),(stranger,stranger_customer);
  update private.b_wallet_settings set enabled=true, accept_new_payments=true;
  identity := jsonb_build_object('user_id',member,'session_id',live);
  result := public.b_wallet_topup_service('start',topup,identity||'{"amount_fils":1250}');
  if result->>'create' is distinct from 'true' then raise exception 'Expected one new top-up'; end if;
  result := public.b_wallet_topup_service('start',gen_random_uuid(),identity||'{"amount_fils":1250}');
  if result->>'id' is distinct from topup::text or result ? 'create' then raise exception 'Open intent repeated charge'; end if;
  if public.b_wallet_topup_service('read',topup,jsonb_build_object('user_id',stranger,'session_id',stranger_session)) is not null then
    raise exception 'Another customer could read the top-up';
  end if;
  result := public.b_wallet_topup_service('attach',topup,
    jsonb_build_object('session_id','qa_'||topup,'checkout_url','https://sandbox.upayments.com'));
  if result->>'linkExpired' is distinct from 'false' or result->>'checkoutUrl' is null then
    raise exception 'Fresh link hidden';
  end if;
  update private.b_wallet_topups set created_at=clock_timestamp()-interval '6 minutes' where id=topup;
  result := public.b_wallet_topup_service('read',topup,identity);
  if result->>'linkExpired' is distinct from 'true' or result->>'checkoutUrl' is not null
    or result->>'state' is distinct from 'pending' then raise exception 'Expired link changed payment state'; end if;
  result := public.b_wallet_topup_service('start',replacement,identity||'{"amount_fils":1250}');
  if result->>'id' is distinct from topup::text or result ? 'create' then raise exception 'Expired link allowed another charge'; end if;

  -- Simulate the sweep moving only this fresh fixture into review.
  update private.b_wallet_topups set state='review',checkout_url=null where id=topup;
  result := public.b_wallet_topup_service('latest',null,identity);
  if result->>'linkExpired' is distinct from 'true' or result->>'id' is distinct from topup::text
    then raise exception 'Review lost the stable attempt'; end if;
  result := public.b_wallet_topup_service('fail',topup,'{"session_id":"wrong"}');
  if result->>'state' is distinct from 'review' then raise exception 'Unbound outcome cleared review'; end if;
  result := public.b_wallet_topup_service('fail',topup,jsonb_build_object('session_id','qa_'||topup));
  if result->>'state' is distinct from 'failed' or result->>'linkExpired' is distinct from 'false'
    then raise exception 'Confirmed non-capture did not clear review'; end if;
  result := public.b_wallet_topup_service('start',replacement,identity||'{"amount_fils":1250}');
  if result->>'create' is distinct from 'true' or result->>'id' is distinct from replacement::text
    then raise exception 'Terminal non-capture left the wallet blocked'; end if;
  facts := jsonb_build_object('session_id','qa_'||topup,'amount_fils',1250,'currency','KWD','order_id',topup,'track_id',topup);
  begin
    perform public.b_wallet_topup_service('capture',topup,facts||'{"amount_fils":1251}');
    raise exception 'Mismatched top-up credited';
  exception when raise_exception then
    if sqlerrm <> 'WALLET_PROVIDER_MISMATCH' then raise; end if;
  end;
  perform public.b_wallet_topup_service('capture',topup,facts);
  perform public.b_wallet_topup_service('capture',topup,facts);
  if (select count(*)=1 and sum(amount_fils)=1250 from private.b_wallet_movements where reference=topup) is distinct from true then
    raise exception 'Expected one face-value credit';
  end if;
  if has_function_privilege('authenticated','public.b_wallet_topup_service(text,uuid,jsonb)','EXECUTE') then
    raise exception 'Customer can invoke service callback';
  end if;
end
$test$;
select 'ownership, expired link, safe retry, bound terminal non-capture and one late credit passed' as result;
rollback;
