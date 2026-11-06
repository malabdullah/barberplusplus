begin;
-- The production-compatible dispatcher retains an older customer routine. Keep
-- its contact email derived from Auth, even when a name/phone-only request omits it.
do $$
declare definition text; marker text:=$marker$email=nullif(p_data->>'email','')$marker$;
begin
  definition:=pg_get_functiondef('private.customer_account_api_customer(text,jsonb)'::regprocedure);
  if strpos(definition,marker)>0 then
    if length(definition)-length(replace(definition,marker,''))<>length(marker) then raise exception 'Ambiguous customer email write'; end if;
    execute replace(definition,marker,'email=(select u.email from auth.users u where u.id=account.user_id)');
  elsif strpos(definition,'email=case when account.user_id=account_user.id then account_user.email else email end')=0 then
    raise exception 'Unrecognized canonical customer email routine';
  end if;
end;
$$;
commit;
