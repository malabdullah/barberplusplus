begin;
-- Only the canonical live account's verified address is readable here. The
-- booking invoker never receives broad access to the managed Auth schema.
create function private.customer_checkout_email(p_account uuid,p_session uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare address text;
begin
  perform private.resolve_booking_customer(p_account,p_session);
  select lower(email) into address from auth.users where id=p_account and email_confirmed_at is not null;
  return address;
end $$;
revoke all on function private.customer_checkout_email(uuid,uuid) from public,anon,authenticated;
grant execute on function private.customer_checkout_email(uuid,uuid) to service_role;
do $patch$
declare definition text:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure);updated text;
begin
 updated:=replace(definition,$old$      select lower(u.email) into v_email from auth.users u where u.id=(p_data->>'account_user_id')::uuid and u.email_confirmed_at is not null;$old$,$new$      v_email:=private.customer_checkout_email((p_data->>'account_user_id')::uuid,(p_data->>'session_id')::uuid);$new$);
 if updated=definition then raise exception 'Checkout verified email contract changed';end if;execute updated;
end $patch$;
notify pgrst,'reload schema';
commit;
