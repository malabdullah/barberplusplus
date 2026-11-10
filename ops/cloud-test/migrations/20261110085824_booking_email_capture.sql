begin;
-- Test-only. Never include this mailbox migration in a production release.
create unique index cloud_test_booking_email_once on private.cloud_test_emails((payload->'bookingEmail'->>'idempotencyKey')) where payload ? 'bookingEmail';
create or replace function public.cloud_test_mailbox(p_action text,p_data jsonb default '{}')returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise insufficient_privilege using message='Service role required';end if;
 if p_action='capture' then
  if p_data ? 'bookingEmail' then
   if p_data->'bookingEmail'->>'idempotencyKey'!~'^[0-9a-f-]{36}$'or length(p_data->'bookingEmail'->>'text')>20000 or length(p_data->'bookingEmail'->>'html')>40000 then raise exception 'INVALID_REQUEST';end if;
   insert into private.cloud_test_emails(recipient,subject,payload)
    values(left(p_data->>'recipient',254),left(p_data->>'subject',200),jsonb_build_object('bookingEmail',p_data->'bookingEmail'))on conflict do nothing;
  else
   insert into private.cloud_test_emails(recipient,subject,link)values(left(p_data->>'recipient',254),left(p_data->>'subject',200),p_data->>'link');
  end if;
  return '{"success":true}'::jsonb;
 elsif p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(m)),'[]')into result from(select * from private.cloud_test_emails where created_at>now()-interval '1 day'order by created_at desc limit 100)m;return result;
 end if;
 raise invalid_parameter_value using message='Invalid mailbox action';
end $$;
revoke all on function public.cloud_test_mailbox(text,jsonb)from public,anon,authenticated;
grant execute on function public.cloud_test_mailbox(text,jsonb)to service_role;
commit;
