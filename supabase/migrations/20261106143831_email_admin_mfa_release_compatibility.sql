-- Required admin assurance for the email-management release. No account rows change.
begin;

-- Read the session from signed JWT claims and verify it against Auth's live state.
create or replace function private.current_account_session() returns uuid
language sql stable security definer set search_path='' as $$
  select s.id
  from auth.sessions s
  join auth.users u on u.id=s.user_id
  where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=auth.uid()
    and (s.not_after is null or s.not_after>now())
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
$$;
revoke all on function private.current_account_session() from public, anon, authenticated, service_role;

create or replace function public.enforce_account_session() returns void
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


do $$
declare target text;
begin
  foreach target in array array['bookings','notifications','whatsapp_conversations','whatsapp_messages'] loop
    if not exists(select 1 from pg_policy where polrelid=('public.'||target)::regclass and polname='Admin realtime reads require MFA') then
      execute format('create policy "Admin realtime reads require MFA" on public.%I as restrictive for select to authenticated using (((select auth.jwt()->''app_metadata''->>''role'') is distinct from ''admin'') or ((select auth.jwt()->>''aal'')=''aal2''))',target);
    end if;
  end loop;
end;
$$;
notify pgrst,'reload schema';
commit;
