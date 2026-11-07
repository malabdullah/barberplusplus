begin;
-- Keep the row locks on the barber and shop. Aggregated service totals cannot take FOR SHARE.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure);
 if position('from public.services where id = any(v_services) and branch_id = v_branch.id and status = ''active'' for share;' in definition)=0 then raise exception 'Customer service aggregate changed; review migration';end if;
 execute replace(definition,'from public.services where id = any(v_services) and branch_id = v_branch.id and status = ''active'' for share;','from public.services where id = any(v_services) and branch_id = v_branch.id and status = ''active'';');
end $migration$;
commit;
