begin;
do $fix$
declare source text:=pg_get_functiondef('subscription_billing.billing_api(text,jsonb)'::regprocedure);fixed text;
begin
 fixed:=replace(source,'billing_requests.request_id=request_id','billing_requests.request_id=billing_api.request_id');
 if fixed=source then raise exception 'Subscription retry lookup changed';end if;
 execute fixed;
end $fix$;
commit;
