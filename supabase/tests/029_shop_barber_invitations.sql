begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
('fa140000-0000-4000-8000-000000000001','invitation-manager@example.test',now(),'{"role":"manager"}','{"name":"Manager"}'),
('fa140000-0000-4000-8000-000000000002','invitation-other@example.test',now(),'{"role":"manager"}','{"name":"Other"}'),
('fa140000-0000-4000-8000-000000000003','invitation-customer@example.test',now(),'{"role":"customer"}','{"name":"Personal Customer"}'),
('fa140000-0000-4000-8000-000000000004','invitation-staff@example.test',now(),'{"role":"barber"}','{"name":"Staff"}');
insert into auth.sessions(id,user_id) values
('fa140000-0000-4000-8000-000000000011','fa140000-0000-4000-8000-000000000001'),
('fa140000-0000-4000-8000-000000000012','fa140000-0000-4000-8000-000000000002'),
('fa140000-0000-4000-8000-000000000013','fa140000-0000-4000-8000-000000000003');
insert into public.branches(id,name,manager_id) values
('fa140000-0000-4000-8000-000000000101','Invitation Shop','fa140000-0000-4000-8000-000000000001'),
('fa140000-0000-4000-8000-000000000102','Other Shop','fa140000-0000-4000-8000-000000000002');
select set_config('invitation.manager','{"actor":"fa140000-0000-4000-8000-000000000001","session":"fa140000-0000-4000-8000-000000000011","branch_id":"fa140000-0000-4000-8000-000000000101"}',true);
select set_config('invitation.customer','{"actor":"fa140000-0000-4000-8000-000000000003","session":"fa140000-0000-4000-8000-000000000013"}',true);
select set_config('invitation.personal',public.customer_account_api('email-ensure','{"user_id":"fa140000-0000-4000-8000-000000000003","session_id":"fa140000-0000-4000-8000-000000000013","name":"Personal Customer"}')::text,true);
select public.customer_account_api('update-profile','{"user_id":"fa140000-0000-4000-8000-000000000003","session_id":"fa140000-0000-4000-8000-000000000013","name":"Personal Customer","phone":"59979431","country_code":"+965"}');
insert into public.services(id,branch_id,name,duration,price) values('fa140000-0000-4000-8000-000000000201','fa140000-0000-4000-8000-000000000101','History haircut',30,3);
insert into public.barbers(id,user_id,branch_id,name,status) values('fa140000-0000-4000-8000-000000000301','fa140000-0000-4000-8000-000000000004','fa140000-0000-4000-8000-000000000101','History barber','inactive');
insert into public.bookings(id,branch_id,barber_id,customer_id,service_ids,date,time,duration,price,status,added_by_type)
values('fa140000-0000-4000-8000-000000000401','fa140000-0000-4000-8000-000000000101','fa140000-0000-4000-8000-000000000301',(current_setting('invitation.personal')::jsonb->>'customerId')::uuid,array['fa140000-0000-4000-8000-000000000201']::uuid[],current_date-2,'10:00',30,3,'completed','customer');
insert into private.customer_booking_owners(booking_id,account_user_id) values('fa140000-0000-4000-8000-000000000401','fa140000-0000-4000-8000-000000000003');
select set_config('invitation.contact',(select to_jsonb(c)::text from public.customers c where id=(current_setting('invitation.personal')::jsonb->>'customerId')::uuid),true);
select ok(not has_table_privilege('authenticated','private.shop_barber_invitations','SELECT'),'raw invitation tokens/history are not readable by clients');
select ok(not has_function_privilege('anon','public.shop_barber_invitation_api(text,jsonb)','EXECUTE'),'anonymous direct API denied');
select ok(not has_function_privilege('authenticated','public.shop_barber_invitation_api(text,jsonb)','EXECUTE'),'authenticated direct API denied');
select ok(has_function_privilege('service_role','public.shop_barber_invitation_api(text,jsonb)','EXECUTE'),'only server API has execute permission');
select is(public.shop_barber_invitation_api('check',current_setting('invitation.manager')::jsonb||'{"email":"invitation-new@example.test"}')->>'kind','new','new email can be invited');
select throws_ok($$select public.shop_barber_invitation_api('check',current_setting('invitation.manager')::jsonb||'{"branch_id":"fa140000-0000-4000-8000-000000000102","email":"new@example.test"}')$$,'42501','FORBIDDEN','cross-shop email lookup denied');
select throws_ok($$select public.shop_barber_invitation_api('list',current_setting('invitation.manager')::jsonb||'{"session":"fa140000-0000-4000-8000-000000000012"}')$$,'42501','AUTH_REQUIRED','a session belonging to someone else is denied');
select throws_ok($$select public.shop_barber_invitation_api('check',current_setting('invitation.manager')::jsonb||'{"email":"invitation-staff@example.test"}')$$,'P0001','EMAIL_UNAVAILABLE','staff cannot be recruited into another identity');
select is(public.shop_barber_invitation_api('check',current_setting('invitation.manager')::jsonb||'{"email":"invitation-customer@example.test"}')->>'kind','customer','existing customer identified for confirmation');
select throws_ok($$select public.shop_barber_invitation_api('send',current_setting('invitation.manager')::jsonb||jsonb_build_object('email','invitation-customer@example.test','token_hash',repeat('a',64)))$$,'P0001','CUSTOMER_CONFIRMATION_REQUIRED','customer invitation requires explicit manager confirmation');
select set_config('invitation.row',public.shop_barber_invitation_api('send',current_setting('invitation.manager')::jsonb||jsonb_build_object('email','invitation-customer@example.test','confirm_customer',true,'token_hash',repeat('a',64)))::text,true);
select set_config('invitation.token',jsonb_build_object('id',current_setting('invitation.row')::jsonb->>'id','token_hash',repeat('a',64))::text,true);
select is((select count(*) from public.barbers where user_id='fa140000-0000-4000-8000-000000000003'),0::bigint,'sending creates no barber');
select throws_ok($$select public.shop_barber_invitation_api('send',current_setting('invitation.manager')::jsonb||jsonb_build_object('email','invitation-customer@example.test','confirm_customer',true,'token_hash',repeat('b',64)))$$,'P0001','INVITE_EXISTS','duplicate invitation is not created');
select throws_ok($$select public.shop_barber_invitation_api('resend',current_setting('invitation.manager')::jsonb||jsonb_build_object('id',current_setting('invitation.row')::jsonb->>'id','token_hash',repeat('b',64)))$$,'P0001','RATE_LIMITED','resend has a cooldown');
update private.shop_barber_invitations set sent_at=now()-interval '2 minutes' where id=(current_setting('invitation.row')::jsonb->>'id')::uuid;
select lives_ok($$select public.shop_barber_invitation_api('resend',current_setting('invitation.manager')::jsonb||jsonb_build_object('id',current_setting('invitation.row')::jsonb->>'id','token_hash',repeat('b',64)))$$,'resend issues a fresh token');
select throws_ok($$select public.shop_barber_invitation_api('resolve',current_setting('invitation.token')::jsonb)$$,'P0001','INVITE_INVALID','old token is invalid immediately after resend');
select set_config('invitation.token',(current_setting('invitation.token')::jsonb||jsonb_build_object('token_hash',repeat('b',64)))::text,true);
select is(public.shop_barber_invitation_api('resolve',current_setting('invitation.token')::jsonb)->>'kind','customer','opening the URL does not consume it');
select throws_ok($$select public.shop_barber_invitation_api('accept',current_setting('invitation.token')::jsonb||current_setting('invitation.manager')::jsonb)$$,'P0001','AUTH_REQUIRED','manager session cannot accept for a customer');
select lives_ok($$select public.shop_barber_invitation_api('accept',current_setting('invitation.token')::jsonb||current_setting('invitation.customer')::jsonb)$$,'the same existing customer accepts without signup');
select is((select raw_app_meta_data->>'role' from auth.users where id='fa140000-0000-4000-8000-000000000003'),'barber','role upgraded on same Auth identity');
select is((select to_jsonb(c)::text from public.customers c where id=(current_setting('invitation.personal')::jsonb->>'customerId')::uuid),current_setting('invitation.contact'),'canonical customer details preserved exactly');
select is((select count(*) from private.customer_accounts where user_id='fa140000-0000-4000-8000-000000000003'),1::bigint,'canonical account not duplicated');
select is((select count(*) from public.barbers where user_id='fa140000-0000-4000-8000-000000000003'),1::bigint,'one barber profile created');
select is((select status from public.barbers where user_id='fa140000-0000-4000-8000-000000000003'),'inactive','new barber cannot be booked before setup');
select ok((select cardinality(service_ids)=0 and availability_approved_at is null from public.barbers where user_id='fa140000-0000-4000-8000-000000000003'),'no services or hours are silently approved');
select is(jsonb_array_length(public.customer_account_api('bookings','{"user_id":"fa140000-0000-4000-8000-000000000003","session_id":"fa140000-0000-4000-8000-000000000013"}')),1,'customer mode keeps past appointment history after promotion');
select is(public.customer_account_api('bookings','{"user_id":"fa140000-0000-4000-8000-000000000003","session_id":"fa140000-0000-4000-8000-000000000013"}')->0->>'id','fa140000-0000-4000-8000-000000000401','same booking ID and owner remain accessible');
select is((select owner_key from private.phone_numbers where phone='+96559979431'),'user:fa140000-0000-4000-8000-000000000003','phone registry follows the same person into work mode');
select throws_ok($$select public.customer_account_api('update-profile','{"user_id":"fa140000-0000-4000-8000-000000000002","session_id":"fa140000-0000-4000-8000-000000000012","name":"Other","country_code":"+965","phone":"59979431"}')$$,'23505',null,'a different person still cannot use the promoted customer number');
select throws_ok($$select public.shop_barber_invitation_api('accept',current_setting('invitation.token')::jsonb||current_setting('invitation.customer')::jsonb)$$,'P0001','INVITE_USED','used invitation cannot create another profile');
select set_config('invitation.cancel',public.shop_barber_invitation_api('send',current_setting('invitation.manager')::jsonb||jsonb_build_object('email','invitation-cancel@example.test','token_hash',repeat('c',64)))::text,true);
select lives_ok($$select public.shop_barber_invitation_api('cancel',current_setting('invitation.manager')::jsonb||jsonb_build_object('id',current_setting('invitation.cancel')::jsonb->>'id'))$$,'manager can cancel a pending invitation');
select throws_ok($$select public.shop_barber_invitation_api('resolve',jsonb_build_object('id',current_setting('invitation.cancel')::jsonb->>'id','token_hash',repeat('c',64)))$$,'P0001','INVITE_CANCELLED','cancelled invitation cannot be used');
select set_config('invitation.expired',public.shop_barber_invitation_api('send',current_setting('invitation.manager')::jsonb||jsonb_build_object('email','invitation-expired@example.test','token_hash',repeat('d',64)))::text,true);
update private.shop_barber_invitations set expires_at=now()-interval '1 second' where id=(current_setting('invitation.expired')::jsonb->>'id')::uuid;
select throws_ok($$select public.shop_barber_invitation_api('resolve',jsonb_build_object('id',current_setting('invitation.expired')::jsonb->>'id','token_hash',repeat('d',64)))$$,'P0001','INVITE_EXPIRED','expired invitation cannot be used');
-- Interrupted setup creates an unconfirmed identity before atomic acceptance.
-- A cancelled/replaced invitation must not strand it or reset its password.
select set_config('invitation.interrupted',public.shop_barber_invitation_api('send',current_setting('invitation.manager')::jsonb||jsonb_build_object('email','invitation-interrupted@example.test','token_hash',repeat('e',64)))::text,true);
insert into auth.users(id,email,encrypted_password,raw_app_meta_data) values('fa140000-0000-4000-8000-000000000005','invitation-interrupted@example.test',extensions.crypt('Synthetic12!',extensions.gen_salt('bf')),jsonb_build_object('role','customer','invitation_setup',current_setting('invitation.interrupted')::jsonb->>'id'));
select public.shop_barber_invitation_api('cancel',current_setting('invitation.manager')::jsonb||jsonb_build_object('id',current_setting('invitation.interrupted')::jsonb->>'id'));
select is(public.shop_barber_invitation_api('check',current_setting('invitation.manager')::jsonb||'{"email":"invitation-interrupted@example.test"}')->>'kind','new','interrupted unconfirmed setup is not mistaken for a finished customer');
select set_config('invitation.replacement',public.shop_barber_invitation_api('send',current_setting('invitation.manager')::jsonb||jsonb_build_object('email','invitation-interrupted@example.test','token_hash',repeat('f',64)))::text,true);
select set_config('invitation.resume',jsonb_build_object('id',current_setting('invitation.replacement')::jsonb->>'id','token_hash',repeat('f',64),'new_user','fa140000-0000-4000-8000-000000000005','name','Resumed Barber','country_code','+965','phone','59979432')::text,true);
select is(public.shop_barber_invitation_api('resolve',current_setting('invitation.resume')::jsonb)->>'setup_user','fa140000-0000-4000-8000-000000000005','replacement link resumes the original unconfirmed identity');
select throws_ok($$select public.shop_barber_invitation_api('accept',current_setting('invitation.resume')::jsonb||'{"password":"Different12!"}')$$,'P0001','INVALID_LOGIN','replacement link cannot reset the original password');
select lives_ok($$select public.shop_barber_invitation_api('accept',current_setting('invitation.resume')::jsonb||'{"password":"Synthetic12!"}')$$,'original password completes interrupted setup through the replacement link');
select is((select count(*) from public.barbers where user_id='fa140000-0000-4000-8000-000000000005'),1::bigint,'recovery creates exactly one barber for the same identity');
select set_config('request.jwt.claims','{"sub":"fa140000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select throws_ok($$insert into public.barbers(branch_id,name,status) values('fa140000-0000-4000-8000-000000000101','Bypass','inactive')$$,'42501','INVITATION_REQUIRED','manager cannot bypass invitations with a direct insert');
reset role;
select * from finish();
rollback;
