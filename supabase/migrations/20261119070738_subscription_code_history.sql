begin;
create index billing_audit_code on private.billing_audit((details->>'codeId'),id desc)where business_id is null;
alter table private.billing_invoices add unique(id,business_id);
alter table private.billing_redemptions add foreign key(invoice_id,business_id)references private.billing_invoices(id,business_id);
do $fix$
declare source text:=pg_get_functiondef('subscription_billing.billing_api(text,jsonb)'::regprocedure);fixed text;
begin
 fixed:=replace(source,$old$in('codes','create-code','toggle-code')$old$,$new$in('codes','code-history','create-code','toggle-code')$new$);
 fixed:=replace(fixed,$old$ if p_action='codes'then$old$,$new$ if p_action='code-history'then
  if not exists(select 1 from private.billing_discount_codes d where d.id=(p_data->>'codeId')::uuid)then raise exception 'BILLING_NOT_FOUND';end if;
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(q)order by q.id desc),'[]')from(
   select h.id,h.action,h.reason,h.created_at from private.billing_audit h where h.business_id is null and h.details->>'codeId'=p_data->>'codeId'order by h.id desc limit 100)q));
 end if;
 if p_action='codes'then$new$);
 if fixed=source then raise exception 'Subscription code-history source changed';end if;
 execute fixed;
end $fix$;
notify pgrst,'reload schema';
commit;
