-- Preserve the existing provider status envelope used by web and iOS clients.
do $migration$
declare
  definition text:=pg_get_functiondef('private.customer_account_api(text,jsonb)'::regprocedure);
  original text:=$old$      if account.user_id is null or account.status<>'active' then raise exception 'AUTH_REQUIRED'; end if;
      if p_action='logout' then$old$;
  replacement text:=$new$      if account.user_id is null or account.status<>'active' then raise exception 'AUTH_REQUIRED'; end if;
      if p_action='social-status' then
        return jsonb_build_object('profile',private.customer_account_api('profile',p_data));
      end if;
      if p_action='logout' then$new$;
begin
  if position(replacement in definition)>0 then return; end if;
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Unexpected canonical customer API; review response contract'; end if;
  execute replace(definition,original,replacement);
end;
$migration$;
