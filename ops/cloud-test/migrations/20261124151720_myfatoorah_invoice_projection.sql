begin;
do $projection$
declare
 source text := pg_get_functiondef('subscription_billing.billing_api(text,jsonb)'::regprocedure);
 old_text text := $old$provider_reference like 'upayments-capacity-sandbox:%'$old$;
 new_text text := $new$provider_reference like any(array['upayments-capacity-sandbox:%','myfatoorah-capacity-sandbox:%'])$new$;
begin
 if (length(source)-length(replace(source,old_text,'')))/length(old_text)<>1 then raise exception 'MYFATOORAH_PROJECTION_CHANGED'; end if;
 execute replace(source,old_text,new_text);
end $projection$;
commit;
