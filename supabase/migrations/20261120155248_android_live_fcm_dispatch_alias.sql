-- Keep the current device record distinct from the SQL recipient alias. With
-- use_variable, a same-named composite silently hides JOIN alias references.
begin;
do $migration$
declare source text;
begin
 source:=pg_get_functiondef('private.android_live_push_dispatch(text,jsonb)'::regprocedure);
 if position('d private.android_live_push_devices;'in source)=0 then raise exception'ANDROID_DISPATCH_ALIAS_CONTRACT_CHANGED';end if;
 source:=replace(source,'d private.android_live_push_devices;','device_row private.android_live_push_devices;');
 source:=replace(source,'select*into d from private.android_live_push_devices','select*into device_row from private.android_live_push_devices');
 source:=replace(source,'token_hash=d.token_hash,registration_version=d.registration_version','token_hash=device_row.token_hash,registration_version=device_row.registration_version');
 source:=replace(source,$old$'token',d.token$old$,$new$'token',device_row.token$new$);
 source:=replace(source,$old$'language',d.language$old$,$new$'language',device_row.language$new$);
 execute source;
end$migration$;
commit;
