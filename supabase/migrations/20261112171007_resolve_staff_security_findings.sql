-- Service-role handlers pass verified actor/session identities separately from JWT claims.
create function private.staff_session_factor_satisfied(person uuid, session uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from auth.users u join auth.mfa_factors f on f.user_id=u.id
    where u.id=person and u.raw_app_meta_data->>'role' in ('admin','manager','barber','agent') and f.status='verified')
  or exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
    where s.id=session and s.user_id=person and s.aal='aal2' and f.status='verified'
      and (s.not_after is null or s.not_after>now()));
$$;
revoke all on function private.staff_session_factor_satisfied(uuid,uuid) from public,anon,authenticated,service_role;
create function public.staff_token_factor_satisfied(p_user uuid,p_session uuid,p_aal text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.staff_session_factor_satisfied(p_user,p_session) and (
    p_aal='aal2' or not exists(select 1 from auth.users u join auth.mfa_factors f on f.user_id=u.id
      where u.id=p_user and u.raw_app_meta_data->>'role' in ('admin','manager','barber','agent') and f.status='verified'));
$$;
revoke all on function public.staff_token_factor_satisfied(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.staff_token_factor_satisfied(uuid,uuid,text) to service_role;

-- Verified staff factors must be satisfied at every database boundary.
create function public.staff_factor_satisfied() returns boolean
language sql stable security definer set search_path='' as $$
  select not exists (
    select 1 from auth.users u join auth.mfa_factors f on f.user_id=u.id
    where u.id=auth.uid() and u.raw_app_meta_data->>'role' in ('admin','manager','barber','agent')
      and f.status='verified'
  ) or (
    auth.jwt()->>'aal'='aal2' and exists (
      select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
      where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=auth.uid()
        and (s.not_after is null or s.not_after>now()) and s.aal='aal2' and f.status='verified'
    )
  );
$$;
revoke all on function public.staff_factor_satisfied() from public, anon;
grant execute on function public.staff_factor_satisfied() to authenticated, service_role;

do $patch$
declare definition text;
begin
  definition:=pg_get_functiondef('private.live_staff_role()'::regprocedure);
  if position('where u.id=auth.uid()' in definition)=0 then raise exception 'Unexpected live role definition'; end if;
  execute replace(definition,'where u.id=auth.uid()','where public.staff_factor_satisfied() and u.id=auth.uid()');
  definition:=pg_get_functiondef('public.enforce_account_session()'::regprocedure);
  if position('current_session := private.current_account_session();' in definition)=0 then raise exception 'Unexpected session guard'; end if;
  execute replace(definition,'current_session := private.current_account_session();',
    'if public.staff_factor_satisfied() is not true then raise exception ''MFA_REQUIRED'' using errcode=''42501''; end if; current_session := private.current_account_session();');
end $patch$;

do $service_guards$
declare definition text;
begin
  definition:=pg_get_functiondef('public.customer_session_is_live(uuid,uuid)'::regprocedure);
  execute replace(definition,'where s.id=p_session','where private.staff_session_factor_satisfied(p_user,p_session) and s.id=p_session');
  definition:=pg_get_functiondef('private.invitation_live(uuid,uuid,text)'::regprocedure);
  execute replace(definition,'where u.id=p_user','where private.staff_session_factor_satisfied(p_user,p_session) and u.id=p_user');
  definition:=pg_get_functiondef('private.account_tools_api(text,jsonb)'::regprocedure);
  if position('where u.id=viewer' in definition)=0 then raise exception 'Unexpected account tools guard';end if;
  execute replace(definition,'where u.id=viewer','where public.staff_token_factor_satisfied(viewer,sid,p_data->>''aal'') and u.id=viewer');
end $service_guards$;

do $policies$
declare item record;
begin
  for item in select c.oid,n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and c.relrowsecurity and (n.nspname='public' or (n.nspname='storage' and c.relname='objects')) loop
    execute format('create policy "Enrolled staff require verified MFA" on %I.%I as restrictive for all to authenticated using ((select public.staff_factor_satisfied())) with check ((select public.staff_factor_satisfied()))',item.nspname,item.relname);
  end loop;
end $policies$;

-- Suspension changes Auth authority, leaving each shop's operating status intact.
create function public.set_manager_account_enabled(manager uuid, enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.enforce_account_session();
  if private.live_staff_role() is distinct from 'admin' then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if enabled is null then raise exception 'INVALID_REQUEST'; end if;
  update auth.users set banned_until=case when enabled then null else now()+interval '100 years' end,
    updated_at=now()
    where id=manager and raw_app_meta_data->>'role'='manager' and deleted_at is null;
  if not found then raise exception 'MANAGER_NOT_FOUND'; end if;
  if not enabled then update auth.sessions set not_after=now() where user_id=manager; end if;
  insert into public.audit_logs(admin_user_id,action_type,target_user_id,new_values)
    values(auth.uid(),case when enabled then 'manager_enabled' else 'manager_disabled' end,manager,jsonb_build_object('is_active',enabled));
end $$;
create function public.admin_manager_statuses()
returns table(id uuid,is_active boolean) language plpgsql stable security definer set search_path='' as $$
begin
  perform public.enforce_account_session();
  if private.live_staff_role() is distinct from 'admin' then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  return query select u.id,coalesce(u.banned_until<=now(),true) from auth.users u
    where u.raw_app_meta_data->>'role'='manager' and u.deleted_at is null;
end $$;
revoke all on function public.set_manager_account_enabled(uuid,boolean),public.admin_manager_statuses() from public,anon;
grant execute on function public.set_manager_account_enabled(uuid,boolean),public.admin_manager_statuses() to authenticated;
notify pgrst,'reload schema';
