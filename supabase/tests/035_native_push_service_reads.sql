begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('fa190000-0000-4000-8000-000000000001','push-reads-manager@example.test',now(),'{"role":"manager"}'),
('fa190000-0000-4000-8000-000000000002','push-reads-barber@example.test',now(),'{"role":"barber"}'),
('fa190000-0000-4000-8000-000000000003','push-reads-other@example.test',now(),'{"role":"manager"}'),
('fa190000-0000-4000-8000-000000000004','push-reads-customer@example.test',now(),'{"role":"customer"}');
insert into auth.sessions(id,user_id) select ('fa190000-0000-4000-8000-00000000001'||n)::uuid,('fa190000-0000-4000-8000-00000000000'||n)::uuid from generate_series(1,4)n;
select set_config('packages.owner','{"user_id":"fa190000-0000-4000-8000-000000000004","session_id":"fa190000-0000-4000-8000-000000000014","name":"Packages Customer"}',true);
select public.customer_account_api('email-ensure',current_setting('packages.owner')::jsonb);
select set_config('packages.today',((clock_timestamp() at time zone 'Asia/Kuwait')::date)::text,true);
select set_config('packages.day',((clock_timestamp() at time zone 'Asia/Kuwait')::date+1)::text,true);
insert into public.branches(id,name,manager_id,city,governorate_id,area_id,image_url,working_hours)
select 'fa190000-0000-4000-8000-000000000101','Push Read QA Shop','fa190000-0000-4000-8000-000000000001','Push Read QA City',9001,9001,'/booking-demo/market-street.png',jsonb_object_agg(day,'{"open":"09:00","close":"20:00","closed":false}'::jsonb)
from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])day;
insert into public.services(id,branch_id,name,duration,price) values
('fa190000-0000-4000-8000-000000000201','fa190000-0000-4000-8000-000000000101','QA Haircut',30,5),
('fa190000-0000-4000-8000-000000000202','fa190000-0000-4000-8000-000000000101','QA Beard',20,3),
('fa190000-0000-4000-8000-000000000203','fa190000-0000-4000-8000-000000000101','QA Facial',40,7),
('fa190000-0000-4000-8000-000000000204','fa190000-0000-4000-8000-000000000101','QA Wash',15,2);
insert into public.barbers(id,branch_id,user_id,name,service_ids,availability,invite_status)
select ('fa190000-0000-4000-8000-00000000030'||n)::uuid,'fa190000-0000-4000-8000-000000000101',case when n=1 then 'fa190000-0000-4000-8000-000000000002'::uuid end,'Push Read QA Barber '||n,
case when n=1 then array['fa190000-0000-4000-8000-000000000201','fa190000-0000-4000-8000-000000000202','fa190000-0000-4000-8000-000000000203','fa190000-0000-4000-8000-000000000204']::uuid[] else array['fa190000-0000-4000-8000-000000000201','fa190000-0000-4000-8000-000000000202']::uuid[] end,
(select jsonb_object_agg(day,'{"start":"09:00","end":"20:00","enabled":true}'::jsonb) from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])day),'accepted' from generate_series(1,2)n;
select set_config('packages.manager','{"sub":"fa190000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa190000-0000-4000-8000-000000000011"}',true);
select set_config('request.jwt.claims',current_setting('packages.manager'),true);
select public.manage_shop_publication('fa190000-0000-4000-8000-000000000101','publish','draft');

reset role;
select ok(has_table_privilege('service_role','private.customer_booking_owners','SELECT'),'push service can read booking ownership');
select ok(has_table_privilege('service_role','private.customer_booking_ratings','SELECT'),'push service can read rating eligibility');
select ok(not has_table_privilege('anon','private.customer_booking_owners','SELECT'),'anonymous ownership reads remain denied');
select ok(not has_table_privilege('authenticated','private.customer_booking_owners','SELECT'),'signed-in client ownership reads remain denied');
select ok(not has_table_privilege('anon','private.customer_booking_ratings','SELECT'),'anonymous rating records remain private');
select ok(not has_table_privilege('authenticated','private.customer_booking_ratings','SELECT'),'signed-in client rating records remain private');
select ok(not has_table_privilege('service_role','private.customer_booking_owners','INSERT'),'push grant does not allow ownership writes');
select ok(not has_table_privilege('service_role','private.customer_booking_ratings','UPDATE'),'push grant does not allow rating writes');
select ok(not (select prosecdef from pg_proc where oid='public.customer_push_api(text,jsonb)'::regprocedure),'public push API remains SECURITY INVOKER');
select ok(not has_function_privilege('anon','public.customer_push_api(text,jsonb)','EXECUTE'),'anonymous cannot call privileged push RPC');
select ok(not has_function_privilege('authenticated','public.customer_push_api(text,jsonb)','EXECUTE'),'signed-in clients cannot call privileged push RPC');
select public.configure_customer_push_runtime('https://qvkucvcjmojjbphlzlks.supabase.co','com.barberplusplus.customer.test',array['sandbox']);
insert into public.customers(id,name,country_code,phone) values('fa190000-0000-4000-8000-000000000401','Push Read Guest','+965','50009891');
select set_config('request.jwt.claims','{}',true);
insert into public.bookings(id,branch_id,barber_id,customer_id,service_ids,date,time,duration,price,status,added_by_type)
values('fa190000-0000-4000-8000-000000000501','fa190000-0000-4000-8000-000000000101','fa190000-0000-4000-8000-000000000301','fa190000-0000-4000-8000-000000000401',array['fa190000-0000-4000-8000-000000000201']::uuid[],current_setting('packages.day')::date,'10:00',30,5,'confirmed','customer');
select set_config('push_reads.device','{"deviceId":"fa190000-0000-4000-8000-000000000601","deviceSecret":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',true);
set local role service_role;
select is(public.customer_push_api('push-register',current_setting('push_reads.device')::jsonb||jsonb_build_object('version',1,'token',repeat('b',64),'environment','sandbox','language','en','permission',false))->>'success','true','real invoker registers guest device');
select is(public.customer_push_api('push-guest-subscribe',current_setting('push_reads.device')::jsonb||'{"bookingId":"fa190000-0000-4000-8000-000000000501","receiptPhone":"50009891","receiptCountry":"+965"}')->>'success','true','real invoker subscribes verified guest receipt');
select is(public.customer_push_api('push-guest-receipt',current_setting('push_reads.device')::jsonb||'{"bookingId":"fa190000-0000-4000-8000-000000000501"}')->'receipt'->>'id','fa190000-0000-4000-8000-000000000501','real invoker opens only subscribed receipt');
select throws_ok($$select public.customer_push_api('push-guest-subscribe',current_setting('push_reads.device')::jsonb||'{"bookingId":"fa190000-0000-4000-8000-000000000501","receiptPhone":"50009892","receiptCountry":"+965"}')$$,'P0001','FORBIDDEN','wrong receipt phone remains forbidden');
select throws_ok($$select public.customer_push_api('push-guest-receipt',current_setting('push_reads.device')::jsonb||'{"bookingId":"fa190000-0000-4000-8000-000000000599"}')$$,'P0001','FORBIDDEN','unrelated booking remains forbidden');
select ok(not private.customer_push_allowed((select id from private.customer_push_events where booking_id='fa190000-0000-4000-8000-000000000501' and kind='confirmed'),'fa190000-0000-4000-8000-000000000601'),'eligibility reads succeed and disabled device receives no alert');
select is((select count(*) from private.customer_push_guests where booking_id='fa190000-0000-4000-8000-000000000501'),1::bigint,'only exact guest subscription exists');
reset role;
select is((select count(*) from private.customer_booking_owners where booking_id='fa190000-0000-4000-8000-000000000501'),0::bigint,'subscription never grants account/history ownership');
select * from finish();
rollback;
