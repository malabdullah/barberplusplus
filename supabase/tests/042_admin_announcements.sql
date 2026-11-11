-- All fixture records, network queue writes and settings changes roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(1);
set local statement_timeout='45s';
create function pg_temp.ann_assert(value boolean,label text)returns void language plpgsql as $$begin if value is distinct from true then raise exception 'ANN_ASSERT: %',label;end if;end$$;
do $tests$
declare
 admin_id uuid:='bb120000-0000-4000-8000-000000000001';sid uuid:='bb120000-0000-4000-8000-000000000002';factor uuid:='bb120000-0000-4000-8000-000000000003';
 uid uuid:='bb120000-0000-4000-8000-000000000011';us uuid:='bb120000-0000-4000-8000-000000000012';cid uuid:='bb120000-0000-4000-8000-000000000013';
 did uuid:='bb120000-0000-4000-8000-000000000021';did2 uuid:='bb120000-0000-4000-8000-000000000022';
 actor jsonb;client jsonb;got jsonb;preview jsonb;campaign uuid;job jsonb;binding text;denied boolean;barber public.barbers%rowtype;bid uuid:=gen_random_uuid();before_prefs jsonb;
begin
 perform pg_temp.ann_assert(not has_function_privilege('anon','public.admin_push_api(text,jsonb)','EXECUTE'),'anonymous admin API denied');
 perform pg_temp.ann_assert(not has_function_privilege('authenticated','public.admin_push_worker(text,jsonb)','EXECUTE'),'clients cannot drain queue');
 perform pg_temp.ann_assert(not has_function_privilege('authenticated','public.customer_announcement_api(text,jsonb)','EXECUTE'),'clients cannot forge identity via RPC');
 perform pg_temp.ann_assert(not has_table_privilege('authenticated','private.announcement_targets','SELECT'),'recipient list stays private');
 perform pg_temp.ann_assert((select relrowsecurity from pg_class where oid='private.announcement_deliveries'::regclass),'delivery RLS');
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values(admin_id,'ann-admin@example.test',now(),'{"role":"admin"}'),(uid,'ann-customer@example.test',now(),'{"role":"customer"}');
 insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)values(factor,admin_id,'QA','totp','verified','synthetic-not-live',now(),now());
 insert into auth.sessions(id,user_id,aal,factor_id)values(sid,admin_id,'aal2',factor),(us,uid,'aal1',null);
 insert into public.customers(id,name,email,created_by_type)values(cid,'Announcement QA','ann-customer@example.test','customer');
 insert into private.customer_accounts(user_id,customer_id)values(uid,cid);
 actor:=jsonb_build_object('user_id',admin_id,'session_id',sid);client:=jsonb_build_object('user_id',uid,'session_id',us,'deviceId',did,'deviceSecret',repeat('a',64),'version',1);
 update private.announcement_runtime set enabled=true,mode='capture',api_url='https://qvkucvcjmojjbphlzlks.supabase.co'where singleton;
 -- Remote CI has no native runtime configured. This change rolls back on Test.
 insert into private.customer_push_runtime(singleton,api_url,topic,environments)values(true,'https://qvkucvcjmojjbphlzlks.supabase.co','com.barberplusplus.customer.test',array['sandbox'])on conflict(singleton)do update set api_url=excluded.api_url,topic=excluded.topic,environments=excluded.environments;
 insert into private.customer_push_devices(id,secret_hash,account_id,session_id,token,environment,topic,permission)values(did,extensions.digest(repeat('a',64),'sha256'),uid,us,repeat('b',64),'sandbox','com.barberplusplus.customer.test',true);
 select preferences into before_prefs from private.customer_push_devices where id=did;
 perform pg_temp.ann_assert(public.customer_announcement_api('status',client)->>'enabled'='false','announcements default off');
 perform public.customer_announcement_api('register',client);
 perform pg_temp.ann_assert(not private.announcement_device_allowed(did,uid),'register alone never opts in');
 got:=public.customer_announcement_api('preference',client||'{"enabled":true}');binding:=got->>'recipientBinding';
 perform pg_temp.ann_assert(length(binding)=64 and private.announcement_device_allowed(did,uid),'explicit opt-in and capability make device eligible');
 perform pg_temp.ann_assert(public.customer_announcement_api('register',client)->>'recipientBinding'=binding,'same account/session retains binding');
 perform pg_temp.ann_assert((select preferences from private.customer_push_devices where id=did)=before_prefs,'booking preferences unchanged');
 denied:=false;begin perform public.customer_announcement_api('register',client||jsonb_build_object('deviceSecret',repeat('c',64)));exception when others then denied:=sqlerrm='FORBIDDEN';end;perform pg_temp.ann_assert(denied,'device secret mismatch denied');
 denied:=false;begin perform public.admin_push_api('history',client);exception when others then denied:=sqlerrm='AUTH_REQUIRED';end;perform pg_temp.ann_assert(denied,'customer cannot administer announcements');
 update auth.sessions set aal='aal1'where id=sid;
 denied:=false;begin perform public.admin_push_api('history',actor);exception when others then denied:=sqlerrm='ADMIN_MFA_REQUIRED';end;perform pg_temp.ann_assert(denied,'admin aal1 denied');update auth.sessions set aal='aal2'where id=sid;
 got:=public.admin_push_api('users',actor||jsonb_build_object('filters',jsonb_build_object('userIds',jsonb_build_array(uid))));perform pg_temp.ann_assert(got->>'total'='1'and got->'users'->0->>'devices'='1','exact selected account and device count');
 perform pg_temp.ann_assert((public.admin_push_api('users',actor||jsonb_build_object('filters',jsonb_build_object('userIds',jsonb_build_array(uid),'excludeIds',jsonb_build_array(uid)))))->>'total'='0','exclusions override selection');
 perform pg_temp.ann_assert((public.admin_push_api('users',actor||jsonb_build_object('filters',jsonb_build_object('userIds',jsonb_build_array(uid),'roles',jsonb_build_array('manager')))))->>'total'='0','roles intersect account selection');
 select * into barber from public.barbers where branch_id is not null and cardinality(service_ids)>0 order by id limit 1;
 insert into public.bookings(id,customer_id,branch_id,barber_id,service_ids,date,time,duration,price,status,added_by_type)values(bid,cid,barber.branch_id,barber.id,barber.service_ids,current_date-1,'23:00',30,10,'completed','customer');
 insert into private.customer_booking_owners(booking_id,account_user_id)values(bid,uid);
 perform pg_temp.ann_assert((public.admin_push_api('users',actor||jsonb_build_object('filters',jsonb_build_object('userIds',jsonb_build_array(uid),'shopIds',jsonb_build_array(barber.branch_id)))))->>'total'='1','shop filter uses owned bookings');
 perform pg_temp.ann_assert((public.admin_push_api('users',actor||jsonb_build_object('filters',jsonb_build_object('userIds',jsonb_build_array(uid),'upcoming',true))))->>'total'='0','past booking does not match upcoming');
 perform pg_temp.ann_assert((public.admin_push_api('users',actor||jsonb_build_object('filters',jsonb_build_object('userIds',jsonb_build_array(uid),'city','Nonexistent QA city'))))->>'total'='0','unrelated city excluded');
 preview:=actor||jsonb_build_object('titleEn','QA announcement','bodyEn','Capture only','destination','book','filters',jsonb_build_object('userIds',jsonb_build_array(uid)));
 
 -- Every device, account and master-consent gate is checked independently.
 update private.customer_push_devices set permission=false where id=did;perform pg_temp.ann_assert(not private.announcement_device_allowed(did,uid),'OS permission denied');update private.customer_push_devices set permission=true where id=did;
 update private.customer_push_devices set enabled=false where id=did;perform pg_temp.ann_assert(not private.announcement_device_allowed(did,uid),'installation disabled');update private.customer_push_devices set enabled=true where id=did;
 update private.customer_push_devices set notifications_enabled=false where id=did;perform pg_temp.ann_assert(not private.announcement_device_allowed(did,uid),'installation master disabled');update private.customer_push_devices set notifications_enabled=true where id=did;
 insert into private.customer_push_preferences(account_id,notifications_enabled)values(uid,false);perform pg_temp.ann_assert(not private.announcement_device_allowed(did,uid),'account master disabled');update private.customer_push_preferences set notifications_enabled=true where account_id=uid;
 update private.customer_push_devices set topic='another.app'where id=did;perform pg_temp.ann_assert(not private.announcement_device_allowed(did,uid),'different app excluded');update private.customer_push_devices set topic='com.barberplusplus.customer.test'where id=did;
 update private.customer_push_devices set environment='production'where id=did;perform pg_temp.ann_assert(not private.announcement_device_allowed(did,uid),'production device excluded from Test');update private.customer_push_devices set environment='sandbox'where id=did;
 update auth.sessions set not_after=now()-interval '1 second'where id=us;perform pg_temp.ann_assert(not private.announcement_device_allowed(did,uid),'expired session excluded');update auth.sessions set not_after=null where id=us;
 update auth.users set banned_until=now()+interval '1 day'where id=uid;perform pg_temp.ann_assert(not private.announcement_device_allowed(did,uid),'suspended account excluded');update auth.users set banned_until=null where id=uid;
 update auth.users set raw_app_meta_data=raw_app_meta_data||'{"role":"manager"}'where id=uid;perform pg_temp.ann_assert(private.announcement_device_allowed(did,uid),'manager using customer app supported');
 update auth.users set raw_app_meta_data=raw_app_meta_data||'{"role":"barber"}'where id=uid;perform pg_temp.ann_assert(private.announcement_device_allowed(did,uid),'barber using customer app supported');
 update auth.users set raw_app_meta_data=raw_app_meta_data||'{"role":"customer"}'where id=uid;
 perform pg_temp.ann_assert((public.admin_push_api('users',actor||jsonb_build_object('filters',jsonb_build_object('userIds',jsonb_build_array(uid),'governorateId',(select governorate_id from public.branches where id=barber.branch_id),'dateFrom',(current_date-1)::text,'dateTo',(current_date-1)::text))))->>'total'='1','governorate and inclusive booking date filters intersect');
 denied:=false;begin perform public.admin_push_api('preview',preview||'{"titleAr":"مرحبا","bodyAr":""}');exception when others then denied:=sqlerrm='INVALID_REQUEST';end;perform pg_temp.ann_assert(denied,'incomplete translation denied');
 denied:=false;begin perform public.admin_push_api('preview',preview||'{"destination":"https://bad.example"}');exception when others then denied:=sqlerrm='INVALID_REQUEST';end;perform pg_temp.ann_assert(denied,'arbitrary destination denied');
got:=public.admin_push_api('preview',preview);campaign:=(got->'campaign'->>'id')::uuid;
 perform pg_temp.ann_assert(got->'campaign'->>'devices'='1'and got->'campaign'->>'eligibleUsers'='1','preview freezes exact audience');
 denied:=false;begin perform public.admin_push_api('send',actor||jsonb_build_object('campaignId',campaign));exception when others then denied:=sqlerrm='CONFIRMATION_REQUIRED';end;perform pg_temp.ann_assert(denied,'send needs explicit confirmation');
 insert into private.customer_push_devices(id,secret_hash,account_id,session_id,token,environment,topic,permission)values(did2,extensions.digest(repeat('c',64),'sha256'),uid,us,repeat('d',64),'sandbox','com.barberplusplus.customer.test',true);
 perform public.customer_announcement_api('register',client||jsonb_build_object('deviceId',did2,'deviceSecret',repeat('c',64)));
 perform pg_temp.ann_assert((select count(*)from private.announcement_deliveries where campaign_id=campaign)=1,'new device cannot expand frozen audience');
 got:=public.admin_push_api('send',actor||jsonb_build_object('campaignId',campaign,'confirmed',true));perform public.admin_push_api('send',actor||jsonb_build_object('campaignId',campaign,'confirmed',true));
 perform pg_temp.ann_assert((select count(*)from private.announcement_deliveries where campaign_id=campaign)=1,'repeat confirmation is idempotent');
 job:=public.admin_push_worker('claim','{"limit":20}')->0;perform pg_temp.ann_assert(job->>'recipientBinding'=binding,'opaque binding travels with job');
 perform pg_temp.ann_assert(public.admin_push_worker('validate',job)='true','queued job validated');
 perform public.admin_push_worker('finish',job||'{"status":200,"reason":"Captured"}');
 perform pg_temp.ann_assert((select state from private.announcement_deliveries where id=(job->>'id')::uuid)='captured','capture never claims APNs acceptance');
 perform pg_temp.ann_assert(public.admin_push_worker('finish',job||'{"status":200}')='false','duplicate worker acknowledgement denied');
 -- Every normal refresh rotates registration generation but retains native recipient binding.
 update private.customer_push_devices set registration_version=registration_version+1 where id=did;
 perform pg_temp.ann_assert(not private.announcement_device_allowed(did,uid),'stale native capability fails closed');
 perform public.customer_announcement_api('register',client);perform pg_temp.ann_assert(private.announcement_device_allowed(did,uid),'new generation needs explicit compatible re-registration');
 got:=public.admin_push_api('preview',preview);campaign:=(got->'campaign'->>'id')::uuid;perform public.admin_push_api('send',actor||jsonb_build_object('campaignId',campaign,'confirmed',true));
 perform public.customer_announcement_api('preference',client||'{"enabled":false}');perform public.admin_push_worker('claim','{}');
 perform pg_temp.ann_assert((select bool_and(state='skipped')from private.announcement_deliveries where campaign_id=campaign),'opt-out rechecked after preview');
 perform public.customer_announcement_api('preference',client||'{"enabled":true}');
 got:=public.admin_push_api('preview',preview);campaign:=(got->'campaign'->>'id')::uuid;update private.announcement_campaigns set preview_expires_at=now()-interval '1 second'where id=campaign;
 denied:=false;begin perform public.admin_push_api('send',actor||jsonb_build_object('campaignId',campaign,'confirmed',true));exception when others then denied:=sqlerrm='PREVIEW_EXPIRED';end;perform pg_temp.ann_assert(denied,'expired preview denied');
 got:=public.admin_push_api('preview',preview);campaign:=(got->'campaign'->>'id')::uuid;update private.announcement_runtime set mode='apns'where singleton;
 denied:=false;begin perform public.admin_push_api('send',actor||jsonb_build_object('campaignId',campaign,'confirmed',true));exception when others then denied:=sqlerrm='PREVIEW_EXPIRED';end;perform pg_temp.ann_assert(denied,'capture preview cannot become real send');update private.announcement_runtime set mode='capture'where singleton;
 -- Explicit transient provider failures retry at most three times; uncertain delivery never retries.
 perform public.admin_push_api('send',actor||jsonb_build_object('campaignId',campaign,'confirmed',true));
 job:=public.admin_push_worker('claim','{}')->0;perform public.admin_push_worker('finish',job||'{"status":503,"reason":"ServiceUnavailable"}');
 perform pg_temp.ann_assert((select state='pending'and attempts=1 from private.announcement_deliveries where id=(job->>'id')::uuid),'explicit transient failure scheduled for bounded retry');
 update private.announcement_deliveries set available_at=now(),attempts=2 where id=(job->>'id')::uuid;
 job:=public.admin_push_worker('claim','{}')->0;perform public.admin_push_worker('finish',job||'{"status":503}');
 perform pg_temp.ann_assert((select state='failed'and attempts=3 from private.announcement_deliveries where id=(job->>'id')::uuid),'retry cap enforced');
 job:=public.admin_push_worker('claim','{}')->0;
 -- Second device from the same campaign may already be leased by previous bounded claim.
 update private.announcement_deliveries set leased_until=now()-interval '1 second'where state='sending'and campaign_id=campaign;
 perform public.admin_push_worker('claim','{}');
 perform pg_temp.ann_assert(not exists(select 1 from private.announcement_deliveries where campaign_id=campaign and state='sending'),'expired ambiguous leases are not automatically replayed');
 insert into auth.sessions(id,user_id)values('bb120000-0000-4000-8000-000000000014',uid);
 update private.customer_push_devices set session_id='bb120000-0000-4000-8000-000000000014'where id=did;
 got:=public.customer_announcement_api('register',client||'{"session_id":"bb120000-0000-4000-8000-000000000014"}');perform pg_temp.ann_assert(got->>'recipientBinding'<>binding,'new auth session rotates recipient binding');
 perform pg_temp.ann_assert(jsonb_array_length(public.admin_push_api('options',actor)->'shops')<=25,'shop picker bounded');
 

 -- Master consent can be re-enabled without replaying a previously queued campaign.
 got:=public.admin_push_api('preview',preview);campaign:=(got->'campaign'->>'id')::uuid;perform public.admin_push_api('send',actor||jsonb_build_object('campaignId',campaign,'confirmed',true));
 perform public.customer_push_api('push-preferences',client||jsonb_build_object('deviceId',did2,'deviceSecret',repeat('c',64),'notificationsEnabled',false,'preferences',before_prefs));
 perform pg_temp.ann_assert(not private.announcement_device_allowed(did2,uid),'master off immediately excludes announcements');
 perform public.customer_push_api('push-preferences',client||jsonb_build_object('deviceId',did2,'deviceSecret',repeat('c',64),'notificationsEnabled',true,'preferences',before_prefs));
 perform pg_temp.ann_assert(private.announcement_device_allowed(did2,uid),'master on permits future announcements');
 perform pg_temp.ann_assert(not exists(select 1 from private.announcement_deliveries where campaign_id=campaign and private.announcement_delivery_allowed(id)),'master re-enable cannot replay the old queue');
 perform pg_temp.ann_assert((select enabled from private.announcement_preferences where account_id=uid),'master toggle preserves separate announcement choice');
 perform pg_temp.ann_assert((select preferences from private.customer_push_preferences where account_id=uid)=before_prefs,'master toggle preserves booking categories');
 perform public.admin_push_worker('claim','{}');
 perform pg_temp.ann_assert((select bool_and(state='skipped')from private.announcement_deliveries where campaign_id=campaign),'old campaign skipped after master re-enable');
 -- OS permission changes go through monotonic device registration generations.
 got:=public.admin_push_api('preview',preview);campaign:=(got->'campaign'->>'id')::uuid;perform public.admin_push_api('send',actor||jsonb_build_object('campaignId',campaign,'confirmed',true));
 perform public.customer_push_api('push-register',client||jsonb_build_object('deviceId',did2,'deviceSecret',repeat('c',64),'version',2,'token',repeat('d',64),'environment','sandbox','language','en','permission',false));
 perform public.customer_announcement_api('register',client||jsonb_build_object('deviceId',did2,'deviceSecret',repeat('c',64)));
 perform public.customer_push_api('push-register',client||jsonb_build_object('deviceId',did2,'deviceSecret',repeat('c',64),'version',3,'token',repeat('d',64),'environment','sandbox','language','en','permission',true));
 perform public.customer_announcement_api('register',client||jsonb_build_object('deviceId',did2,'deviceSecret',repeat('c',64)));
 perform pg_temp.ann_assert(private.announcement_device_allowed(did2,uid),'newly permitted compatible generation eligible');
 perform pg_temp.ann_assert(not exists(select 1 from private.announcement_deliveries where campaign_id=campaign and device_id=did2 and private.announcement_delivery_allowed(id)),'permission off/on cannot replay frozen old generation');
 -- Only the private worker can set delivery mode, and capture never targets production.
 denied:=false;begin update private.announcement_runtime set api_url='https://srv1073968.hstgr.cloud',mode='capture'where singleton;exception when check_violation then denied:=true;end;perform pg_temp.ann_assert(denied,'capture prohibited on production API');
 raise notice 'ANNOUNCEMENT_DATABASE_SCENARIOS_PASS';
end $tests$;
select pass('Announcement auth, audience, binding, queue, retries and capture invariants');
select * from finish();
rollback;
