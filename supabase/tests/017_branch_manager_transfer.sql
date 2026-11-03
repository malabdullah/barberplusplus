begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(18);

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
('dc010000-0000-4000-8000-000000000001','handover-admin@example.test',now(),'{"role":"admin"}','{"name":"Transfer Admin"}'),
('dc010000-0000-4000-8000-000000000002','handover-lead@example.test',now(),'{"role":"manager"}','{"name":"Outgoing Manager"}'),
('dc010000-0000-4000-8000-000000000003','handover-barber@example.test',now(),'{"role":"barber"}','{}'),
('dc010000-0000-4000-8000-000000000004','handover-other@example.test',now(),'{"role":"manager"}','{}');

insert into auth.sessions(id,user_id) values
('dc010000-0000-4000-8000-000000000011','dc010000-0000-4000-8000-000000000001'),
('dc010000-0000-4000-8000-000000000013','dc010000-0000-4000-8000-000000000003');

insert into public.branches(id,manager_id,name,status) values
('dc010000-0000-4000-8000-000000000101','dc010000-0000-4000-8000-000000000002','Transfer Branch','active'),
('dc010000-0000-4000-8000-000000000102','dc010000-0000-4000-8000-000000000002','Retained Branch','active'),
('dc010000-0000-4000-8000-000000000103','dc010000-0000-4000-8000-000000000004','Unrelated Branch','active');

insert into public.services(id,branch_id,name,duration,price,status) values
('dc010000-0000-4000-8000-000000000201','dc010000-0000-4000-8000-000000000101','Haircut',30,5,'active');
insert into public.barbers(id,user_id,branch_id,name,phone,service_ids,availability,status) values
('dc010000-0000-4000-8000-000000000301','dc010000-0000-4000-8000-000000000003',
 'dc010000-0000-4000-8000-000000000101','Incoming Barber','59917031',
 '{dc010000-0000-4000-8000-000000000201}','{"monday":{"enabled":true,"start":"09:00","end":"17:00"}}','active');

select set_config('request.jwt.claims','{"sub":"dc010000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}',true);
insert into public.barbers(id,user_id,branch_id,name,manager_chair,status) values
('dc010000-0000-4000-8000-000000000302','dc010000-0000-4000-8000-000000000002',
 'dc010000-0000-4000-8000-000000000101','Outgoing Chair',true,'inactive');
update public.barbers set status='active',service_ids='{dc010000-0000-4000-8000-000000000201}'
where id='dc010000-0000-4000-8000-000000000302';
select set_config('request.jwt.claims','{}',true);

insert into public.bookings(id,branch_id,barber_id,date,time,status,added_by_type) values
('dc010000-0000-4000-8000-000000000401','dc010000-0000-4000-8000-000000000101',
 'dc010000-0000-4000-8000-000000000301','2020-06-01','10:00','completed','customer'),
('dc010000-0000-4000-8000-000000000402','dc010000-0000-4000-8000-000000000101',
 'dc010000-0000-4000-8000-000000000302','2099-06-01','10:00','confirmed','customer');
insert into public.customers(id,name) values ('dc010000-0000-4000-8000-000000000501','Transfer customer');
insert into private.customer_favourites(customer_id,barber_id,saved_barber_branch_id) values
('dc010000-0000-4000-8000-000000000501','dc010000-0000-4000-8000-000000000301','dc010000-0000-4000-8000-000000000101');

select ok(not has_function_privilege('anon','public.admin_transfer_branch_manager(uuid,uuid,uuid,boolean)','EXECUTE'),'anonymous RPC denied');
select set_config('test.transfer_review',$call$select public.admin_transfer_branch_manager('dc010000-0000-4000-8000-000000000101','dc010000-0000-4000-8000-000000000301','dc010000-0000-4000-8000-000000000002',null)$call$,true);
select set_config('test.transfer_apply',$call$select public.admin_transfer_branch_manager('dc010000-0000-4000-8000-000000000101','dc010000-0000-4000-8000-000000000301','dc010000-0000-4000-8000-000000000002',true)$call$,true);
select set_config('request.jwt.claims','{"sub":"dc010000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select throws_ok(current_setting('test.transfer_review'),'42501','TRANSFER_FORBIDDEN','managers cannot grant roles');
select throws_ok($$update public.barbers set manager_chair=true where id='dc010000-0000-4000-8000-000000000301'$$,
'P0001','CHAIR_ASSIGNMENT_FIXED','managers cannot bypass the transfer guard');
reset role;
select set_config('request.jwt.claims','{"sub":"dc010000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok(current_setting('test.transfer_review'),'42501','TRANSFER_FORBIDDEN','stale admin token denied');
reset role;
select set_config('request.jwt.claims','{"sub":"dc010000-0000-4000-8000-000000000001","session_id":"dc010000-0000-4000-8000-000000000011","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select results_eq(current_setting('test.transfer_review'),$$values ('{"branchName":"Transfer Branch","incomingName":"Incoming Barber","outgoingName":"Outgoing Manager","outgoingUpcoming":1,"currentlyBookable":true,"remainingBranches":1}'::jsonb)$$,'preview explains exactly which branch and appointments are affected');
select throws_ok(current_setting('test.transfer_apply'),'P0001','TRANSFER_UPCOMING_APPOINTMENTS','upcoming outgoing appointments block transfer');
update public.bookings set status='cancelled' where id='dc010000-0000-4000-8000-000000000402';
select lives_ok(current_setting('test.transfer_apply'),'admin transfers after appointments are resolved');
select throws_ok(current_setting('test.transfer_apply'),'P0001','TRANSFER_STALE','replayed transfer cannot overwrite an assignment');
reset role;
select is((select raw_app_meta_data->>'role' from auth.users where id='dc010000-0000-4000-8000-000000000003'),'manager','same account becomes manager');
select is((select count(*) from auth.sessions where user_id='dc010000-0000-4000-8000-000000000003'),0::bigint,'old barber sessions are revoked');
select ok((select manager_chair and status='active' and phone is null from public.barbers where id='dc010000-0000-4000-8000-000000000301'),'original barber becomes a bookable manager chair');
select is((select owner_key from private.phone_numbers where phone='+96559917031'),'user:dc010000-0000-4000-8000-000000000003','phone remains reserved to the same account');
select ok(not exists(select 1 from private.phone_sources where source='barbers' and record_id='dc010000-0000-4000-8000-000000000301'),'phone moves out of the barber mirror');
select ok(exists(select 1 from public.bookings where id='dc010000-0000-4000-8000-000000000401' and barber_id='dc010000-0000-4000-8000-000000000301') and exists(select 1 from private.customer_favourites where barber_id='dc010000-0000-4000-8000-000000000301'),'booking history and favourites retain their links');
select is((select status from public.barbers where id='dc010000-0000-4000-8000-000000000302'),'inactive','outgoing chair closes');
select is((select count(*) from public.audit_logs where target_entity_id='dc010000-0000-4000-8000-000000000101' and metadata->>'source'='branch_manager_transfer'),1::bigint,'admin transfer is audited once');
select set_config('request.jwt.claims','{"sub":"dc010000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select results_eq($$select id from public.branches where id in ('dc010000-0000-4000-8000-000000000101','dc010000-0000-4000-8000-000000000102')$$,$$values ('dc010000-0000-4000-8000-000000000102'::uuid)$$,'outgoing manager retains access only to the other branch');
select is((select count(*) from public.notifications where recipient_branch_id='dc010000-0000-4000-8000-000000000101'),0::bigint,'old booking alerts do not disclose transferred branch details');
reset role;
select * from finish();
rollback;
