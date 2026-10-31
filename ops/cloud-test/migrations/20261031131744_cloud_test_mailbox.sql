-- Environment-only objects: never run this against production.
create table private.cloud_test_emails (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  subject text not null,
  link text,
  payload jsonb,
  created_at timestamptz not null default now()
);
alter table private.cloud_test_emails enable row level security;
revoke all on private.cloud_test_emails from public, anon, authenticated, service_role;

create function private.capture_cloud_test_email(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  delete from private.cloud_test_emails where created_at < now() - interval '1 day';
  insert into private.cloud_test_emails (recipient, subject, payload)
  values (coalesce(nullif(event->'user'->>'new_email', ''), event->'user'->>'email', ''),
    'Auth: ' || coalesce(event->'email_data'->>'email_action_type', 'notification'), event);
  return '{}'::jsonb;
end;
$$;
revoke all on function private.capture_cloud_test_email(jsonb) from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.capture_cloud_test_email(jsonb) to supabase_auth_admin;

create function public.cloud_test_mailbox(p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role required';
  end if;
  if p_action = 'capture' then
    delete from private.cloud_test_emails where created_at < now() - interval '1 day';
    insert into private.cloud_test_emails (recipient, subject, link)
    values (left(p_data->>'recipient', 254), left(p_data->>'subject', 200), p_data->>'link');
    return '{"success":true}'::jsonb;
  elsif p_action = 'list' then
    select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into result
    from (select * from private.cloud_test_emails where created_at > now() - interval '1 day'
      order by created_at desc limit 100) m;
    return result;
  end if;
  raise invalid_parameter_value using message = 'Invalid mailbox action';
end;
$$;
revoke all on function public.cloud_test_mailbox(text,jsonb) from public, anon, authenticated;
grant execute on function public.cloud_test_mailbox(text,jsonb) to service_role;
