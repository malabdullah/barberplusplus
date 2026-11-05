begin;

create or replace function public.account_sessions(p_revoke uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  current_session uuid;
  viewer uuid := auth.uid();
  account_user uuid;
  allowed_users uuid[] := array[auth.uid()];
begin
  perform public.enforce_account_session();
  current_session := private.current_account_session();
  if current_session is null then raise sqlstate 'PT401' using message='SESSION_ENDED'; end if;

  if exists (select 1 from auth.users where id=viewer and raw_app_meta_data->>'role'='customer') then
    select coalesce((select account_user_id from private.customer_social_identities where user_id=viewer),viewer)
      into account_user;
    select array_agg(id) into allowed_users
    from auth.users u where u.raw_app_meta_data->>'role'='customer'
      and (u.id=account_user or exists (
        select 1 from private.customer_social_identities i where i.user_id=u.id and i.account_user_id=account_user
      ));
  end if;

  if p_revoke is not null then
    if p_revoke=current_session then raise exception 'USE_SIGN_OUT_FOR_CURRENT_SESSION'; end if;
    update auth.sessions set not_after=now()
    where id=p_revoke and user_id=any(allowed_users) and (not_after is null or not_after>now());
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'device',left(coalesce(s.user_agent,''),256),
      'created_at',s.created_at,'last_active_at',coalesce(s.refreshed_at,s.created_at),
      'current',s.id=current_session
    ) order by (s.id=current_session) desc, coalesce(s.refreshed_at,s.created_at) desc, s.id), '[]'::jsonb)
    from auth.sessions s
    where s.user_id=any(allowed_users) and (s.not_after is null or s.not_after>now())
  );
end;
$$;
revoke all on function public.account_sessions(uuid) from public, anon, service_role;
grant execute on function public.account_sessions(uuid) to authenticated;


commit;
