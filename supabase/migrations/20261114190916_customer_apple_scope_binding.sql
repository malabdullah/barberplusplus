begin;
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.customer_deletion_service(text,jsonb)'::regprocedure)into definition;
 if position('apple-credential:'in definition)=0 then raise exception 'UNEXPECTED_APPLE_BASELINE';end if;
 definition:=replace(definition,
  '    select coalesce(nullif(identity_data->>''sub'',''''),provider_id)into v_subject',
  '    if exists(select 1 from private.customer_deletion_runtime where singleton and test_mode)and(
      not exists(select 1 from private.customer_deletion_runtime where singleton and u=any(allowed_test_users))
      or not exists(select 1 from auth.users where id=u and raw_app_meta_data->>''deletion_qa''=''true''and email like''%@example.test'')
    )then raise exception ''TEST_ACCOUNT_ONLY'';end if;
    select coalesce(nullif(identity_data->>''sub'',''''),provider_id)into v_subject');
 if position('TEST_ACCOUNT_ONLY'in definition)=0 then raise exception 'UNEXPECTED_APPLE_BASELINE';end if;
 definition:=replace(definition,
  '      if length(coalesce(p_data->>''cipher'',''''))not between',
  '      if p_data->>''subject''is distinct from v_subject then raise exception ''APPLE_PROOF_INVALID'';end if;
      if length(coalesce(p_data->>''cipher'',''''))not between');
 if position('''subject''is distinct from v_subject'in definition)=0 then raise exception 'UNEXPECTED_APPLE_BASELINE';end if;
 execute definition;
end $migration$;
commit;
