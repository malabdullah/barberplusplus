-- A JWT can outlive a staff role change or session revocation.
create function private.can_transfer_barber(from_shop uuid, to_shop uuid)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select nullif(auth.jwt()->>'session_id', '') is not null and case private.live_staff_role()
    when 'admin' then public.is_admin()
    when 'manager' then
      exists(select 1 from public.branches where id = from_shop and manager_id = auth.uid())
      and exists(select 1 from public.branches where id = to_shop and manager_id = auth.uid())
    else false
  end;
$$;
revoke all on function private.can_transfer_barber(uuid, uuid) from public, anon, authenticated, service_role;

-- Replace only the authorization check; preserve existing availability and approval handling.
do $migration$
declare
  definition text := pg_get_functiondef('private.guard_availability_write()'::regprocedure);
  previous_check constant text := $old$and not
   (role_name='manager' and exists(select 1 from public.branches where id=old.branch_id and manager_id=auth.uid())
    and exists(select 1 from public.branches where id=new.branch_id and manager_id=auth.uid()))
   and not public.is_admin()$old$;
  live_check constant text := 'and not private.can_transfer_barber(old.branch_id, new.branch_id)';
begin
  if cardinality(string_to_array(definition, previous_check)) <> 2 then
    raise exception 'Unexpected barber transfer guard definition';
  end if;
  execute replace(definition, previous_check, live_check);
end
$migration$;
