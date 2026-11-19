begin;
create function private.billing_barber_counted(p_barber public.barbers)returns boolean
language sql immutable set search_path='' as $$select coalesce(p_barber.status='active'and(p_barber.management_mode='managed'or p_barber.manager_chair or p_barber.user_id is not null and coalesce(p_barber.invite_status,'accepted')='accepted'),false);$$;
revoke all on function private.billing_barber_counted(public.barbers)from public,anon,authenticated,service_role;
grant execute on function private.billing_barber_counted(public.barbers)to service_role;
create function public.customer_bookable_barbers()returns uuid[]
language sql stable security definer set search_path='' as $$select coalesce(array_agg(id),'{}')from public.barbers b where private.billing_barber_counted(b)and private.billing_shop_access(b.branch_id,false);$$;
revoke all on function public.customer_bookable_barbers()from public,anon,authenticated;
grant execute on function public.customer_bookable_barbers()to service_role;
do $patch$
declare source text;fixed text;
begin
 source:=pg_get_functiondef('private.billing_guard_booking()'::regprocedure);
 fixed:=replace(source,$a$ if not private.billing_shop_access(new.branch_id,coalesce(manual,false))then$a$,
 $b$ if not exists(select 1 from public.barbers b where b.id=new.barber_id and b.branch_id=new.branch_id and private.billing_barber_counted(b))or not private.billing_shop_access(new.branch_id,coalesce(manual,false))then$b$);
 if fixed=source then raise exception 'booking provider contract changed';end if;execute fixed;
 source:=pg_get_functiondef('private.booking_provider_ready(public.barbers,public.branches)'::regprocedure);
 fixed:=replace(source,'select exists(select 1 from public.services', 'select private.billing_barber_counted(p_barber)and exists(select 1 from public.services');
 if fixed=source then raise exception 'discovery provider contract changed';end if;execute fixed;
 source:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure);
 fixed:=replace(source,$a$and not private.billing_shop_access(v_branch.id,false)$a$,
 $b$and(not private.billing_shop_access(v_branch.id,false)or not private.billing_barber_counted(v_barber))$b$);
 if fixed=source then raise exception 'customer provider contract changed';end if;execute fixed;
end$patch$;
notify pgrst,'reload schema';
commit;
