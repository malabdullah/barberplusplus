begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(9);

insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data)
values
  ('e1230000-0000-4000-8000-000000000001','security-pending@example.test','synthetic-old-hash',null,'{"role":"customer"}'),
  ('e1230000-0000-4000-8000-000000000002','security-established@example.test','synthetic-current-hash',now(),'{"role":"customer"}');
update auth.users set email_confirmed_at=now() where id='e1230000-0000-4000-8000-000000000001';
set constraints all immediate;
select ok((select email_confirmed_at is not null and encrypted_password is null from auth.users
  where id='e1230000-0000-4000-8000-000000000001'),'confirmation removes an old pending credential');
select is((select encrypted_password from auth.users where id='e1230000-0000-4000-8000-000000000002'),
  'synthetic-current-hash','already verified credentials are preserved');

select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='bookings'
  and policyname='Barbers can view own bookings' and qual like '%barber_id%'),
  'barber read policy scopes access to the assigned barber');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='bookings'
  and policyname='Barbers can view bookings in their branch'),'branch-wide barber read policy removed');

select ok(not has_function_privilege('anon','public.staff_customer_lookup(text,text,uuid)','execute'),
  'guest users cannot call customer contact lookup');
select ok(not has_function_privilege('authenticated','public.record_server_login_failure(text)','execute'),
  'browser sessions cannot supply trusted login events');
select ok(has_function_privilege('service_role','public.record_server_login_failure(text)','execute'),
  'authentication server can report rejected logins');
select public.record_server_login_failure('security-established@example.test');
select is((select count(*) from public.logs where user_id='e1230000-0000-4000-8000-000000000002'
  and action='login_failure' and server_verified),1::bigint,'server records trusted login failure');
select ok(exists(select 1 from cron.job where jobname='customer-auth-limit-retention' and active),
  'expired auth rate limit rows have scheduled cleanup');

select * from finish();
rollback;
