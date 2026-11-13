-- Keep bans effective for already-connected Realtime clients.
do $migration$
declare
  definition text := pg_get_functiondef('public.set_manager_account_enabled(uuid,boolean)'::regprocedure);
  old_statement constant text := 'if not enabled then update auth.sessions set not_after=now() where user_id=manager; end if;';
  new_statement constant text := $replacement$if not enabled then
    insert into private.account_revoked_sessions(session_id,user_id)
      select id,user_id from auth.sessions where user_id=manager
      on conflict(session_id) do nothing;
    update auth.sessions set not_after=now() where user_id=manager;
  end if;$replacement$;
begin
  if cardinality(string_to_array(definition,old_statement))<>2 then
    raise exception 'Unexpected manager suspension implementation';
  end if;
  execute replace(definition,old_statement,new_statement);
  if position('private.staff_session_factor_satisfied(p_user,p_session)' in
      pg_get_functiondef('public.customer_session_is_live(uuid,uuid)'::regprocedure))=0
    or position('private.staff_session_factor_satisfied(p_user,p_session)' in
      pg_get_functiondef('private.invitation_live(uuid,uuid,text)'::regprocedure))=0 then
    raise exception 'Missing service session factor guards';
  end if;
end $migration$;
