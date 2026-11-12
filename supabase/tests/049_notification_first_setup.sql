-- Transactional fixtures only; no provider calls or committed preference changes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(1);
create temp table notification_default_checks(label text);
create function pg_temp.notification_default_assert(ok boolean,label text)returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'NOTIFICATION_DEFAULT_ASSERT: %',label;end if;
 insert into notification_default_checks values(label);
end $$;
do $tests$
declare
 uid uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();cid uuid:=gen_random_uuid();did uuid:=gen_random_uuid();did2 uuid:=gen_random_uuid();
 admin_id uuid:=gen_random_uuid();admin_session uuid:=gen_random_uuid();factor uuid:=gen_random_uuid();
 campaign uuid:=gen_random_uuid();target uuid:=gen_random_uuid();delivery uuid:=gen_random_uuid();
 client jsonb;got jsonb;before_at timestamptz;epoch_at timestamptz;binding text;denied boolean;
 chosen jsonb:='{"updates":false,"reminder24":true,"reminder2":false,"reviews":false}';
 all_on jsonb:='{"updates":true,"reminder24":true,"reminder2":true,"reviews":true}';
 token text:=encode(extensions.gen_random_bytes(32),'hex');
begin
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values
  (uid,uid::text||'@example.test',now(),'{"role":"customer"}'),(admin_id,admin_id::text||'@example.test',now(),'{"role":"admin"}');
 insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
  values(factor,admin_id,'Rollback QA','totp','verified','synthetic-not-live',now(),now());
 insert into auth.sessions(id,user_id)values(sid,uid);
 insert into auth.sessions(id,user_id,aal,factor_id)values(admin_session,admin_id,'aal2',factor);
 insert into public.customers(id,name,email,created_by_type)values(cid,'Notification first setup rollback QA',uid::text||'@example.test','customer');
 insert into private.customer_accounts(user_id,customer_id)values(uid,cid);
 insert into private.customer_push_runtime(singleton,api_url,topic,environments)
  values(true,'https://qvkucvcjmojjbphlzlks.supabase.co','com.barberplusplus.customer.test',array['sandbox'])
  on conflict(singleton)do update set api_url=excluded.api_url,topic=excluded.topic,environments=excluded.environments;
 insert into private.customer_push_devices(id,secret_hash,account_id,session_id,token,environment,topic,permission,registration_version)
  values(did,extensions.digest(repeat('a',64),'sha256'),uid,sid,token,'sandbox','com.barberplusplus.customer.test',true,1);
 client:=jsonb_build_object('user_id',uid,'session_id',sid,'deviceId',did,'deviceSecret',repeat('a',64),'version',1);
 perform pg_temp.notification_default_assert((select preferences=all_on from private.customer_push_devices where id=did),'all four booking defaults on');
 got:=public.customer_announcement_api('status',client);
 perform pg_temp.notification_default_assert(got->>'enabled'='false' and got->>'preferenceConfigured'='false','legacy absent preference remains off and distinguishable');
 perform public.customer_announcement_api('register',client);
 perform public.customer_announcement_api('register',client||'{"initializeDefaults":false}');
 perform pg_temp.notification_default_assert(not exists(select 1 from private.announcement_preferences where account_id=uid),'legacy registration and false flag do not initialize');
 before_at:=clock_timestamp();
 got:=public.customer_announcement_api('register',client||'{"initializeDefaults":true}');binding:=got->>'recipientBinding';
 select enabled_since into epoch_at from private.announcement_preferences where account_id=uid;
 perform pg_temp.notification_default_assert(got->>'enabled'='true' and got->>'preferenceConfigured'='true','first setup initializes on');
 perform pg_temp.notification_default_assert(epoch_at>=before_at,'first setup starts a fresh consent boundary');
 perform pg_temp.notification_default_assert(length(binding)=64 and private.announcement_device_allowed(did,uid),'normal bound device eligible after setup');
 got:=public.customer_announcement_api('register',client||'{"initializeDefaults":true}');
 perform pg_temp.notification_default_assert(got->>'recipientBinding'=binding and (select enabled_since=epoch_at from private.announcement_preferences where account_id=uid),'repeated setup keeps binding and epoch');
 insert into private.customer_push_preferences(account_id,preferences,notifications_enabled)values(uid,chosen,false);
 perform pg_temp.notification_default_assert(not private.announcement_device_allowed(did,uid),'account master off blocks default-on category');
 update private.customer_push_preferences set notifications_enabled=true where account_id=uid;
 update private.customer_push_devices set permission=false where id=did;
 perform pg_temp.notification_default_assert(not private.announcement_device_allowed(did,uid),'OS denial blocks default-on category');
 update private.customer_push_devices set permission=true where id=did;
 perform public.customer_announcement_api('register',client);
 perform public.customer_announcement_api('preference',client||'{"enabled":false}');
 got:=public.customer_announcement_api('register',client||'{"initializeDefaults":true}');
 perform pg_temp.notification_default_assert(got->>'enabled'='false' and got->>'preferenceConfigured'='true','saved off remains off after initialization retry');
 insert into private.customer_push_devices(id,secret_hash,account_id,session_id,token,environment,topic,permission,registration_version)
  values(did2,extensions.digest(repeat('b',64),'sha256'),uid,sid,encode(extensions.gen_random_bytes(32),'hex'),'sandbox','com.barberplusplus.customer.test',true,1);
 got:=public.customer_announcement_api('register',client||jsonb_build_object('deviceId',did2,'deviceSecret',repeat('b',64),'initializeDefaults',true));
 perform pg_temp.notification_default_assert(got->>'enabled'='false','another installation preserves account opt-out');
 got:=public.customer_announcement_api('preference',client||'{"enabled":true}');
 perform pg_temp.notification_default_assert(got->>'enabled'='true' and (select enabled_since>epoch_at from private.announcement_preferences where account_id=uid),'explicit re-enable advances boundary');
 select enabled_since into epoch_at from private.announcement_preferences where account_id=uid;
 update private.announcement_runtime set mode='capture',enabled=true,api_url='https://qvkucvcjmojjbphlzlks.supabase.co'where singleton;
 insert into private.announcement_campaigns(id,created_by,title_en,body_en,destination,filters,state,delivery_mode,guard_version,created_at)
  values(campaign,admin_id,'Rollback QA','Never send','book','{}','queued','capture',2,epoch_at-interval '1 second');
 insert into private.announcement_targets(id,campaign_id,account_id)values(target,campaign,uid);
 insert into private.announcement_deliveries(id,campaign_id,target_id,device_id,registration_version,recipient_binding,token_hash,eligibility_epoch)
  select delivery,campaign,target,did,d.registration_version,cap.binding,extensions.digest(d.token,'sha256'),cap.eligibility_epoch
   from private.customer_push_devices d join private.announcement_devices cap on cap.device_id=d.id where d.id=did;
 perform pg_temp.notification_default_assert(not private.announcement_delivery_allowed(delivery),'pre-consent campaign never replays');
 update private.announcement_campaigns set created_at=clock_timestamp()where id=campaign;
 perform pg_temp.notification_default_assert(private.announcement_delivery_allowed(delivery),'future campaign uses unchanged delivery guards');
 update private.customer_push_devices set token=encode(extensions.gen_random_bytes(32),'hex')where id=did;
 perform pg_temp.notification_default_assert(not private.announcement_delivery_allowed(delivery),'token change invalidates frozen delivery');
 denied:=false;begin perform public.customer_announcement_api('register',client||'{"initializeDefaults":"true"}');exception when others then denied:=sqlerrm='INVALID_REQUEST';end;
 perform pg_temp.notification_default_assert(denied,'non-boolean initialization rejected');
 denied:=false;begin perform public.customer_announcement_api('status',client||'{"initializeDefaults":true}');exception when others then denied:=sqlerrm='INVALID_REQUEST';end;
 perform pg_temp.notification_default_assert(denied,'status cannot initialize');
 denied:=false;begin perform public.customer_announcement_api('register',client||jsonb_build_object('deviceSecret',repeat('c',64),'initializeDefaults',true));exception when others then denied:=sqlerrm='FORBIDDEN';end;
 perform pg_temp.notification_default_assert(denied,'forged installation rejected');
 update auth.sessions set not_after=now()-interval '1 second'where id=sid;
 denied:=false;begin perform public.customer_announcement_api('register',client||'{"initializeDefaults":true}');exception when others then denied:=sqlerrm='AUTH_REQUIRED';end;
 perform pg_temp.notification_default_assert(denied,'expired account session rejected');
 perform pg_temp.notification_default_assert((select preferences=chosen from private.customer_push_preferences where account_id=uid),'all existing booking category choices preserved');
 perform pg_temp.notification_default_assert(not has_function_privilege('anon','public.customer_announcement_api(text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.customer_announcement_api(text,jsonb)','EXECUTE'),'RPC remains service-only');
 perform pg_temp.notification_default_assert(not has_function_privilege('authenticated','private.customer_announcement_api(text,jsonb)','EXECUTE'),'private implementation remains service-only');
end $tests$;
select pass('First-setup defaults, saved choices, no replay and recipient guards');
select count(*) as assertions from notification_default_checks;
select * from finish();
rollback;
