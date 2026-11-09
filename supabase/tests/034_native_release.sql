begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('fa180000-0000-4000-8000-000000000001','packages-manager@example.test',now(),'{"role":"manager"}'),
('fa180000-0000-4000-8000-000000000002','packages-barber@example.test',now(),'{"role":"barber"}'),
('fa180000-0000-4000-8000-000000000003','packages-other@example.test',now(),'{"role":"manager"}'),
('fa180000-0000-4000-8000-000000000004','packages-customer@example.test',now(),'{"role":"customer"}');
insert into auth.sessions(id,user_id) select ('fa180000-0000-4000-8000-00000000001'||n)::uuid,('fa180000-0000-4000-8000-00000000000'||n)::uuid from generate_series(1,4)n;
select set_config('packages.owner','{"user_id":"fa180000-0000-4000-8000-000000000004","session_id":"fa180000-0000-4000-8000-000000000014","name":"Packages Customer"}',true);
select public.customer_account_api('email-ensure',current_setting('packages.owner')::jsonb);
select set_config('packages.today',((clock_timestamp() at time zone 'Asia/Kuwait')::date)::text,true);
select set_config('packages.day',((clock_timestamp() at time zone 'Asia/Kuwait')::date+1)::text,true);
insert into public.branches(id,name,manager_id,city,governorate_id,area_id,image_url,working_hours)
select 'fa180000-0000-4000-8000-000000000101','Package QA Shop','fa180000-0000-4000-8000-000000000001','Package QA City',9001,9001,'/booking-demo/market-street.png',jsonb_object_agg(day,'{"open":"09:00","close":"20:00","closed":false}'::jsonb)
from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])day;
insert into public.services(id,branch_id,name,duration,price) values
('fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000101','QA Haircut',30,5),
('fa180000-0000-4000-8000-000000000202','fa180000-0000-4000-8000-000000000101','QA Beard',20,3),
('fa180000-0000-4000-8000-000000000203','fa180000-0000-4000-8000-000000000101','QA Facial',40,7),
('fa180000-0000-4000-8000-000000000204','fa180000-0000-4000-8000-000000000101','QA Wash',15,2);
insert into public.barbers(id,branch_id,user_id,name,service_ids,availability,invite_status)
select ('fa180000-0000-4000-8000-00000000030'||n)::uuid,'fa180000-0000-4000-8000-000000000101',case when n=1 then 'fa180000-0000-4000-8000-000000000002'::uuid end,'Package QA Barber '||n,
case when n=1 then array['fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000202','fa180000-0000-4000-8000-000000000203','fa180000-0000-4000-8000-000000000204']::uuid[] else array['fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000202']::uuid[] end,
(select jsonb_object_agg(day,'{"start":"09:00","end":"20:00","enabled":true}'::jsonb) from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])day),'accepted' from generate_series(1,2)n;
select set_config('packages.manager','{"sub":"fa180000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fa180000-0000-4000-8000-000000000011"}',true);
select set_config('request.jwt.claims',current_setting('packages.manager'),true);
select public.manage_shop_publication('fa180000-0000-4000-8000-000000000101','publish','draft');
select set_config('packages.data',jsonb_build_object('name','QA Grooming','name_ar','باقة تجريبية','service_ids',jsonb_build_array('fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000202','fa180000-0000-4000-8000-000000000203'),'price',10,'starts_on',current_setting('packages.today'),'ends_on',current_setting('packages.today')::date+6)::text,true);
select set_config('packages.saved',public.manage_service_packages('save','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb)::text,true);
select set_config('packages.package',(current_setting('packages.saved')::jsonb->>'id'),true);
select set_config('packages.offer',(current_setting('packages.saved')::jsonb->>'offer_id'),true);
select is(public.manage_service_packages('list','fa180000-0000-4000-8000-000000000101')->>'total','1','manager sees the package');
select is(jsonb_array_length(public.customer_package_catalog('fa180000-0000-4000-8000-000000000101','fa180000-0000-4000-8000-000000000301')),1,'qualified barber offers the package');
select is(jsonb_array_length(public.customer_package_catalog('fa180000-0000-4000-8000-000000000101','fa180000-0000-4000-8000-000000000302')),0,'barber missing facial cannot offer package');
select ok(not has_function_privilege('anon','public.manage_service_packages(text,uuid,jsonb)','EXECUTE'),'anonymous cannot manage');
select ok(not has_function_privilege('authenticated','public.customer_package_catalog(uuid,uuid,date)','EXECUTE'),'public catalogue is gateway-only');
select ok(not has_table_privilege('authenticated','private.package_offers','UPDATE'),'direct offer writes denied');
select throws_ok($$select public.manage_service_packages('save','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb||'{"price":0}')$$,'P0001','INVALID_PACKAGE','zero price rejected');
select throws_ok($$select public.manage_service_packages('save','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb||'{"price":16}')$$,'P0001','INVALID_PACKAGE','price above separate services rejected');
select throws_ok($$select public.manage_service_packages('save','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb||'{"service_ids":["fa180000-0000-4000-8000-000000000201","fa180000-0000-4000-8000-000000000201"]}')$$,'P0001','INVALID_PACKAGE','duplicate package service rejected');
select throws_ok($$select public.manage_service_packages('republish','fa180000-0000-4000-8000-000000000101',current_setting('packages.data')::jsonb||current_setting('packages.saved')::jsonb)$$,'P0001','PACKAGE_PERIOD_OVERLAP','republishing overlapping period rejected');
select set_config('request.jwt.claims','{"sub":"fa180000-0000-4000-8000-000000000003","role":"authenticated","session_id":"fa180000-0000-4000-8000-000000000013"}',true);
select throws_ok($$select public.manage_service_packages('list','fa180000-0000-4000-8000-000000000101')$$,'42501','NOT_AUTHORIZED','other manager cannot list shop packages');
select throws_ok($$select public.manage_service_packages('pause','fa180000-0000-4000-8000-000000000101',current_setting('packages.saved')::jsonb)$$,'42501','NOT_AUTHORIZED','other manager cannot pause offer');
select set_config('request.jwt.claims','{}',true);
select set_config('packages.book',jsonb_build_object('id','fa180000-0000-4000-8000-000000000501','branch_id','fa180000-0000-4000-8000-000000000101','barber_id','fa180000-0000-4000-8000-000000000301','package_offer_id',current_setting('packages.offer'),'service_ids',jsonb_build_array('fa180000-0000-4000-8000-000000000201','fa180000-0000-4000-8000-000000000202','fa180000-0000-4000-8000-000000000203','fa180000-0000-4000-8000-000000000204'),'date',current_setting('packages.day'),'time','09:00','name','Package QA Guest','country_code','+965','phone','56988701','package_quote',jsonb_build_object('price',12,'duration',105))::text,true);
set local role service_role;
select is(public.customer_booking('slots',current_setting('packages.book')::jsonb)->>'price','12.000','package plus wash costs 12 KWD');
select is(public.customer_booking('slots',current_setting('packages.book')::jsonb)->>'duration','105','full package and extra duration');
select throws_ok($$select public.customer_booking('book',current_setting('packages.book')::jsonb||'{"package_quote":{"price":1,"duration":105}}')$$,'P0001','PACKAGE_CHANGED','forged quote rejected');
select throws_ok($$select public.customer_booking('slots',current_setting('packages.book')::jsonb||'{"service_ids":["fa180000-0000-4000-8000-000000000201","fa180000-0000-4000-8000-000000000202"]}')$$,'P0001','INVALID_PACKAGE_SELECTION','cannot omit included service');

select throws_ok($$select public.native_customer_booking('book',current_setting('packages.book')::jsonb||'{"expected_price":"17","expected_duration":"105"}')$$,'P0001','PRICE_CHANGED','native uses package price, not sum of components');
select is((select count(*) from public.bookings where id='fa180000-0000-4000-8000-000000000501'),0::bigint,'quote mismatch rolls back booking');
select is(public.native_customer_booking('book',current_setting('packages.book')::jsonb||'{"expected_price":"12","expected_duration":"105"}')->>'price','12.000','native package and extra use canonical quote');
select is(public.native_close_booking_attempt('fa180000-0000-4000-8000-000000000501')->>'found','true','resolve finds committed booking');
select is(public.native_customer_booking('book',current_setting('packages.book')::jsonb||'{"expected_price":"99","expected_duration":"5"}')->>'price','12.000','idempotent retry returns purchased terms');
select is(public.native_close_booking_attempt('fa180000-0000-4000-8000-000000000599')->>'closed','true','absent booking closes its key');
select throws_ok($$select public.native_customer_booking('book',current_setting('packages.book')::jsonb||'{"id":"fa180000-0000-4000-8000-000000000599","time":"14:00"}')$$,'P0001','ATTEMPT_CLOSED','late request cannot write closed attempt');
select throws_ok($$select public.native_customer_booking('slots','{}')$$,'P0001','INVALID_REQUEST','native wrapper is write-only');

reset role;
insert into private.customer_booking_owners(booking_id,account_user_id) values('fa180000-0000-4000-8000-000000000501','fa180000-0000-4000-8000-000000000004');
select is((select package_snapshot->>'name' from public.bookings where id='fa180000-0000-4000-8000-000000000501'),'QA Grooming','booking stores package name');
select is((select jsonb_array_length(service_snapshot) from public.bookings where id='fa180000-0000-4000-8000-000000000501'),4,'component history includes extras');
select throws_ok($$select public.customer_booking('book',current_setting('packages.book')::jsonb||'{"id":"fa180000-0000-4000-8000-000000000502","time":"10:30"}')$$,'P0001','SLOT_UNAVAILABLE','entire duration reserves slot');

select ok(not has_function_privilege('authenticated','public.native_customer_booking(text,jsonb)','EXECUTE'),'customer cannot call privileged native write RPC');
select ok(not has_function_privilege('anon','public.native_close_booking_attempt(uuid)','EXECUTE'),'anonymous cannot close arbitrary booking');
select ok(not has_table_privilege('authenticated','private.customer_push_devices','SELECT'),'devices stay private');
select ok(not has_function_privilege('authenticated','public.customer_push_api(text,jsonb)','EXECUTE'),'push identity RPC stays server-only');
select ok(not has_function_privilege('authenticated','public.configure_customer_push_runtime(text,text,text[])','EXECUTE'),'client cannot change APNs app or environment');
select throws_ok($$select public.configure_customer_push_runtime('https://qvkucvcjmojjbphlzlks.supabase.co','com.barberplusplus.customer',array['production'])$$,'23514',null,'mixed app/database runtime rejected');
select * from finish();
rollback;
