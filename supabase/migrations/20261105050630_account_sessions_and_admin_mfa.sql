begin;

-- Read the session from signed JWT claims and verify it against Auth's live state.
create function private.current_account_session() returns uuid
language sql stable security definer set search_path='' as $$
  select s.id
  from auth.sessions s
  join auth.users u on u.id=s.user_id
  where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=auth.uid()
    and (s.not_after is null or s.not_after>now())
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
$$;
revoke all on function private.current_account_session() from public, anon, authenticated, service_role;

create function public.enforce_account_session() returns void
language plpgsql stable security definer set search_path='' as $$
declare
  current_session uuid;
begin
  if auth.jwt()->>'role' is distinct from 'authenticated' then return; end if;
  current_session := private.current_account_session();
  if current_session is null then raise sqlstate 'PT401' using message='SESSION_ENDED'; end if;
  if exists (
    select 1 from auth.users u where u.id=auth.uid() and u.raw_app_meta_data->>'role'='admin'
  ) and (auth.jwt()->>'aal' is distinct from 'aal2' or not exists (
    select 1 from auth.sessions s
    join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
    where s.id=current_session and s.aal='aal2' and f.status='verified' and f.factor_type='totp'
  )) then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode='42501';
  end if;
end;
$$;
revoke all on function public.enforce_account_session() from public;
grant execute on function public.enforce_account_session() to anon, authenticated, service_role;

create function public.account_sessions(p_revoke uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  current_session uuid;
begin
  perform public.enforce_account_session();
  current_session := private.current_account_session();
  if current_session is null then raise sqlstate 'PT401' using message='SESSION_ENDED'; end if;

  if p_revoke is not null then
    if p_revoke=current_session then raise exception 'USE_SIGN_OUT_FOR_CURRENT_SESSION'; end if;
    update auth.sessions set not_after=now()
    where id=p_revoke and user_id=auth.uid() and (not_after is null or not_after>now());
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'device',left(coalesce(s.user_agent,''),256),
      'created_at',s.created_at,'last_active_at',coalesce(s.refreshed_at,s.created_at),
      'current',s.id=current_session
    ) order by (s.id=current_session) desc, coalesce(s.refreshed_at,s.created_at) desc, s.id), '[]'::jsonb)
    from auth.sessions s
    where s.user_id=auth.uid() and (s.not_after is null or s.not_after>now())
  );
end;
$$;
revoke all on function public.account_sessions(uuid) from public, anon, service_role;
grant execute on function public.account_sessions(uuid) to authenticated;

-- The Data API guard covers both table access and existing admin RPCs.
alter role authenticator set pgrst.db_pre_request = 'public.enforce_account_session';
notify pgrst, 'reload config';

commit;
