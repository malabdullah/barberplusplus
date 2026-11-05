begin;

create function public.customer_session_is_live(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=p_session and s.user_id=p_user and u.raw_app_meta_data->>'role'='customer'
      and (s.not_after is null or s.not_after>now()) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
  )
$$;
revoke all on function public.customer_session_is_live(uuid,uuid) from public, anon, authenticated;
grant execute on function public.customer_session_is_live(uuid,uuid) to service_role;

commit;
