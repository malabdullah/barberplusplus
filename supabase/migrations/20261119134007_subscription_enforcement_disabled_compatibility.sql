begin;
create function private.billing_provider_available(p_barber public.barbers)returns boolean
language sql stable security definer set search_path='' as $$select not private.billing_enforced()or private.billing_barber_counted(p_barber);$$;
revoke all on function private.billing_provider_available(public.barbers)from public,anon,authenticated,service_role;
grant execute on function private.billing_provider_available(public.barbers)to service_role;
do $patch$
declare target regprocedure;source text;fixed text;
begin
 foreach target in array array['private.booking_provider_ready(public.barbers,public.branches)'::regprocedure,'public.customer_booking(text,jsonb)'::regprocedure,'public.customer_bookable_barbers()'::regprocedure]loop
  source:=pg_get_functiondef(target);fixed:=replace(source,'private.billing_barber_counted(','private.billing_provider_available(');
  if fixed=source then raise exception 'provider compatibility contract changed: %',target;end if;execute fixed;
 end loop;
end$patch$;
commit;
