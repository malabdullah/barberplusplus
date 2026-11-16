begin;
do $migration$
declare original text;updated text;
begin
 original:=pg_get_functiondef('public.customer_android_push_api(text,jsonb)'::regprocedure);
 updated:=replace(original,$old$coalesce(p_data->>'token','')!~'^[A-Za-z0-9_:-]{20,4096}$'$old$,
  $new$coalesce(p_data->>'token','')!~'^[A-Za-z0-9_:-]+$'or length(p_data->>'token')not between 20 and 4096 $new$);
 if updated=original then raise exception'ANDROID_TOKEN_VALIDATION_CONTRACT_CHANGED';end if;
 execute updated;
end$migration$;
commit;
