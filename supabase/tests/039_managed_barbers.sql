begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
 ('fb101000-0000-4000-8000-000000000001','managed-manager@example.test',now(),'{"role":"manager"}'),
 ('fb101000-0000-4000-8000-000000000002','managed-other@example.test',now(),'{"role":"manager"}'),
 ('fb101000-0000-4000-8000-000000000003','managed-admin@example.test',now(),'{"role":"admin"}'),
 ('fb101000-0000-4000-8000-000000000004','managed-barber@example.test',now(),'{"role":"barber"}');
insert into auth.sessions(id,user_id) select ('fb101000-0000-4000-8000-00000000001'||n)::uuid,('fb101000-0000-4000-8000-00000000000'||n)::uuid from generate_series(1,4)n;
insert into public.branches(id,manager_id,name,city,governorate_id,area_id,image_url,working_hours)
select 'fb101000-0000-4000-8000-000000000101','fb101000-0000-4000-8000-000000000001','Managed QA Shop','Managed QA City',9001,9001,'/booking-demo/market-street.png',
 jsonb_object_agg(day,'{"open":"09:00","close":"18:00"}'::jsonb) from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day;
insert into public.branches(id,manager_id,name) values('fb101000-0000-4000-8000-000000000102','fb101000-0000-4000-8000-000000000002','Managed Other Shop');
insert into public.services(id,branch_id,name,duration,price) values
 ('fb101000-0000-4000-8000-000000000201','fb101000-0000-4000-8000-000000000101','Managed Cut',30,3),
 ('fb101000-0000-4000-8000-000000000202','fb101000-0000-4000-8000-000000000101','Managed Beard',15,2),
 ('fb101000-0000-4000-8000-000000000203','fb101000-0000-4000-8000-000000000102','Other Service',30,4);
select set_config('managed.owner','{"sub":"fb101000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fb101000-0000-4000-8000-000000000011","app_metadata":{"role":"manager"}}',true);
select set_config('managed.profile','{"id":"fb101000-0000-4000-8000-000000000301","name":"Managed QA Barber"}',true);
select set_config('request.jwt.claims',current_setting('managed.owner'),true);
set local role authenticated;
select is(public.create_managed_barber('fb101000-0000-4000-8000-000000000101',current_setting('managed.profile')::jsonb)->>'status','inactive','name-only profile starts inactive');
select is(public.create_managed_barber('fb101000-0000-4000-8000-000000000101',current_setting('managed.profile')::jsonb)->>'id','fb101000-0000-4000-8000-000000000301','retry uses same profile ID');
select is((select count(*) from public.barbers where id='fb101000-0000-4000-8000-000000000301'),1::bigint,'retry creates no duplicate');
select ok((select user_id is null and email is null and phone is null and management_mode='managed' and auto_confirm_bookings and availability_approved_at is null from public.barbers where id='fb101000-0000-4000-8000-000000000301'),'no credentials or required contact; auto-confirm on');
select throws_ok($$update public.barbers set status='active' where id='fb101000-0000-4000-8000-000000000301'$$,'P0001','BARBER_SERVICES_REQUIRED','cannot activate without services');
select throws_ok($$update public.barbers set service_ids=array['fb101000-0000-4000-8000-000000000203']::uuid[] where id='fb101000-0000-4000-8000-000000000301'$$,'P0001','INVALID_SERVICE_ASSIGNMENT','services cannot come from another shop');
update public.barbers set service_ids=array['fb101000-0000-4000-8000-000000000201','fb101000-0000-4000-8000-000000000202']::uuid[] where id='fb101000-0000-4000-8000-000000000301';
select throws_ok($$update public.barbers set status='active' where id='fb101000-0000-4000-8000-000000000301'$$,'P0001','BARBER_HOURS_REQUIRED','cannot activate without hours');
select set_config('managed.hours',(select jsonb_build_object('availability',jsonb_object_agg(day,'{"enabled":true,"start":"09:00","end":"18:00"}'::jsonb),'time_offs','[]'::jsonb,'vacations','[]'::jsonb,'max_booking_days',30)::text from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day),true);
select lives_ok($$select public.barber_availability('direct',jsonb_build_object('barber_id','fb101000-0000-4000-8000-000000000301','base_revision',0,'proposal',current_setting('managed.hours')::jsonb))$$,'manager sets approved hours without barber login');
update public.barbers set status='active' where id='fb101000-0000-4000-8000-000000000301';
select ok((select availability_approved_at is not null from public.barbers where id='fb101000-0000-4000-8000-000000000301'),'manager-approved hours saved');
select is(public.set_barber_auto_confirm('fb101000-0000-4000-8000-000000000301',false)->>'auto_confirm_bookings','false','manager turns auto-confirm off');
select throws_ok($$select public.set_barber_auto_confirm('fb101000-0000-4000-8000-000000000399',false)$$,'42501','NOT_AUTHORIZED','unknown profile denied');
select throws_ok($$update public.barbers set management_mode='account' where id='fb101000-0000-4000-8000-000000000301'$$,'42501','NOT_AUTHORIZED','manager cannot attach an account by direct update');
reset role;
select set_config('request.jwt.claims','{"sub":"fb101000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fb101000-0000-4000-8000-000000000012","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select throws_ok($$select public.create_managed_barber('fb101000-0000-4000-8000-000000000101','{"name":"Wrong manager"}')$$,'42501','NOT_AUTHORIZED','other manager cannot add a managed barber');
select throws_ok($$select public.set_barber_auto_confirm('fb101000-0000-4000-8000-000000000301',true)$$,'42501','NOT_AUTHORIZED','other manager cannot change preference');
select throws_ok($$select public.barber_availability('get','{"barber_id":"fb101000-0000-4000-8000-000000000301"}')$$,'42501','NOT_AUTHORIZED','other manager cannot manage schedule');
reset role;
select set_config('request.jwt.claims','{"sub":"fb101000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"fb101000-0000-4000-8000-000000000013","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$update public.barbers set name='Admin changed' where id='fb101000-0000-4000-8000-000000000301'$$,'42501','NOT_AUTHORIZED','admin cannot manage this profile');
select throws_ok($$select public.set_barber_auto_confirm('fb101000-0000-4000-8000-000000000301',true)$$,'42501','NOT_AUTHORIZED','admin cannot change managed preference');
select is(public.can_write_avatar_object('barbers/fb101000-0000-4000-8000-000000000301-123.png'),false,'admin cannot replace managed profile photo');
reset role;
select set_config('request.jwt.claims',current_setting('managed.owner'),true);
select public.manage_shop_publication('fb101000-0000-4000-8000-000000000101','publish','draft');
select set_config('request.jwt.claims','{}',true);
select set_config('managed.day',((clock_timestamp() at time zone 'Asia/Kuwait')::date+2)::text,true);
select set_config('managed.book',jsonb_build_object('id','fb101000-0000-4000-8000-000000000501','branch_id','fb101000-0000-4000-8000-000000000101','barber_id','fb101000-0000-4000-8000-000000000301','service_ids',jsonb_build_array('fb101000-0000-4000-8000-000000000201'),'date',current_setting('managed.day'),'time','10:00','name','Managed QA Customer','country_code','+965','phone','59977661')::text,true);
select is(public.customer_booking('book',current_setting('managed.book')::jsonb)->>'status','pending','customer can book account-free barber; confirmation preference honored');
select set_config('request.jwt.claims',current_setting('managed.owner'),true);
select is(public.confirm_pending_booking('fb101000-0000-4000-8000-000000000501')->>'status','confirmed','owner manager confirms booking');
select is(public.can_write_avatar_object('barbers/fb101000-0000-4000-8000-000000000301-123.png'),true,'owner manager can upload managed profile photo');
select set_config('managed.conflict',(current_setting('managed.hours')::jsonb||jsonb_build_object('vacations',jsonb_build_array(jsonb_build_object('id','managed-vacation','startDate',current_setting('managed.day'),'endDate',current_setting('managed.day')))))::text,true);
select is(public.barber_availability('direct',jsonb_build_object('barber_id','fb101000-0000-4000-8000-000000000301','base_revision',1,'proposal',current_setting('managed.conflict')::jsonb))->>'blocked','true','conflicting vacation lists appointments and blocks save');
select is((select status from public.bookings where id='fb101000-0000-4000-8000-000000000501'),'confirmed','blocked vacation preserves booking');
select is((select jsonb_array_length(vacations) from public.barbers where id='fb101000-0000-4000-8000-000000000301'),0,'blocked vacation does not alter live schedule');
select set_config('request.jwt.claims','{"sub":"fb101000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"fb101000-0000-4000-8000-000000000013","app_metadata":{"role":"admin"}}',true);
select throws_ok($$update public.bookings set notes='Admin edit' where id='fb101000-0000-4000-8000-000000000501'$$,'42501','NOT_AUTHORIZED','admin cannot manage a managed barber booking');
select set_config('request.jwt.claims','{"sub":"fb101000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fb101000-0000-4000-8000-000000000099","app_metadata":{"role":"manager"}}',true);
select throws_ok($$select public.create_managed_barber('fb101000-0000-4000-8000-000000000101','{"name":"Expired session"}')$$,'42501','NOT_AUTHORIZED','revoked session cannot create managed profile');
select set_config('request.jwt.claims',current_setting('managed.owner'),true);
update public.barbers set phone='59977665',country_code='+965' where id='fb101000-0000-4000-8000-000000000301';
select throws_ok($$select public.create_managed_barber('fb101000-0000-4000-8000-000000000101','{"name":"Duplicate number","phone":"59977665","country_code":"+965"}')$$,'23505','PHONE_IN_USE','optional phone remains globally unique');
select set_config('request.jwt.claims','{}',true);
select set_config('managed.invitation',public.shop_barber_invitation_api('send','{"actor":"fb101000-0000-4000-8000-000000000001","session":"fb101000-0000-4000-8000-000000000011","branch_id":"fb101000-0000-4000-8000-000000000101","managed_barber_id":"fb101000-0000-4000-8000-000000000301","email":"managed-invited@example.test","token_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}')::text,true);
select ok((select user_id is null and management_mode='managed' from public.barbers where id='fb101000-0000-4000-8000-000000000301'),'sending invitation does not transfer control before acceptance');
select throws_ok($$select public.shop_barber_invitation_api('send','{"actor":"fb101000-0000-4000-8000-000000000001","session":"fb101000-0000-4000-8000-000000000011","branch_id":"fb101000-0000-4000-8000-000000000101","managed_barber_id":"fb101000-0000-4000-8000-000000000301","email":"managed-another@example.test","token_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}')$$,'P0001','INVITE_EXISTS','only one pending invitation per managed profile');
select lives_ok($$select public.shop_barber_invitation_api('resolve',jsonb_build_object('id',current_setting('managed.invitation')::jsonb->>'id','token_hash','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','phone','59977665','country_code','+965'))$$,'acceptor can use exact target managed profile phone');
insert into auth.users(id,email,encrypted_password,raw_app_meta_data,raw_user_meta_data)
values('fb101000-0000-4000-8000-000000000006','managed-invited@example.test',extensions.crypt('QaManaged!2026',extensions.gen_salt('bf')),
 jsonb_build_object('role','customer','invitation_setup',current_setting('managed.invitation')::jsonb->>'id'),'{"name":"Managed Acceptor","phone":"+96559977665"}');
select is(public.shop_barber_invitation_api('accept',jsonb_build_object('id',current_setting('managed.invitation')::jsonb->>'id','token_hash','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','new_user','fb101000-0000-4000-8000-000000000006','name','Managed Acceptor','phone','59977665','country_code','+965','password','QaManaged!2026'))->>'barber_id','fb101000-0000-4000-8000-000000000301','acceptance links existing profile ID');
select ok((select user_id='fb101000-0000-4000-8000-000000000006' and management_mode='account' and status='active' and availability_approved_at is not null and cardinality(service_ids)=2 from public.barbers where id='fb101000-0000-4000-8000-000000000301'),'conversion preserves services, status and approved schedule');
select is((select barber_id from public.bookings where id='fb101000-0000-4000-8000-000000000501'),'fb101000-0000-4000-8000-000000000301'::uuid,'conversion preserves booking association and history');
select is((select owner_key from private.phone_numbers where phone='+96559977665'),'user:fb101000-0000-4000-8000-000000000006','exact target number becomes same accepting person');
select throws_ok($$select public.shop_barber_invitation_api('accept',jsonb_build_object('id',current_setting('managed.invitation')::jsonb->>'id','token_hash','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'))$$,'P0001','INVITE_USED','accepted token remains single use');
select ok(not has_function_privilege('anon','public.create_managed_barber(uuid,jsonb)','EXECUTE'),'anonymous cannot add managed profiles');
select * from finish();
rollback;
