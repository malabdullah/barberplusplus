-- The older Test-only binding had already added the client equality guard.
-- Replaying its additive prefix replacement duplicated that condition on Test.
-- Remove only that exact duplicate; fresh production already has one copy.
begin;
do $migration$
declare source text;duplicate text:=$duplicate$      or coalesce(p_data->>'client','web') is distinct from request.client
      or coalesce(p_data->>'client','web') is distinct from request.client$duplicate$;
begin
 source:=pg_get_functiondef('public.customer_password_api(text,jsonb)'::regprocedure);
 if position(duplicate in source)>0 then
  source:=replace(source,duplicate,$single$      or coalesce(p_data->>'client','web') is distinct from request.client$single$);
  execute source;
 elsif position($single$coalesce(p_data->>'client','web') is distinct from request.client$single$in source)=0 then
  raise exception'ANDROID_NATIVE_REPLAY_CONTRACT_CHANGED';
 end if;
end$migration$;
commit;
