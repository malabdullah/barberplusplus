begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(27);

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('dc090000-0000-4000-8000-000000000101','appointment-owner@example.test',now(),'{"role":"customer"}'),
('dc090000-0000-4000-8000-000000000102','appointment-other@example.test',now(),'{"role":"customer"}'),
('dc090000-0000-4000-8000-000000000103','appointment-manager@example.test',now(),'{"role":"manager"}'),
('dc090000-0000-4000-8000-000000000104','policy-admin@example.test',now(),'{"role":"admin"}'),
('dc090000-0000-4000-8000-000000000105','policy-barber@example.test',now(),'{"role":"barber"}');
insert into auth.sessions(id,user_id) values
('dc090000-0000-4000-8000-000000000201','dc090000-0000-4000-8000-000000000101'),
('dc090000-0000-4000-8000-000000000202','dc090000-0000-4000-8000-000000000102');
select set_config('appointments.owner','{"user_id":"dc090000-0000-4000-8000-000000000101","session_id":"dc090000-0000-4000-8000-000000000201","name":"Appointment Owner"}',true);
select set_config('appointments.other','{"user_id":"dc090000-0000-4000-8000-000000000102","session_id":"dc090000-0000-4000-8000-000000000202","name":"Appointment Other"}',true);
select set_config('appointments.day',((now() at time zone 'Asia/Kuwait')::date+1)::text,true);
select public.customer_account_api('email-ensure',current_setting('appointments.owner')::jsonb);
select public.customer_account_api('email-ensure',current_setting('appointments.other')::jsonb);
update public.admin_settings set setting_value='120' where setting_key in ('customer_cancel_notice_minutes','customer_reschedule_notice_minutes');

insert into public.branches(id,manager_id,name,status,location_url,working_hours)
select 'dc090000-0000-4000-8000-000000000301','dc090000-0000-4000-8000-000000000103','Appointment Shop','active','https://example.test/maps',
  jsonb_object_agg(day,'{"open":"09:00","close":"18:00","closed":false}'::jsonb)
from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day;
insert into public.services(id,branch_id,name,status,duration,price) values
('dc090000-0000-4000-8000-000000000501','dc090000-0000-4000-8000-000000000301','Haircut','active',30,7);
insert into public.barbers(id,branch_id,name,status,service_ids,max_booking_days,availability)
select 'dc090000-0000-4000-8000-000000000401','dc090000-0000-4000-8000-000000000301','Appointment Barber','active',
  array['dc090000-0000-4000-8000-000000000501'::uuid],30,
  jsonb_object_agg(day,'{"start":"09:00","end":"18:00","enabled":true}'::jsonb)
from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day;
insert into public.bookings(id,branch_id,barber_id,service_ids,date,time,duration,price,status)
select id::uuid,'dc090000-0000-4000-8000-000000000301','dc090000-0000-4000-8000-000000000401',
  array['dc090000-0000-4000-8000-000000000501'::uuid],current_setting('appointments.day')::date+days,
  slot::time,45,5,'confirmed'
from (values
  ('dc090000-0000-4000-8000-000000000601',0,'10:00'),
  ('dc090000-0000-4000-8000-000000000602',0,'12:00'),
  ('dc090000-0000-4000-8000-000000000603',-2,'10:00')
) as fixture(id,days,slot);
insert into private.customer_booking_owners(booking_id,account_user_id) values
('dc090000-0000-4000-8000-000000000601','dc090000-0000-4000-8000-000000000101'),
('dc090000-0000-4000-8000-000000000603','dc090000-0000-4000-8000-000000000101');
select set_config('appointments.target',jsonb_build_object(
  'booking_id','dc090000-0000-4000-8000-000000000601','expected_date',current_setting('appointments.day'),
  'expected_time','10:00','date',current_setting('appointments.day'),'time','10:15')::text,true);

update public.barbers set user_id='dc090000-0000-4000-8000-000000000105'
where id='dc090000-0000-4000-8000-000000000401';
select set_config('request.jwt.claims','{}',true);
with next_time as (select (now() at time zone 'Asia/Kuwait') + interval '65 minutes' as starts)
insert into public.bookings(id,branch_id,barber_id,date,time,duration,status)
select 'dc090000-0000-4000-8000-000000000605','dc090000-0000-4000-8000-000000000301',
  'dc090000-0000-4000-8000-000000000401',starts::date,starts::time,15,'confirmed' from next_time;
insert into private.customer_booking_owners(booking_id,account_user_id) values
('dc090000-0000-4000-8000-000000000605','dc090000-0000-4000-8000-000000000101');
select is(public.shop_booking_policy('dc090000-0000-4000-8000-000000000301'),
  '{"cancel_minutes":120,"reschedule_minutes":120}'::jsonb,'shops inherit separate two-hour defaults');
select ok(not has_function_privilege('anon','public.manage_booking_policy(uuid,jsonb)','EXECUTE'),'anonymous clients cannot manage policies');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"dc090000-0000-4000-8000-000000000103","role":"authenticated","app_metadata":{"role":"manager"}}',true);
select throws_ok($$select public.manage_booking_policy(null,'{"cancel_minutes":0,"reschedule_minutes":0}')$$,
  '42501','BOOKING_POLICY_FORBIDDEN','manager cannot change platform defaults');
select throws_ok($$select public.manage_booking_policy('dc090000-0000-4000-8000-000000000999','{"cancel_minutes":0,"reschedule_minutes":0,"barber_can_cancel":false}')$$,
  '42501','BOOKING_POLICY_FORBIDDEN','manager cannot override a different shop');
select lives_ok($$select public.manage_booking_policy('dc090000-0000-4000-8000-000000000301','{"cancel_minutes":0,"reschedule_minutes":240,"barber_can_cancel":false}')$$,
  'manager can shorten one deadline and lengthen the other');
reset role;
select is(public.shop_booking_policy('dc090000-0000-4000-8000-000000000301'),
  '{"cancel_minutes":0,"reschedule_minutes":240}'::jsonb,'public settings show effective notice without staff permissions');
select is((select cancel_notice_minutes from public.bookings where id='dc090000-0000-4000-8000-000000000601'),120,'existing appointments retain snapshotted notice');
select set_config('request.jwt.claims','{}',true);
with next_time as (select (now() at time zone 'Asia/Kuwait') + interval '30 minutes' as starts)
insert into public.bookings(id,branch_id,barber_id,date,time,duration,status)
select 'dc090000-0000-4000-8000-000000000604','dc090000-0000-4000-8000-000000000301',
  'dc090000-0000-4000-8000-000000000401',starts::date,starts::time,15,'confirmed' from next_time;
insert into private.customer_booking_owners(booking_id,account_user_id) values
('dc090000-0000-4000-8000-000000000604','dc090000-0000-4000-8000-000000000101');
select ok((select cancel_notice_minutes=0 and reschedule_notice_minutes=240 from public.bookings
  where id='dc090000-0000-4000-8000-000000000604'),'new booking snapshots both shop overrides');
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select throws_ok($$select public.customer_account_api('appointment-slots',current_setting('appointments.owner')::jsonb
  || current_setting('appointments.target')::jsonb || '{"booking_id":"dc090000-0000-4000-8000-000000000604"}')$$,
  'P0001','BOOKING_CUTOFF_PASSED','customer rescheduling is blocked by its own cutoff');
select throws_ok($$select public.customer_account_api('cancel-booking',current_setting('appointments.owner')::jsonb
  || current_setting('appointments.target')::jsonb || '{"booking_id":"dc090000-0000-4000-8000-000000000605"}')$$,
  'P0001','BOOKING_CUTOFF_PASSED','customer cancellation is blocked by its own cutoff');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"dc090000-0000-4000-8000-000000000105","role":"authenticated","app_metadata":{"role":"barber"}}',true);
select throws_ok($$update public.bookings set status='cancelled',staff_cancellation='{"reason":"Unavailable"}'
  where id='dc090000-0000-4000-8000-000000000601'$$,
  '42501','STAFF_CANCELLATION_NOT_ALLOWED','barber cancellation is disabled by default for the shop');
select throws_ok($$update public.bookings set status='no_show'
  where id='dc090000-0000-4000-8000-000000000601'$$,
  'P0001','BOOKING_NO_SHOW_BEFORE_START','barber cannot free a future slot through no-show');
select throws_ok($$update public.bookings set status='no_show',date=date-3
  where id='dc090000-0000-4000-8000-000000000601'$$,
  'P0001','BOOKING_NO_SHOW_BEFORE_START','backdating and marking no-show in the same request fails');
select throws_ok($$update public.bookings set date=date-3
  where id='dc090000-0000-4000-8000-000000000601'$$,
  'P0001','BOOKING_CANNOT_BE_BACKDATED','a separate request cannot backdate a future booking either');
select lives_ok($$update public.bookings set status='no_show'
  where id='dc090000-0000-4000-8000-000000000603'$$,'barber can record no-show after the start');
select is((select status from public.bookings where id='dc090000-0000-4000-8000-000000000603'),
  'no_show','past no-show is persisted');
reset role;
update private.shop_booking_policies set barber_can_cancel=true where branch_id='dc090000-0000-4000-8000-000000000301';
set local role authenticated;
select throws_ok($$update public.bookings set status='cancelled' where id='dc090000-0000-4000-8000-000000000601'$$,
  'P0001','CANCELLATION_REASON_REQUIRED','staff cancellation requires a reason');
select lives_ok($$update public.bookings set status='cancelled',staff_cancellation='{"reason":"Barber unavailable","actor":"admin"}'
  where id='dc090000-0000-4000-8000-000000000601'$$,'permitted barber may cancel their appointment');
reset role;
select ok((select modified_by_type='barber' and staff_cancellation->>'actor'='barber'
  and staff_cancellation->>'user_id'='dc090000-0000-4000-8000-000000000105' from public.bookings
  where id='dc090000-0000-4000-8000-000000000601'),'server records actual actor and ignores spoofed metadata');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"dc090000-0000-4000-8000-000000000103","role":"authenticated","app_metadata":{"role":"manager"}}',true);
with deleted as (
  delete from public.bookings where id='dc090000-0000-4000-8000-000000000605' returning id
)
select is((select count(*) from deleted),0::bigint,'manager cannot delete a booking directly');
select throws_ok($$delete from public.barbers where id='dc090000-0000-4000-8000-000000000401'$$,
  '42501','BOOKING_DELETE_FORBIDDEN','manager cannot erase bookings through a barber');
select throws_ok($$delete from public.branches where id='dc090000-0000-4000-8000-000000000301'$$,
  '42501','BOOKING_DELETE_FORBIDDEN','manager cannot erase bookings through a shop');
select throws_ok($$insert into public.bookings(id,branch_id,barber_id,date,time,duration,status)
  values('dc090000-0000-4000-8000-000000000606','dc090000-0000-4000-8000-000000000301',
    'dc090000-0000-4000-8000-000000000401',current_date+2,'10:00',15,'no_show')$$,
  'P0001','BOOKING_NO_SHOW_BEFORE_START','staff cannot create a future no-show directly');
select lives_ok($$update public.bookings set status='cancelled',staff_cancellation='{"reason":"Shop emergency"}'
  where id='dc090000-0000-4000-8000-000000000605'$$,'manager may cancel inside the customer notice window');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select ok((select item->'staff_cancellation'->>'reason'='Shop emergency' and not (item->'staff_cancellation' ? 'user_id')
  from jsonb_array_elements(public.customer_account_api('bookings',current_setting('appointments.owner')::jsonb)) item
  where item->>'id'='dc090000-0000-4000-8000-000000000605'),'the customer receives the reason without the staff account ID');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"dc090000-0000-4000-8000-000000000104","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
select lives_ok($$select public.manage_booking_policy(null,'{"cancel_minutes":90,"reschedule_minutes":150}')$$,
  'admin can update both defaults together');
with deleted as (
  delete from public.bookings where id='dc090000-0000-4000-8000-000000000602' returning id
)
select is((select count(*) from deleted),1::bigint,'admin retains explicit booking deletion');
reset role;
select * from finish();
rollback;
