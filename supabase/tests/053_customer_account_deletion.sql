-- Only new disposable fixtures, with all writes and pilot configuration rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); ms uuid:=gen_random_uuid();
 o uuid:=gen_random_uuid(); os uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); shop uuid:=gen_random_uuid(); chair uuid:=gen_random_uuid(); svc uuid:=gen_random_uuid();
 past uuid:=gen_random_uuid(); upcoming uuid:=gen_random_uuid(); added uuid:=gen_random_uuid(); job uuid:=gen_random_uuid();
 r jsonb; p jsonb; scope jsonb; lease jsonb; wrong boolean; n integer; report_id uuid; own_device uuid:=gen_random_uuid(); other_device uuid:=gen_random_uuid(); snapshot_amount numeric; fixture_phone text:='80'||lpad(floor(random()*1000000)::text,6,'0'); conversation uuid:=gen_random_uuid();
begin
 perform set_config('request.jwt.claims','{}',true);
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values
 (u,u||'@example.test',now(),'{"role":"customer","deletion_qa":true}'),(m,m||'@example.test',now(),'{"role":"manager","deletion_qa":true}'),(o,o||'@example.test',now(),'{"role":"customer","deletion_qa":true}');
 insert into auth.sessions(id,user_id)values(sid,u),(ms,m),(os,o);
 insert into public.customers(id,name,email)values(c,'Deletion rollback customer',u||'@example.test');
 insert into private.customer_accounts(user_id,customer_id)values(u,c);
 update public.customers set country_code='+965',phone=fixture_phone where id=c;
 insert into private.customer_phone_verifications(customer_id,verified_at)values(c,now());
 insert into public.whatsapp_conversations(id,phone_number,phone_country_code,customer_name)values(conversation,fixture_phone,'+965','Private QA contact');

 insert into public.branches(id,manager_id,name)values(shop,m,'Deletion rollback shop');
 insert into public.services(id,branch_id,name,duration,price)values(svc,shop,'Rollback service',30,3);
 insert into public.barbers(id,branch_id,name,status,service_ids)values(chair,shop,'Rollback barber','active',array[svc]);
 insert into public.bookings(id,branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type,notes)values
 (past,shop,chair,c,current_date-2,'10:00',array[svc],30,3,'completed','customer','Private past note'),
 (upcoming,shop,chair,c,current_date+2,'10:00',array[svc],30,3,'confirmed','customer','Private future note');
 insert into private.customer_booking_ratings(booking_id,shop_rating,barber_rating)values(past,5,4);
 insert into private.customer_favourites(id,customer_id,branch_id)values(gen_random_uuid(),c,shop);
 insert into private.customer_booking_share_versions(booking_id,id,nonce,token_hash,customer_id,account_user_id,snapshot,expires_at,snapshot_at)
 values(upcoming,gen_random_uuid(),gen_random_uuid(),encode(extensions.gen_random_bytes(32),'hex'),c,u,private.booking_share_snapshot(upcoming),now()+interval'7 days',now());
 insert into private.customer_push_devices(id,secret_hash,account_id,session_id,environment,topic)values
 (own_device,extensions.gen_random_bytes(32),u,sid,'sandbox','com.barberplusplus.customer.test'),
 (other_device,extensions.gen_random_bytes(32),o,os,'sandbox','com.barberplusplus.customer.test');
 insert into private.customer_push_guests(device_id,booking_id,expires_at)values(other_device,upcoming,now()+interval'7 days');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'session_id',ms,'role','authenticated','aal','aal1','app_metadata',jsonb_build_object('role','manager'))::text,true);
 r:=public.staff_reports('create','{"preset":"month","type":"customers"}');report_id:=(r->>'id')::uuid;
 r:=public.staff_reports('build',r);assert r->>'state'='ready','fixture report generated';
 assert exists(select 1 from private.staff_report_rows where run_id=report_id and customer_id=c),'report contains fixture customer';
 select sum(amount)into snapshot_amount from private.staff_report_rows where run_id=report_id;assert snapshot_amount=3,'fixture period contains past booking value';
 assert not has_function_privilege('authenticated','public.customer_deletion_service(text,jsonb)','execute'),'client cannot invoke privileged deletion';
 assert not has_function_privilege('anon','public.customer_deletion_service(text,jsonb)','execute'),'anonymous cannot invoke deletion';
 assert not has_table_privilege('service_role','private.customer_deletion_jobs','select'),'no direct service table access';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 scope:=jsonb_build_object('id',job,'user_id',u,'session_id',sid,'receipt_hash',repeat('a',64),'receipt_box','encrypted-test-fixture','code_hash',repeat('b',64));
 wrong:=false;begin perform public.customer_deletion_service('preview',scope);exception when others then assert sqlerrm='TEST_ACCOUNT_ONLY',sqlerrm;wrong:=true;end;assert wrong,'pilot rejects nonallowlisted user';
 perform public.customer_deletion_service('configure',jsonb_build_object('url','https://qvkucvcjmojjbphlzlks.supabase.co/functions/v1/customer-account-deletion','users',jsonb_build_array(u,m,o)));
 p:=public.customer_deletion_service('preview',scope); assert p->>'upcomingCount'='1','only future active appointments previewed';
 assert jsonb_array_length(p->'upcoming')=1,'bounded preview';
 assert p->>'email'=u||'@example.test','verified server email';
 wrong:=false;begin perform public.customer_deletion_service('preview',scope||jsonb_build_object('user_id',m,'session_id',ms));exception when others then assert sqlerrm='LINKED_WORK_ACCOUNT',sqlerrm;wrong:=true;end;assert wrong,'manager remains protected';
 r:=public.customer_deletion_service('preview',scope||jsonb_build_object('user_id',o,'session_id',os));assert r->>'upcomingCount'='0','incomplete profile can be deleted';
 wrong:=false;begin perform public.customer_deletion_service('preview',scope||jsonb_build_object('session_id',gen_random_uuid()));exception when others then assert sqlerrm='AUTH_REQUIRED',sqlerrm;wrong:=true;end;assert wrong,'unrelated session rejected';
 r:=public.customer_deletion_service('start',scope);assert r->>'created'='true','operation started';
 r:=public.customer_deletion_service('start',scope||jsonb_build_object('receipt_hash',repeat('c',64),'receipt_box','replacement'));assert r->>'created'='false'and r->>'receiptBox'='encrypted-test-fixture','idempotency preserves recovery receipt';
 wrong:=false;begin perform public.customer_deletion_service('confirm',scope||jsonb_build_object('digest',p->>'digest','confirmCancellation',true));exception when others then assert sqlerrm='REAUTH_REQUIRED',sqlerrm;wrong:=true;end;assert wrong,'proof required before erasure';
 for n in 1..5 loop r:=public.customer_deletion_service('verify',scope||jsonb_build_object('code_hash',repeat('c',64)));assert r->>'error'='INVALID_CODE','incorrect code persisted';end loop;
 r:=public.customer_deletion_service('verify',scope);assert r->>'error'='CODE_EXPIRED','five wrong attempts exhaust proof';
 assert(select code_attempts=5 from private.customer_deletion_jobs where id=job),'attempts survive failed verification';
 update private.customer_deletion_jobs set last_mail_at=now()-interval'2 minutes'where id=job;
 r:=public.customer_deletion_service('resend',scope);assert r->>'state'='awaiting_code','resend resets bounded proof';
 wrong:=false;begin perform public.customer_deletion_service('resend',scope);exception when others then assert sqlerrm='RATE_LIMITED',sqlerrm;wrong:=true;end;assert wrong,'resend throttled';
 r:=public.customer_deletion_service('verify',scope);assert r->>'state'='verified','fresh valid code accepted';
 perform set_config('request.jwt.claims','{}',true);
 insert into public.bookings(id,branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type)values(added,shop,chair,c,current_date+3,'10:00',array[svc],30,3,'pending','customer');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.customer_deletion_service('confirm',scope||jsonb_build_object('digest',p->>'digest','confirmCancellation',true));assert r->>'state'='review_required','changed appointments force explicit review';
 assert exists(select 1 from auth.sessions where id=sid),'review has no account side effects';
 r:=public.customer_deletion_service('confirm',scope||jsonb_build_object('digest',r->>'digest','confirmCancellation',true));assert r->>'state'='cleanup_pending','confirmed application erasure';
 assert r->>'cancelledCount'='2','all future active bookings cancelled';
 assert not exists(select 1 from auth.sessions where user_id=u),'sessions revoked immediately';
 assert not public.customer_session_is_live(u,sid),'old JWT session rejected';
 assert(select account_deleted_at is not null and email is null and phone is null and name='Deleted customer'from public.customers where id=c),'canonical identity erased';
 assert(select status='completed'and price=3 and duration=30 and notes is null from public.bookings where id=past),'anonymous past money and services preserved';
 assert not exists(select 1 from public.bookings where id=any(array[upcoming,added])and(status<>'cancelled'or notes is not null or staff_cancellation is not null)),'future cancellation anonymized';
 assert not exists(select 1 from private.customer_booking_email_jobs where booking_id=any(array[past,upcoming,added])),'no customer cancellation email survives';
 assert not exists(select 1 from private.customer_accounts where user_id=u),'account links erased';
 assert not exists(select 1 from public.whatsapp_conversations where id=conversation),'app-verified email-account phone history removed';

 assert not exists(select 1 from private.customer_booking_ratings where booking_id=past),'ratings removed';
 assert not exists(select 1 from private.customer_favourites where customer_id=c),'favourites removed';
 assert not exists(select 1 from private.customer_booking_share_versions where customer_id=c),'shared URLs revoked';
 assert not exists(select 1 from private.customer_push_devices where id=own_device),'own notification device removed';
 assert exists(select 1 from private.customer_push_devices where id=other_device and account_id=o),'another account on a reused device is preserved';
 assert not exists(select 1 from private.customer_push_guests where booking_id=upcoming),'old guest notification link removed';
 assert(select state='failed'and result is null and error_code='REPORT_SOURCE_DELETED'from private.staff_report_runs where id=report_id),'old report invalidated';
 assert not exists(select 1 from private.staff_report_rows where run_id=report_id and customer_id=c and(payload->>'customerName'<>'Deleted customer'or shop_rating is not null or barber_rating is not null)),'report payload anonymized';
 assert(select sum(amount)=snapshot_amount from private.staff_report_rows where run_id=report_id),'frozen report booking amounts preserved';

 wrong:=false;begin update public.customers set email='revive@example.test'where id=c;exception when others then assert sqlerrm='CUSTOMER_ACCOUNT_DELETED',sqlerrm;wrong:=true;end;assert wrong,'tombstone cannot be revived';
 wrong:=false;begin update public.bookings set date=date+1 where id=past;exception when others then assert sqlerrm='CUSTOMER_ACCOUNT_DELETED',sqlerrm;wrong:=true;end;assert wrong,'erased customer cannot be rescheduled';
 r:=public.customer_deletion_service('status',jsonb_build_object('id',job,'receipt_hash',repeat('a',64)));assert r->>'state'='cleanup_pending','receipt status works without a session';
 wrong:=false;begin perform public.customer_deletion_service('status',jsonb_build_object('id',job,'receipt_hash',repeat('c',64)));exception when others then assert sqlerrm='RECEIPT_INVALID',sqlerrm;wrong:=true;end;assert wrong,'unrelated receipt denied';
 lease:=public.customer_deletion_service('claim',jsonb_build_object('id',job));assert lease->'userIds'=jsonb_build_array(u),'cleanup claim scoped to deleted identity';
 assert public.customer_deletion_service('claim',jsonb_build_object('id',job))='null'::jsonb,'concurrent claim denied';
 wrong:=false;begin perform public.customer_deletion_service('finish',lease);exception when others then assert sqlerrm='CLEANUP_PENDING',sqlerrm;wrong:=true;end;assert wrong,'cannot claim completion while Auth identity remains';
 delete from auth.users where id=u;
 assert public.customer_deletion_service('finish',lease)='true'::jsonb,'cleanup completes after identity removal';
 r:=public.customer_deletion_service('status',jsonb_build_object('id',job,'receipt_hash',repeat('a',64)));assert r->>'state'='complete','completion is durable';
 assert(select user_id is null and user_ids is null and customer_ids is null and email_hash is null and receipt_box is null from private.customer_deletion_jobs where id=job),'completed receipt is anonymous';
 assert exists(select 1 from auth.users where id=m)and exists(select 1 from auth.users where id=o),'other accounts untouched';
 perform set_config('test.customer_deletion_result','{"suite":"account deletion rollback","passed":true,"productionTouched":false,"persistedFixtures":0}',true);
end $$;
select current_setting('test.customer_deletion_result')::jsonb as result;
rollback;
