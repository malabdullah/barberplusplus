-- Preserve the established admin challenge response for existing clients.
do $migration$
declare
  definition text := pg_get_functiondef('public.enforce_account_session()'::regprocedure);
  previous_message constant text := 'raise exception ''MFA_REQUIRED'' using errcode=''42501''';
  compatible_message constant text := $replacement$raise exception using errcode='42501', message=case
    when exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='admin')
      then 'ADMIN_MFA_REQUIRED' else 'MFA_REQUIRED' end$replacement$;
begin
  if cardinality(string_to_array(definition,previous_message))<>2 then raise exception 'Unexpected staff assurance guard';end if;
  execute replace(definition,previous_message,compatible_message);
end $migration$;
