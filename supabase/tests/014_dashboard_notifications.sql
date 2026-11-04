begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
select ok(not has_table_privilege('anon','public.notifications','SELECT'),'anonymous cannot read dashboard alerts');
select ok(not has_table_privilege('authenticated','public.notifications','INSERT'),'clients cannot forge alerts');
select ok(not has_column_privilege('authenticated','public.notifications','recipient_user_id','UPDATE'),'users cannot change a recipient');
select ok(has_column_privilege('authenticated','public.notifications','is_read','UPDATE'),'recipients can mark read');
select ok(not has_function_privilege('authenticated','private.notify_booking_change()','EXECUTE'),'clients cannot invoke trigger helpers');
select ok(not has_function_privilege('service_role','private.deliver_dashboard_notification(uuid,uuid,uuid,text,text,uuid,text,jsonb)','EXECUTE'),'delivery helper is not a server RPC');
-- This isolated fixture, including a second barber identity, always rolls back.
insert into auth.users(id,email,raw_app_meta_data) values ('aa021100-0000-4000-8000-000000000001','notification-barber@example.test','{"role":"barber"}');
insert into public.branches(id,manager_id,name) values ('aa021100-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','Notification fixture');
insert into public.barbers(id,branch_id,user_id,name) values
('aa021100-0000-4000-8000-000000000003','aa021100-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','First barber'),
('aa021100-0000-4000-8000-000000000004','aa021100-0000-4000-8000-000000000002','aa021100-0000-4000-8000-000000000001','Second barber');
insert into public.user_notification_preferences(user_id,new_bookings,booking_updates,cancellations) values
('00000000-0000-4000-8000-000000000002',true,true,true),('00000000-0000-4000-8000-000000000004',true,true,true)
on conflict(user_id) do update set new_bookings=true,booking_updates=true,cancellations=true;
insert into public.bookings(id,branch_id,barber_id,date,time,added_by_type) values
('aa021100-0000-4000-8000-000000000005','aa021100-0000-4000-8000-000000000002','aa021100-0000-4000-8000-000000000003','2035-06-01','10:00','customer');
select is((select count(*) from public.notifications where entity_id='aa021100-0000-4000-8000-000000000005'),2::bigint,'customer booking alerts manager and assigned barber atomically');
select is((select count(distinct event_id) from public.notifications where entity_id='aa021100-0000-4000-8000-000000000005'),1::bigint,'one event has independent recipient rows');
update public.bookings set time=time where id='aa021100-0000-4000-8000-000000000005';
select is((select count(*) from public.notifications where entity_id='aa021100-0000-4000-8000-000000000005'),2::bigint,'no-op retry does not duplicate alerts');
update public.bookings set time='11:00' where id='aa021100-0000-4000-8000-000000000005';
select is((select count(*) from public.notifications where entity_id='aa021100-0000-4000-8000-000000000005' and type='booking_updated'),2::bigint,'time changes alert both recipients');
update public.bookings set barber_id='aa021100-0000-4000-8000-000000000004' where id='aa021100-0000-4000-8000-000000000005';
select is((select count(*) from public.notifications where entity_id='aa021100-0000-4000-8000-000000000005' and type='booking_reassigned'),3::bigint,'reassignment alerts old barber, new barber and manager once');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select is((select count(*) from public.notifications where entity_id='aa021100-0000-4000-8000-000000000005'),3::bigint,'manager sees only own three alerts, not barber rows');
update public.notifications set is_read=true,read_at=now() where entity_id='aa021100-0000-4000-8000-000000000005';
reset role;
select is((select count(*) from public.notifications where entity_id='aa021100-0000-4000-8000-000000000005' and recipient_role='barber' and not is_read),4::bigint,'manager mark-all leaves every barber alert unread');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"role":"barber"}}',true);
set local role authenticated;
select is((select count(*) from public.notifications where entity_id='aa021100-0000-4000-8000-000000000005'),3::bigint,'previous barber sees only own alerts');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated","app_metadata":{"role":"manager"}}',true);
set local role authenticated;
select is((select count(*) from public.notifications where entity_id='aa021100-0000-4000-8000-000000000005'),0::bigint,'other manager sees no alerts');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}',true);
update public.bookings set status='cancelled', staff_cancellation='{"reason":"Synthetic fixture cancellation"}' where id='aa021100-0000-4000-8000-000000000005';
select is((select count(*) from public.notifications where entity_id='aa021100-0000-4000-8000-000000000005' and type='booking_cancelled'),1::bigint,'manager cancellation alerts current barber, no self alert');
select set_config('request.jwt.claims','{}',true);
update public.user_notification_preferences set booking_updates=false where user_id='00000000-0000-4000-8000-000000000002';
update public.bookings set notes='Updated detail' where id='aa021100-0000-4000-8000-000000000005';
select is((select count(*) from public.notifications where entity_id='aa021100-0000-4000-8000-000000000005' and type='booking_updated'),3::bigint,'disabled category stops manager delivery but still alerts current barber');
select throws_like($$insert into public.bookings(branch_id,barber_id,date,time,added_by_type) values ('aa021100-0000-4000-8000-000000000002','aa021100-0000-4000-8000-000000000004','2035-06-01','11:00','customer'),('aa021100-0000-4000-8000-000000000002','aa021100-0000-4000-8000-000000000004','2035-06-01','11:00','customer')$$,'%Booking conflict%','failed booking rolls back its alerts');
select is((select count(*) from public.notifications where recipient_branch_id='aa021100-0000-4000-8000-000000000002'),9::bigint,'failed transaction leaves no orphan alerts');
select * from finish();
rollback;
