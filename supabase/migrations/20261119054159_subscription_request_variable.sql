begin;
do $fix$
declare source text:=pg_get_functiondef('subscription_billing.billing_api(text,jsonb)'::regprocedure);fixed text;
begin
 fixed:=replace(source,'request_id uuid;','request_key uuid;');
 fixed:=replace(fixed,'request_id:=','request_key:=');
 fixed:=replace(fixed,'if request_id is null','if request_key is null');
 fixed:=replace(fixed,'actor::text||request_id::text','actor::text||request_key::text');
 fixed:=replace(fixed,'billing_requests.request_id=billing_api.request_id','billing_requests.request_id=request_key');
 fixed:=replace(fixed,'values(actor,request_id,','values(actor,request_key,');
 if fixed=source or fixed like '%billing_api.request_id%'then raise exception 'Subscription retry source changed';end if;
 execute fixed;
end $fix$;
commit;
