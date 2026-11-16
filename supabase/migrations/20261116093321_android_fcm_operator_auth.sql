begin;
do $migration$
declare original text;updated text;
begin
 original:=pg_get_functiondef('public.customer_android_push_dispatch(text,jsonb)'::regprocedure);
 updated:=replace(original,$old$begin
 select*into runtime$old$,$new$begin
 if p_action='authorize'then
  -- PostgREST has verified the JWT and service-only EXECUTE ACL before entry.
  -- Neither role nor project is accepted from p_data or a decoded client token.
  if auth.role()is distinct from'service_role'or auth.jwt()->>'ref'is distinct from'qvkucvcjmojjbphlzlks'then raise exception'AUTH_REQUIRED';end if;
  return'true'::jsonb;
 end if;
 select*into runtime$new$);
 if updated=original then raise exception'ANDROID_OPERATOR_AUTH_CONTRACT_CHANGED';end if;
 execute updated;
end$migration$;
commit;
