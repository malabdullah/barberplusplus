begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(14);

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('dc090000-0000-4000-8000-000000000101','appointment-owner@example.test',now(),'{"role":"customer"}'),
('dc090000-0000-4000-8000-000000000102','appointment-other@example.test',now(),'{"role":"customer"}'),
('dc090000-0000-4000-8000-000000000103','appointment-manager@example.test',now(),'{"role":"manager"}');
insert into auth.sessions(id,user_id) values
('dc090000-0000-4000-8000-000000000201','dc090000-0000-4000-8000-000000000101'),
('dc090000-0000-4000-8000-000000000202','dc090000-0000-4000-8000-000000000102');
select set_config('appointments.owner','{"user_id":"dc090000-0000-4000-8000-000000000101","session_id":"dc090000-0000-4000-8000-000000000201","name":"Appointment Owner"}',true);
select set_config('appointments.other','{"user_id":"dc090000-0000-4000-8000-000000000102","session_id":"dc090000-0000-4000-8000-000000000202","name":"Appointment Other"}',true);
select set_config('appointments.day',((now() at time zone 'Asia/Kuwait')::date+1)::text,true);
select public.customer_account_api('email-ensure',current_setting('appointments.owner')::jsonb);
select public.customer_account_api('email-ensure',current_setting('appointments.other')::jsonb);

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

select ok(not has_function_privilege('anon','public.customer_account_api(text,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','private.customer_appointment_api(text,jsonb)','EXECUTE'),'only the gateway can submit an identity');
set local role service_role;
select ok((select item->>'location_url'='https://example.test/maps' and item->>'cancellation_cutoff' is not null
  from jsonb_array_elements(public.customer_account_api('bookings',current_setting('appointments.owner')::jsonb)) item
  where item->>'id'='dc090000-0000-4000-8000-000000000601'),'history includes directions and the cancellation cutoff');
select ok((public.customer_account_api('appointment-slots',current_setting('appointments.owner')::jsonb || current_setting('appointments.target')::jsonb)->'slots') ? '10:15','slot can overlap the customer’s original appointment');
select throws_ok($$select public.customer_account_api('appointment-slots',current_setting('appointments.other')::jsonb || current_setting('appointments.target')::jsonb)$$,
  'P0001','BOOKING_NOT_MANAGEABLE','cannot look up another customer’s slots');
select throws_ok($$select public.customer_account_api('reschedule-booking',current_setting('appointments.other')::jsonb || current_setting('appointments.target')::jsonb)$$,
  'P0001','BOOKING_NOT_MANAGEABLE','cannot reschedule another customer’s appointment');
select throws_ok($$select public.customer_account_api('cancel-booking',current_setting('appointments.other')::jsonb || current_setting('appointments.target')::jsonb)$$,
  'P0001','BOOKING_NOT_MANAGEABLE','cannot cancel another customer’s appointment');
select throws_ok($$select public.customer_account_api('cancel-booking',current_setting('appointments.owner')::jsonb || current_setting('appointments.target')::jsonb || '{"booking_id":"dc090000-0000-4000-8000-000000000603"}')$$,
  'P0001','BOOKING_NOT_MANAGEABLE','appointment start is the cancellation cutoff');
select throws_ok($$select public.customer_account_api('reschedule-booking',current_setting('appointments.owner')::jsonb || current_setting('appointments.target')::jsonb || '{"time":"12:00"}')$$,
  'P0001','SLOT_UNAVAILABLE','occupied slot rejected');
select is((select time from public.bookings where id='dc090000-0000-4000-8000-000000000601'),'10:00'::time,'failed move retains the original booking');
select is(public.customer_account_api('reschedule-booking',current_setting('appointments.owner')::jsonb || current_setting('appointments.target')::jsonb)->>'time',
  '10:15','same booking moves to the new slot');
select ok((select duration=45 and price=5 and status='confirmed' and modified_by_type='customer'
  and service_ids=array['dc090000-0000-4000-8000-000000000501'::uuid] from public.bookings where id='dc090000-0000-4000-8000-000000000601'),'move preserves original services, price, duration, and status');
select is(public.customer_account_api('reschedule-booking',current_setting('appointments.owner')::jsonb || current_setting('appointments.target')::jsonb)->>'time',
  '10:15','retry of an already committed move is safe');
select throws_ok($$select public.customer_account_api('cancel-booking',current_setting('appointments.owner')::jsonb || current_setting('appointments.target')::jsonb)$$,
  'P0001','BOOKING_CHANGED','stale confirmation cannot cancel a changed booking');
select is(public.customer_account_api('cancel-booking',current_setting('appointments.owner')::jsonb || current_setting('appointments.target')::jsonb || '{"expected_time":"10:15"}')->>'status',
  'cancelled','customer can cancel the current future appointment');
reset role;

select * from finish();
rollback;
