-- PostgreSQL's regex repetition bound is 255. Bound token length separately
-- from its alphabet; the gateway and FCM API retain the same 20..4096 contract.
begin;
do $migration$
declare original text;updated text;
begin
 original:=pg_get_functiondef('private.android_live_push_api(text,jsonb)'::regprocedure);
 updated:=replace(original,$old$coalesce(p_data->>'token','')!~'^[A-Za-z0-9_:-]{20,4096}$'$old$,$new$length(coalesce(p_data->>'token',''))not between 20 and 4096 or coalesce(p_data->>'token','')!~'^[A-Za-z0-9_:-]+$'$new$);
 if updated=original then raise exception 'ANDROID_TOKEN_VALIDATION_CONTRACT_CHANGED';end if;
 execute updated;
end$migration$;
commit;
