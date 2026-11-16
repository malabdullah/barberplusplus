begin;
-- Android is an explicit native client. Environment activation stays Test-only
-- in the gateway; iOS and web retain their existing protocol and role rules.
alter table private.customer_password_requests drop constraint customer_password_requests_client_check;
alter table private.customer_password_requests add constraint customer_password_requests_client_check check(client in('web','ios','android'));
alter table private.customer_password_requests drop constraint customer_password_requests_check;
alter table private.customer_password_requests add constraint customer_password_requests_check check((client in('ios','android'))=(native_state is not null));

do $migration$
declare original text;updated text;
begin
 original:=pg_get_functiondef('public.customer_password_api(text,jsonb)'::regprocedure);
 updated:=replace(original,$old$p_data->>'client' not in ('web','ios')$old$,$new$p_data->>'client' not in ('web','ios','android')$new$);
 if updated=original then raise exception 'PASSWORD_CLIENT_CONTRACT_CHANGED';end if;
 original:=updated;
 updated:=replace(updated,$old$p_data->>'client'='ios' and coalesce(p_data->>'native_challenge','')$old$,$new$p_data->>'client' in ('ios','android') and coalesce(p_data->>'native_challenge','')$new$);
 if updated=original then raise exception 'PASSWORD_CHALLENGE_CONTRACT_CHANGED';end if;
 original:=updated;
 updated:=replace(updated,$old$request.client<>'ios' or request.native_state$old$,$new$request.client not in ('ios','android') or request.client is distinct from coalesce(p_data->>'client','ios') or request.native_state$new$);
 if updated=original then raise exception 'PASSWORD_DELIVERY_CONTRACT_CHANGED';end if;
 original:=updated;
 updated:=replace(updated,$old$request.state<>'ready' or request.expires_at<=now() or request.user_id is null$old$,$new$request.state<>'ready' or request.expires_at<=now() or request.user_id is null
      or coalesce(p_data->>'client','web') is distinct from request.client$new$);
 if updated=original then raise exception 'PASSWORD_LOAD_CONTRACT_CHANGED';end if;
 original:=updated;
 updated:=replace(updated,$old$(request.client='ios' and (p_data->>'client' is distinct from 'ios'$old$,$new$(request.client in ('ios','android') and (p_data->>'client' is distinct from request.client$new$);
 if updated=original then raise exception 'PASSWORD_NATIVE_STATE_CONTRACT_CHANGED';end if;
 original:=updated;
 updated:=replace(updated,$old$(request.client<>'ios' or request.delivery_hash is null$old$,$new$(request.client not in ('ios','android') or request.delivery_hash is null$new$);
 if updated=original then raise exception 'PASSWORD_DELIVERY_TOKEN_CONTRACT_CHANGED';end if;
 execute updated;
end$migration$;
commit;
