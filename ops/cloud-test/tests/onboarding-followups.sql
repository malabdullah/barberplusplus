-- Hosted barber-test only. Synthetic post-provider Auth facts; no real OAuth,
-- password, email delivery or persistent fixture. Every write rolls back.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $onboarding$
declare
 manager_id uuid:='fb251125-0000-4000-8000-000000000001';
 manager_session uuid:='fb251125-0000-4000-8000-000000000002';
 shop_id uuid:='fb251125-0000-4000-8000-000000000003';
 service_id uuid:='fb251125-0000-4000-8000-000000000004';
 managed_id uuid:='fb251125-0000-4000-8000-000000000005';
 person uuid; sid uuid; invitation jsonb; scope jsonb; result jsonb;
 provider_name text; address text; denied boolean; proposal jsonb; auth_count bigint;
begin
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
 values(manager_id,'onboarding-followup-manager@example.test',now(),'{"role":"manager"}');
 insert into auth.sessions(id,user_id)values(manager_session,manager_id);
 insert into public.branches(id,name,manager_id,working_hours)
 select shop_id,'Onboarding followup rollback QA',manager_id,jsonb_object_agg(day,'{"open":"09:00","close":"18:00"}'::jsonb)
 from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])day;
 insert into public.services(id,branch_id,name,duration,price)values(service_id,shop_id,'QA haircut',30,3);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 foreach provider_name in array array['google','apple']loop
  address:='onboarding-followup-'||provider_name||'@example.test';person:=gen_random_uuid();sid:=gen_random_uuid();
  assert public.shop_barber_invitation_api('check',jsonb_build_object('actor',manager_id,'session',manager_session,'branch_id',shop_id,'email',address))->>'kind'='new','new email starts as an invitee';
  invitation:=public.shop_barber_invitation_api('send',jsonb_build_object('actor',manager_id,'session',manager_session,'branch_id',shop_id,'email',address,'token_hash',repeat('a',64)));
  -- Models the verified Auth record after the provider callback. It does not
  -- claim that this SQL test contacted Google/Apple or verified their tokens.
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
  values(person,address,now(),jsonb_build_object('provider',provider_name,'providers',jsonb_build_array(provider_name)),jsonb_build_object('name','OAuth QA Barber'));
  insert into auth.sessions(id,user_id)values(sid,person);
  assert(select raw_app_meta_data->>'role'='customer'from auth.users where id=person),'social Auth defaults to customer until invitation acceptance';
  scope:=jsonb_build_object('id',invitation->>'id','token_hash',repeat('a',64));
  result:=public.shop_barber_invitation_api('resolve',scope||jsonb_build_object('actor',person,'session',sid));
  assert result->>'kind'='customer'and result->>'signed_in'='true','same social account can complete without new password';
  denied:=false;begin
   perform public.shop_barber_invitation_api('accept',scope||jsonb_build_object('actor',manager_id,'session',manager_session));
  exception when others then denied:=sqlerrm='AUTH_REQUIRED';end;
  assert denied,'another authenticated person cannot accept';
  result:=public.shop_barber_invitation_api('accept',scope||jsonb_build_object('actor',person,'session',sid,'name','OAuth QA Barber','country_code','+965','phone',case when provider_name='google'then'59972531'else'59972532'end));
  assert result->>'accepted'='true','social identity accepts valid invitation';
  assert(select raw_app_meta_data->>'role'='barber'and raw_app_meta_data->>'provider'=provider_name and encrypted_password is null from auth.users where id=person),'same provider account retained without password';
  assert(select count(*)=1 from public.barbers where user_id=person and branch_id=shop_id and status='inactive'and availability_approved_at is null),'one inactive barber awaits their schedule';
  denied:=false;begin perform public.shop_barber_invitation_api('accept',scope||jsonb_build_object('actor',person,'session',sid));exception when others then denied:=sqlerrm='INVITE_USED';end;
  assert denied,'accepted invitation is single-use';
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_id,'session_id',manager_session,'role','authenticated','app_metadata',jsonb_build_object('role','manager'))::text,true);
 select count(*) into auth_count from auth.users;
 result:=public.create_managed_barber(shop_id,jsonb_build_object('id',managed_id,'name','Wizard managed QA','service_ids',jsonb_build_array(service_id)));
 assert result->>'id'=managed_id::text,'manager creates the profile in the explicit shop';
 assert(select user_id is null and email is null and management_mode='managed'and status='inactive'from public.barbers where id=managed_id),'managed creation has no login account or invitation';
 select jsonb_build_object('availability',jsonb_object_agg(day,'{"enabled":true,"start":"09:00","end":"18:00"}'::jsonb),'time_offs','[]'::jsonb,'vacations','[]'::jsonb,'max_booking_days',30)
 into proposal from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])day;
 perform public.barber_availability('direct',jsonb_build_object('barber_id',managed_id,'base_revision',0,'proposal',proposal));
 assert(select availability_approved_at is not null from public.barbers where id=managed_id),'manager sets hours directly without an approval request';
 assert(select count(*)=auth_count from auth.users),'managed creation and hours do not create Auth credentials';
end $onboarding$;
select 'PASS: Google/Apple synthetic acceptance and managed setup boundaries' as result;
rollback;
