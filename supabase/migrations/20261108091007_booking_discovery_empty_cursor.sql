-- JSON null is the natural first-page value sent by the web client.
do $patch$
declare definition text;
begin
  definition:=pg_get_functiondef('private.customer_booking_discovery(text,jsonb)'::regprocedure);
  if position('cursor jsonb:=p_data->''cursor''' in definition)=0 then raise exception 'Discovery cursor contract changed'; end if;
  execute replace(definition,'cursor jsonb:=p_data->''cursor''','cursor jsonb:=nullif(p_data->''cursor'',''null''::jsonb)');
end;
$patch$;
