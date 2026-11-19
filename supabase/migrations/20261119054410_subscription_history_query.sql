begin;
do $fix$
declare source text:=pg_get_functiondef('subscription_billing.billing_api(text,jsonb)'::regprocedure);fixed text;
begin
 fixed:=replace(source,'select id,action,reason,details,created_at from private.billing_audit where business_id=business order by id desc limit 100',
  'select h.id,h.action,h.reason,h.details,h.created_at from private.billing_audit h where h.business_id=business order by h.id desc limit 100');
 if fixed=source then raise exception 'Subscription history source changed';end if;
 execute fixed;
end $fix$;
commit;
