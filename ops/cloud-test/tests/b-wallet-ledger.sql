-- Hosted Test only. All fixtures and the temporary feature change roll back.
begin;
create temp table wallet_checks (label text);
create function pg_temp.assert_wallet(p_pass boolean, p_label text) returns void
language plpgsql as $$
begin
  if not coalesce(p_pass,false) then raise exception 'B-Wallet assertion failed: %',p_label; end if;
  insert into wallet_checks values (p_label);
end
$$;

do $test$
declare
  super_id uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid(); person uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  super_session uuid := gen_random_uuid(); admin_session uuid := gen_random_uuid();
  member_session uuid := gen_random_uuid(); other_session uuid := gen_random_uuid();
  manager_session uuid := gen_random_uuid(); super_factor uuid := gen_random_uuid(); admin_factor uuid := gen_random_uuid();
  credit_request uuid := gen_random_uuid(); second_request uuid := gen_random_uuid();
  wallet uuid; payload jsonb; entry jsonb; snapshot jsonb; exact_expiry timestamptz;
begin
  perform pg_temp.assert_wallet(not has_function_privilege('anon','public.b_wallet(text,jsonb)','EXECUTE'),'anonymous wallet API denied');
  perform pg_temp.assert_wallet(not has_table_privilege('authenticated','private.b_wallet_lots','SELECT'),'credit lots private');
  perform pg_temp.assert_wallet(not has_table_privilege('service_role','private.b_wallet_movements','INSERT'),'service role cannot insert movements directly');
  perform pg_temp.assert_wallet(not has_function_privilege('authenticated','private.b_wallet_credit(uuid,text,bigint,uuid,timestamptz,timestamptz)','EXECUTE'),'internal credit helper private');
  perform pg_temp.assert_wallet((select not enabled and not accept_new_payments and expiry_months=6 from private.b_wallet_settings),'disabled by default with six months');
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
    (super_id,super_id||'@example.test',now(),'{"role":"admin"}'),
    (admin_id,admin_id||'@example.test',now(),'{"role":"agent"}'),
    (member_id,member_id||'@example.test',now(),'{"role":"customer"}'),
    (other_id,other_id||'@example.test',now(),'{"role":"customer"}'),
    (manager_id,manager_id||'@example.test',now(),'{"role":"manager"}');
  insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
    values(super_factor,super_id,'totp','verified',now(),now()),(admin_factor,admin_id,'totp','verified',now(),now());
  insert into auth.sessions(id,user_id,aal,factor_id) values
    (super_session,super_id,'aal2',super_factor),(admin_session,admin_id,'aal2',admin_factor),
    (member_session,member_id,'aal1',null),(other_session,other_id,'aal1',null),
    (manager_session,manager_id,'aal1',null);
  insert into public.customers(id,name,email) values
    (person,'Wallet QA',member_id||'@example.test'),(outsider,'Other Wallet QA',other_id||'@example.test');
  insert into private.customer_accounts(user_id,customer_id) values(member_id,person),(other_id,outsider);

  update private.b_wallet_settings set enabled=true,accept_new_payments=true;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',admin_session,'aal','aal2')::text,true);
  payload := jsonb_build_object('customerId',person,'amountFils','2000','reason','QA goodwill credit','requestId',credit_request);
  entry := public.b_wallet('admin-goodwill',payload);
  perform pg_temp.assert_wallet(entry = public.b_wallet('admin-goodwill',payload),'admin credit retry is idempotent');
  begin
    perform public.b_wallet('admin-goodwill',payload||'{"amountFils":"2001"}');
    raise exception 'Unexpected changed retry success';
  exception when raise_exception then
    if sqlerrm <> 'WALLET_RETRY_CHANGED' then raise; end if;
  end;
  perform pg_temp.assert_wallet((public.b_wallet('admin-lookup',jsonb_build_object('reference',credit_request))->'transactions'->0->>'amountFils')='2000','admin can look up exact credit');
  select id into wallet from private.b_wallet_accounts where customer_id=person;
  select expires_at into exact_expiry from private.b_wallet_lots where wallet_id=wallet;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',super_id,'session_id',super_session,'aal','aal2')::text,true);
  perform public.b_wallet('admin-set-expiry',jsonb_build_object('requestId',gen_random_uuid(),'reason','QA expiry policy','expiryMonths',9));
  perform public.b_wallet('admin-goodwill',payload||jsonb_build_object('requestId',second_request,'amountFils','500'));
  perform pg_temp.assert_wallet((select count(*)=1 from private.b_wallet_lots where wallet_id=wallet and expires_at=exact_expiry),'new policy preserves issued expiry');
  perform pg_temp.assert_wallet((select count(*)=2 from private.b_wallet_admin_audit where request_id in(credit_request,second_request)),'both roles leave one visible credit and audit each');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',super_id,'session_id',super_session,'aal','aal1')::text,true);
  begin
    perform public.b_wallet('admin-settings');
    raise exception 'Unexpected AAL1 success';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_id,'session_id',manager_session,'aal','aal1')::text,true);
  begin
    perform public.b_wallet('admin-lookup',jsonb_build_object('customerId',person));
    raise exception 'Unexpected manager wallet lookup';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'session_id',member_session,'aal','aal1')::text,true);
  snapshot := public.b_wallet('summary');
  perform pg_temp.assert_wallet(snapshot->>'balanceFils'='2500' and jsonb_array_length(snapshot->'transactions')=2,'customer sees goodwill and spendable amount');
  perform pg_temp.assert_wallet((private.b_wallet_summary(wallet,exact_expiry,null)->>'balanceFils')='500','credit excluded exactly at expiry');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'session_id',other_session,'aal','aal1')::text,true);
  perform pg_temp.assert_wallet(public.b_wallet('summary',jsonb_build_object('customerId',person))->>'balanceFils'='0','customer cannot select another wallet');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'session_id',other_session,'aal','aal1')::text,true);
  perform pg_temp.assert_wallet(public.b_wallet('status')->>'enabled'='false','mismatched live session denied');
end
$test$;
select count(*) as assertions, array_agg(label order by label) as passed from wallet_checks;
rollback;
