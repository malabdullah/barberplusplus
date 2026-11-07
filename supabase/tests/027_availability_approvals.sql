begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
 ('ec080000-0000-4000-8000-000000000001','availability-manager@example.test','{"role":"manager"}'),
 ('ec080000-0000-4000-8000-000000000002','availability-barber@example.test','{"role":"barber"}'),
 ('ec080000-0000-4000-8000-000000000003','availability-other@example.test','{"role":"manager"}'),
 ('ec080000-0000-4000-8000-000000000004','availability-customer@example.test','{"role":"customer"}');
insert into public.branches(id,manager_id,name,working_hours)
select 'ec080000-0000-4000-8000-000000000101','ec080000-0000-4000-8000-000000000001','Availability QA',
 jsonb_object_agg(day,'{"open":"09:00","close":"18:00"}'::jsonb) from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day;
insert into public.branches(id,manager_id,name) values('ec080000-0000-4000-8000-000000000102','ec080000-0000-4000-8000-000000000003','Other shop');
insert into public.services(id,branch_id,name,duration,price) values('ec080000-0000-4000-8000-000000000201','ec080000-0000-4000-8000-000000000101','Haircut',30,3);
insert into public.barbers(id,branch_id,user_id,name,service_ids,availability)
select 'ec080000-0000-4000-8000-000000000301','ec080000-0000-4000-8000-000000000101','ec080000-0000-4000-8000-000000000002','Availability Barber',array['ec080000-0000-4000-8000-000000000201']::uuid[],
 jsonb_object_agg(day,'{"enabled":true,"start":"09:00","end":"18:00"}'::jsonb) from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day;
insert into public.customers(id,name,country_code,phone) values('ec080000-0000-4000-8000-000000000401','Availability Customer','+965','59979661');
insert into public.bookings(id,branch_id,barber_id,customer_id,service_ids,date,time,duration,price,status,added_by_type)
select fixture.id::uuid,'ec080000-0000-4000-8000-000000000101','ec080000-0000-4000-8000-000000000301','ec080000-0000-4000-8000-000000000401',array['ec080000-0000-4000-8000-000000000201']::uuid[],
 (clock_timestamp() at time zone 'Asia/Kuwait')::date+2,fixture.slot::time,30,3,'confirmed','customer'
from (values('ec080000-0000-4000-8000-000000000501','10:00'),('ec080000-0000-4000-8000-000000000502','11:00')) fixture(id,slot);
select set_config('availability.proposal',(private.availability_snapshot(b)||jsonb_build_object('vacations',jsonb_build_array(jsonb_build_object('id','qa-vacation','startDate',((clock_timestamp() at time zone 'Asia/Kuwait')::date+2)::text,'endDate',((clock_timestamp() at time zone 'Asia/Kuwait')::date+2)::text))))::text,true) from public.barbers b where id='ec080000-0000-4000-8000-000000000301';
select ok(not has_table_privilege('authenticated','private.availability_requests','SELECT'),'requests cannot be enumerated through raw table access');
select ok((select relrowsecurity from pg_class where oid='private.availability_requests'::regclass),'request history has RLS');
select ok(not has_function_privilege('anon','public.barber_availability(text,jsonb)','EXECUTE'),'anonymous cannot call availability API');
select set_config('request.jwt.claims','{"sub":"ec080000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"barber"}}',true);
set local role authenticated;
select set_config('availability.saved',public.barber_availability('submit',jsonb_build_object('barber_id','ec080000-0000-4000-8000-000000000301','base_revision',0,'proposal',current_setting('availability.proposal')::jsonb))::text,true);
select is(current_setting('availability.saved')::jsonb->'request'->>'status','pending','barber submits a pending proposal');
select is((select jsonb_array_length(vacations) from public.barbers where id='ec080000-0000-4000-8000-000000000301'),0,'pending vacation does not change approved availability');
select is(public.barber_availability('submit',jsonb_build_object('barber_id','ec080000-0000-4000-8000-000000000301','base_revision',0,'proposal',current_setting('availability.proposal')::jsonb))->'request'->>'id',current_setting('availability.saved')::jsonb->'request'->>'id','identical submission retry is idempotent');
select throws_ok($$update public.barbers set vacations=current_setting('availability.proposal')::jsonb->'vacations' where id='ec080000-0000-4000-8000-000000000301'$$,'42501','AVAILABILITY_APPROVAL_REQUIRED','barber cannot bypass approval through direct update');
select throws_ok($$select public.barber_availability('approve',jsonb_build_object('request_id',current_setting('availability.saved')::jsonb->'request'->>'id','base_revision',0))$$,'42501','NOT_AUTHORIZED','barber cannot approve their own request');
select throws_ok($$update public.barbers set branch_id='ec080000-0000-4000-8000-000000000102',service_ids='{}' where id='ec080000-0000-4000-8000-000000000301'$$,'42501','NOT_AUTHORIZED','barber cannot transfer themselves to bypass manager ownership');
reset role;
select set_config('request.jwt.claims','{"sub":"ec080000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select is(jsonb_array_length(public.barber_availability('list')->'requests'),0,'another manager cannot list this request');
select throws_ok($$select public.barber_availability('get','{"barber_id":"ec080000-0000-4000-8000-000000000301"}')$$,'42501','NOT_AUTHORIZED','another manager cannot inspect the proposal');
reset role;
select set_config('request.jwt.claims','{"sub":"ec080000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select is(jsonb_array_length(public.barber_availability('preview',jsonb_build_object('request_id',current_setting('availability.saved')::jsonb->'request'->>'id'))->'conflicts'),2,'review lists both affected appointments');
select is((public.barber_availability('approve',jsonb_build_object('request_id',current_setting('availability.saved')::jsonb->'request'->>'id','base_revision',0))->>'blocked')::boolean,true,'approval is blocked until appointments are resolved');
select is((select count(*) from public.bookings where id in('ec080000-0000-4000-8000-000000000501','ec080000-0000-4000-8000-000000000502') and status='confirmed'),2::bigint,'blocked approval never cancels appointments');
select is((select to_char(time,'HH24:MI') from public.bookings where id='ec080000-0000-4000-8000-000000000501'),'10:00','blocked approval never moves appointments');
select is((select availability_revision from public.barbers where id='ec080000-0000-4000-8000-000000000301'),0,'blocked approval preserves the approved revision');
select throws_ok($$update public.barbers set vacations=current_setting('availability.proposal')::jsonb->'vacations' where id='ec080000-0000-4000-8000-000000000301'$$,'P0001','AVAILABILITY_INDIVIDUAL_REVIEW_REQUIRED','direct manager writes cannot bypass individual request review');
update public.bookings set status='cancelled',staff_cancellation='{"reason":"Explicit synthetic cancellation"}' where id='ec080000-0000-4000-8000-000000000501';
select is(jsonb_array_length(public.barber_availability('preview',jsonb_build_object('request_id',current_setting('availability.saved')::jsonb->'request'->>'id'))->'conflicts'),1,'explicit cancellation resolves only that appointment');
update public.bookings set date=date+1 where id='ec080000-0000-4000-8000-000000000502';
select is((public.barber_availability('approve',jsonb_build_object('request_id',current_setting('availability.saved')::jsonb->'request'->>'id','base_revision',0))->>'blocked')::boolean,false,'approval succeeds once manager explicitly resolves remaining appointment');
select is((select availability_revision from public.barbers where id='ec080000-0000-4000-8000-000000000301'),1,'successful approval advances the revision once');
select is((select jsonb_array_length(vacations) from public.barbers where id='ec080000-0000-4000-8000-000000000301'),1,'approved vacation is applied');
select throws_ok($$select public.barber_availability('approve',jsonb_build_object('request_id',current_setting('availability.saved')::jsonb->'request'->>'id','base_revision',0))$$,'P0001','AVAILABILITY_STALE','approval cannot be replayed');
reset role;
select is((select count(*) from private.availability_writes),0::bigint,'no write permit remains after approval');
select is((select count(*) from public.notifications where entity_type='availability_request' and recipient_user_id='ec080000-0000-4000-8000-000000000001'),1::bigint,'one manager notification despite retried submission');
select is((select count(*) from public.notifications where entity_type='availability_request' and recipient_user_id='ec080000-0000-4000-8000-000000000002'),1::bigint,'barber receives the approval decision');
select set_config('request.jwt.claims','{"sub":"ec080000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"barber"}}',true);
set local role authenticated;
select set_config('availability.second',public.barber_availability('submit',jsonb_build_object('barber_id','ec080000-0000-4000-8000-000000000301','base_revision',1,'proposal',jsonb_set(current_setting('availability.proposal')::jsonb,'{vacations,0,endDate}',to_jsonb(((clock_timestamp() at time zone 'Asia/Kuwait')::date+3)::text))))::text,true);
reset role;
select set_config('request.jwt.claims','{"sub":"ec080000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select is(public.barber_availability('approve',jsonb_build_object('request_id',current_setting('availability.second')::jsonb->'request'->>'id','base_revision',1,'value',jsonb_build_object('id','qa-vacation','startDate',((clock_timestamp() at time zone 'Asia/Kuwait')::date+4)::text,'endDate',((clock_timestamp() at time zone 'Asia/Kuwait')::date+4)::text)))->'request'->>'status','approved','manager can modify then approve the proposal');
reset role;
select is((select jsonb_array_length(proposal->'vacations') from private.availability_requests where id=(current_setting('availability.second')::jsonb->'request'->>'id')::uuid),1,'original submitted proposal is retained in history');
select is((select approved_value->>'startDate' from private.availability_requests where id=(current_setting('availability.second')::jsonb->'request'->>'id')::uuid),((clock_timestamp() at time zone 'Asia/Kuwait')::date+4)::text,'manager-modified approval is recorded separately');
select set_config('request.jwt.claims','{"sub":"ec080000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"barber"}}',true);
set local role authenticated;
select set_config('availability.third',public.barber_availability('submit',jsonb_build_object('barber_id','ec080000-0000-4000-8000-000000000301','base_revision',2,'proposal',current_setting('availability.proposal')::jsonb))::text,true);
reset role;
select set_config('request.jwt.claims','{"sub":"ec080000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select throws_ok($$select public.barber_availability('decline',jsonb_build_object('request_id',current_setting('availability.third')::jsonb->'request'->>'id','note',''))$$,'P0001','AVAILABILITY_REASON_REQUIRED','declining requires a reason');
select is(public.barber_availability('decline',jsonb_build_object('request_id',current_setting('availability.third')::jsonb->'request'->>'id','note','Please choose different dates'))->'request'->>'status','declined','manager can decline with a clear reason');
select is((select availability_revision from public.barbers where id='ec080000-0000-4000-8000-000000000301'),2,'decline does not alter approved availability');
select throws_ok($$insert into public.barbers(id,branch_id,name,service_ids,availability) values('ec080000-0000-4000-8000-000000000302','ec080000-0000-4000-8000-000000000101','Pending new barber',array['ec080000-0000-4000-8000-000000000201']::uuid[],'{"monday":{"enabled":true,"start":"09:00","end":"18:00"}}')$$,'42501','INVITATION_REQUIRED','manager must invite a new barber instead of inserting one');
reset role;
select set_config('request.jwt.claims','{}',true);
-- Fixture matches the inactive profile produced by invitation acceptance.
insert into public.barbers(id,branch_id,name,service_ids,availability,availability_approved_at) values('ec080000-0000-4000-8000-000000000302','ec080000-0000-4000-8000-000000000101','Pending new barber',array['ec080000-0000-4000-8000-000000000201']::uuid[],'{}',null);
select ok((select availability_approved_at is null and availability='{}' from public.barbers where id='ec080000-0000-4000-8000-000000000302'),'new invited barbers start without approved public hours');
reset role;
select set_config('request.jwt.claims','{"sub":"ec080000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"role":"customer"}}',true);
set local role authenticated;
select throws_ok($$select public.barber_availability('list')$$,'42501','NOT_AUTHORIZED','customer cannot access staff availability requests');
reset role;

-- Boundary checks use a typed synthetic booking and never alter customer appointments.
select set_config('availability.boundary',jsonb_build_object('availability',jsonb_build_object('monday','{"enabled":true,"start":"09:00","end":"18:00"}'::jsonb),'time_offs',jsonb_build_array(jsonb_build_object('type','recurring','day','monday','start','12:00','end','13:00')),'vacations','[]'::jsonb,'max_booking_days',1)::text,true);
select ok(private.appointment_fits_availability(jsonb_populate_record(null::public.bookings,'{"date":"2026-11-09","time":"11:30","duration":30}'::jsonb),current_setting('availability.boundary')::jsonb),'appointment ending exactly at a break start still fits');
select ok(private.appointment_fits_availability(jsonb_populate_record(null::public.bookings,'{"date":"2026-11-09","time":"13:00","duration":30}'::jsonb),current_setting('availability.boundary')::jsonb),'appointment starting exactly at break end still fits');
select ok(not private.appointment_fits_availability(jsonb_populate_record(null::public.bookings,'{"date":"2026-11-09","time":"11:45","duration":30}'::jsonb),current_setting('availability.boundary')::jsonb),'partial break overlap is a conflict');
select ok(not private.appointment_fits_availability(jsonb_populate_record(null::public.bookings,'{"date":"2026-11-09","time":"12:15","duration":30}'::jsonb),current_setting('availability.boundary')::jsonb),'appointment inside a break is a conflict');
select ok(private.appointment_fits_availability(jsonb_populate_record(null::public.bookings,'{"date":"2026-11-09","time":"17:30","duration":30}'::jsonb),current_setting('availability.boundary')::jsonb),'appointment finishing exactly at closing fits');
select ok(not private.appointment_fits_availability(jsonb_populate_record(null::public.bookings,'{"date":"2026-11-09","time":"17:45","duration":30}'::jsonb),current_setting('availability.boundary')::jsonb),'appointment extending past closing conflicts');
select ok(not private.appointment_fits_availability(jsonb_populate_record(null::public.bookings,'{"date":"2026-11-10","time":"10:00","duration":30}'::jsonb),current_setting('availability.boundary')::jsonb),'disabled weekday conflicts');
select ok(not private.valid_availability('{"availability":{},"time_offs":[],"vacations":[],"max_booking_days":0}'),'zero booking horizon rejected');
select ok(not private.valid_availability('{"availability":{"monday":{"enabled":true,"start":"18:00","end":"09:00"}},"time_offs":[],"vacations":[],"max_booking_days":30}'),'reversed working hours rejected');
-- Ongoing bookings must be protected, not just bookings whose start is in the future.
select set_config('request.jwt.claims','{}',true);
insert into public.bookings(id,branch_id,barber_id,customer_id,service_ids,date,time,duration,price,status,added_by_type)
select 'ec080000-0000-4000-8000-000000000503','ec080000-0000-4000-8000-000000000101','ec080000-0000-4000-8000-000000000301','ec080000-0000-4000-8000-000000000401',array['ec080000-0000-4000-8000-000000000201']::uuid[],
 (clock_timestamp() at time zone 'Asia/Kuwait')::date,((clock_timestamp() at time zone 'Asia/Kuwait')-interval '5 minutes')::time,30,3,'confirmed','customer';
select ok(private.availability_conflicts('ec080000-0000-4000-8000-000000000301',current_setting('availability.boundary')::jsonb||jsonb_build_object('vacations',jsonb_build_array(jsonb_build_object('startDate',(clock_timestamp() at time zone 'Asia/Kuwait')::date,'endDate',(clock_timestamp() at time zone 'Asia/Kuwait')::date)))) @> '[{"id":"ec080000-0000-4000-8000-000000000503"}]','ongoing appointment appears in approval conflicts');
select set_config('request.jwt.claims','{"sub":"ec080000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"barber"}}',true);
set local role authenticated;
select throws_ok($$select public.barber_availability('submit',jsonb_build_object('barber_id','ec080000-0000-4000-8000-000000000301','base_revision',1,'proposal',current_setting('availability.proposal')::jsonb))$$,'P0001','AVAILABILITY_STALE','barber with stale approved revision must reload');
select set_config('availability.fourth',public.barber_availability('submit',jsonb_build_object('barber_id','ec080000-0000-4000-8000-000000000301','base_revision',2,'proposal',current_setting('availability.proposal')::jsonb))::text,true);
select set_config('availability.fifth',public.barber_availability('submit',jsonb_build_object('barber_id','ec080000-0000-4000-8000-000000000301','base_revision',2,'proposal',jsonb_set(current_setting('availability.proposal')::jsonb,'{vacations,0,reason}','"Updated request"')))::text,true);
reset role;
select is((select status from private.availability_requests where id=(current_setting('availability.fourth')::jsonb->'request'->>'id')::uuid),'superseded','updated proposal supersedes old request');
select is((select count(*) from private.availability_requests where barber_id='ec080000-0000-4000-8000-000000000301' and status='pending'),1::bigint,'only one pending request exists per barber');
select set_config('request.jwt.claims','{"sub":"ec080000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select throws_ok($$select public.barber_availability('approve',jsonb_build_object('request_id',current_setting('availability.fourth')::jsonb->'request'->>'id','base_revision',2))$$,'P0001','AVAILABILITY_STALE','superseded request cannot be approved');
select throws_ok($$select public.barber_availability('get',jsonb_build_object('barber_id','ec080000-0000-4000-8000-000000000302','request_id',current_setting('availability.fifth')::jsonb->'request'->>'id'))$$,'42501','NOT_AUTHORIZED','request cannot be displayed under a different barber route');
reset role;

select * from finish();
rollback;
