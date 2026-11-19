begin;
create index barbers_billing_active_capacity on public.barbers(branch_id,(coalesce(user_id,id)))where status='active'
 and(management_mode='managed'or manager_chair or user_id is not null and coalesce(invite_status,'accepted')='accepted');
do $patch$
declare source text;fixed text;
begin
 source:=pg_get_functiondef('private.billing_guard_booking()'::regprocedure);
 fixed:=replace(source,$a$old.status in('cancelled','no_show','completed')and new.status in('pending','confirmed')$a$,
 $b$old.status is distinct from 'pending'and old.status is distinct from 'confirmed'and new.status in('pending','confirmed')$b$);
 if fixed=source then raise exception 'terminal booking subscription contract changed';end if;execute fixed;
end$patch$;
commit;
