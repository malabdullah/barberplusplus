-- Transaction-only synthetic registry/queue verification. No provider calls.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(1);
do $checks$
#variable_conflict use_variable
declare
 person uuid:='ad670000-0000-4000-8000-000000000001';other_person uuid:='ad670000-0000-4000-8000-000000000002';
 sid uuid:='ad670000-0000-4000-8000-000000000011';other_sid uuid:='ad670000-0000-4000-8000-000000000012';
 device uuid:='ad670000-0000-4000-8000-000000000021';device2 uuid:='ad670000-0000-4000-8000-000000000022';
 shop uuid:='ad670000-0000-4000-8000-000000000031';barber uuid:='ad670000-0000-4000-8000-000000000032';svc uuid:='ad670000-0000-4000-8000-000000000033';booking uuid:='ad670000-0000-4000-8000-000000000034';
 customer uuid;payload jsonb;payload2 jsonb;result jsonb;j jsonb;event uuid;denied boolean;before_test jsonb;before_apns bigint;revision bigint;
begin
 assert not public.authorize_android_live_push_dispatch(repeat('a',64)),'unconfigured scheduler secret rejected';
 assert not has_function_privilege('anon','public.customer_android_live_push_api(text,jsonb)','EXECUTE'),'anonymous gateway denied';
 assert not has_function_privilege('authenticated','public.customer_android_live_push_api(text,jsonb)','EXECUTE'),'authenticated gateway denied';
 assert has_function_privilege('service_role','public.customer_android_live_push_api(text,jsonb)','EXECUTE'),'service gateway allowed';
 assert not has_table_privilege('service_role','private.android_live_push_devices','SELECT'),'registry not directly readable';
 assert not(select prosecdef from pg_proc where oid='public.customer_android_live_push_api(text,jsonb)'::regprocedure),'public wrapper invoker';
 assert (select count(*)=4 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'and c.relname like 'android_live_push_%'and c.relkind='r'and c.relrowsecurity),'four RLS tables';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 if to_regclass('private.customer_android_push_devices')is not null then
 select jsonb_build_array((select count(*)from private.customer_android_push_devices),(select count(*)from private.customer_android_push_deliveries),(select md5(to_jsonb(r)::text)from private.customer_android_push_runtime r))into before_test;
 end if;
 select count(*)into before_apns from private.customer_push_deliveries;
 payload:=jsonb_build_object('deviceId',device,'deviceSecret',repeat('a',64),'user_id',person,'session_id',sid,'version',1,'token',repeat('synthetic-token-',4),'projectId','barber-plus-plus-phone-prod','packageName','com.barberplusplus.customer','permission',true,'language','en');
 denied:=false;begin perform public.customer_android_live_push_api('push-register',payload);exception when others then denied:=sqlerrm='PUSH_NOT_CONFIGURED';end;assert denied,'Live transport rejects Test deployment binding';
 -- The release-only CI schema intentionally lacks the older Test experiment.
 -- Its disposable runtime is bound to the same synthetic Test tuple inside this
 -- rollback only; hosted Test already has this value and is not changed.
 if (select api_url from private.customer_push_runtime where singleton)is distinct from'https://qvkucvcjmojjbphlzlks.supabase.co'then
  update private.customer_push_runtime set api_url='https://qvkucvcjmojjbphlzlks.supabase.co'where singleton;
 end if;
 -- Test tuple is scoped to this rolled-back transaction and uses no credentials.
 update private.android_live_push_runtime set environment='cloud-test',api_url='https://qvkucvcjmojjbphlzlks.supabase.co',project_id='barber-plus-plus-phone-test',package_name='com.barberplusplus.customer.test',registration_enabled=true,delivery_enabled=true,activated_at=now()-interval'1 second';
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values(person,person||'@example.test',now(),'{"role":"manager"}'),(other_person,other_person||'@example.test',now(),'{"role":"customer"}');
 insert into auth.sessions(id,user_id)values(sid,person),(other_sid,other_person);
 perform public.customer_account_api('email-ensure',jsonb_build_object('user_id',person,'session_id',sid,'name','Android synthetic QA'));
 perform public.customer_account_api('email-ensure',jsonb_build_object('user_id',other_person,'session_id',other_sid,'name','Other Android synthetic QA'));
 select customer_id into customer from private.customer_accounts where user_id=person;
 denied:=false;begin perform public.customer_android_live_push_api('push-register',payload);exception when others then denied:=sqlerrm='INVALID_REQUEST';end;assert denied,'wrong project rejected';
 payload:=payload||'{"projectId":"barber-plus-plus-phone-test","packageName":"com.barberplusplus.customer.test"}';
 assert public.customer_android_live_push_api('push-register',payload)->>'provider'='fcm','registration succeeds';
 assert public.customer_android_live_push_api('push-register',payload)->>'success'='true','exact retry idempotent';
 denied:=false;begin perform public.customer_android_live_push_api('push-register',payload||'{"language":"ar"}');exception when others then denied:=sqlerrm='INVALID_REQUEST';end;assert denied,'same version cannot change intent';
 denied:=false;begin perform public.customer_android_live_push_api('push-register',payload||jsonb_build_object('user_id',other_person,'session_id',other_sid,'version',2));exception when others then denied:=sqlerrm='FORBIDDEN';end;assert denied,'device capability cannot cross owner';
 denied:=false;begin perform public.customer_android_live_push_api('push-status',payload||jsonb_build_object('deviceSecret',repeat('b',64)));exception when others then denied:=sqlerrm='FORBIDDEN';end;assert denied,'wrong capability denied';
 denied:=false;begin perform public.customer_android_live_push_api('push-status',payload||jsonb_build_object('session_id',other_sid));exception when others then denied:=sqlerrm='AUTH_REQUIRED';end;assert denied,'stale or foreign session denied';
 denied:=false;begin perform public.customer_android_live_push_api(null,payload);exception when others then denied:=sqlerrm='INVALID_REQUEST';end;assert denied,'null action denied';
 denied:=false;begin perform public.customer_android_live_push_api('push-register',payload||'{"version":1.5}');exception when others then denied:=sqlerrm='INVALID_REQUEST';end;assert denied,'fractional registration version denied';
 denied:=false;begin perform public.customer_android_live_push_api('push-register',payload||'{"version":9007199254740992}');exception when others then denied:=sqlerrm='INVALID_REQUEST';end;assert denied,'unsafe registration version denied';
 denied:=false;begin perform public.customer_android_live_push_api('push-register',payload||'{"version":2,"language":null}');exception when others then denied:=sqlerrm='INVALID_REQUEST';end;assert denied,'missing language denied';
 result:=public.customer_android_live_push_api('push-preferences',payload||'{"preferences":{"updates":false,"reminder24":true,"reminder2":true,"reviews":true},"notificationsEnabled":true}');
 assert result->'preferences'->>'updates'='false','explicit update opt-out saved';
 perform public.customer_android_live_push_api('push-register',payload||'{"version":2}');
 assert (public.customer_android_live_push_api('push-status',payload)->'preferences'->>'updates')='false','registration preserves opt-out';
 denied:=false;begin perform public.customer_android_live_push_api('push-preferences',payload||'{"preferences":{"updates":true},"notificationsEnabled":true}');exception when others then denied:=sqlerrm='INVALID_REQUEST';end;assert denied,'incomplete preferences denied';
 perform public.customer_android_live_push_api('push-preferences',payload||'{"preferences":{"updates":true,"reminder24":true,"reminder2":true,"reviews":true},"notificationsEnabled":true}');
 -- Publication is transaction-only and rolls back with every fixture.
 perform set_config('request.jwt.claims','{}',true);
 insert into public.branches(id,name,manager_id,status,city,governorate_id,area_id)select shop,'Android transactional QA',person,'active','QA',(select governorate_id from public.areas order by id limit 1),(select id from public.areas order by id limit 1);
 insert into private.billing_access_grants(business_id,kind,starts_at,ends_at,reason,actor_id)select business_id,'full',clock_timestamp()-interval'1 hour',clock_timestamp()+interval'1 day','Android transactional QA',person from private.billing_shops where branch_id=shop;
 insert into public.services(id,branch_id,name,duration,price)values(svc,shop,'QA service',30,5);
 insert into public.barbers(id,branch_id,name,status,management_mode,service_ids)values(barber,shop,'QA managed barber','active','managed',array[svc]);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',person,'session_id',sid,'role','authenticated')::text,true);
 update public.barbers set availability=(select jsonb_object_agg(d,jsonb_build_object('enabled',true,'start','09:00','end','21:00'))from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])d)where id=barber;
 perform public.manage_shop_publication(shop,'publish','draft');
 perform set_config('request.jwt.claims','{}',true);
 insert into public.bookings(id,branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type)values(booking,shop,barber,customer,(now()at time zone'Asia/Kuwait')::date+2,'10:00',array[svc],30,5,'confirmed','customer');
 insert into private.customer_booking_owners(booking_id,account_user_id)values(booking,person)on conflict(booking_id)do nothing;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 -- Existing booking triggers create the exact normal event/revision/schedules.
 select r.revision into revision from private.customer_push_revisions r where booking_id=booking;
 assert revision is not null,'existing booking trigger reused';
 -- Production eligibility uses now(); put only synthetic registration/enabled-since just before transaction timestamp.
 update private.android_live_push_devices set registered_at=now()-interval'1 second'where id=device;
 update private.customer_push_preferences set preference_enabled_since='{}'where account_id=person;
 result:=public.customer_android_live_push_dispatch('claim','{}');
 assert jsonb_array_length(result)=1,'one booking event claimed once';j:=result->0;
 assert j->>'kind'='confirmed'and j->>'bookingId'=booking::text,'normal booking payload';
 assert public.customer_android_live_push_dispatch('validate',j)='true','current lease validates';
 assert public.customer_android_live_push_dispatch('claim','{}')='[]','parallel claim cannot duplicate lease';
 perform public.customer_android_live_push_dispatch('finish',j||'{"outcome":"captured"}');
 assert public.customer_android_live_push_dispatch('claim','{}')='[]','capture is terminal';
 assert public.customer_android_live_push_dispatch('finish',j||'{"outcome":"sent"}')='false','duplicate acknowledgment cannot rewrite terminal state';
 select id into event from private.customer_push_events where booking_id=booking and kind='confirmed';
 update private.android_live_push_deliveries set state='pending',finished_at=null where event_id=event;
 result:=public.customer_android_live_push_dispatch('claim','{}');j:=result->0;
 perform public.customer_android_live_push_dispatch('finish',j||'{"outcome":"retryable","retryAfterSeconds":120}');
 assert(select state='pending'and available_at>=now()+interval'120 seconds'from private.android_live_push_deliveries where id=(j->>'id')::uuid),'explicit provider backoff respected';
 update private.android_live_push_deliveries set available_at=now()where event_id=event;
 j:=public.customer_android_live_push_dispatch('claim','{}')->0;
 perform public.customer_android_live_push_dispatch('finish',j||'{"outcome":"uncertain"}');
 assert public.customer_android_live_push_dispatch('claim','{}')='[]','unknown outcome never replays';
 update private.android_live_push_deliveries set state='pending',attempts=0 where event_id=event;
 j:=public.customer_android_live_push_dispatch('claim','{}')->0;
 update private.android_live_push_deliveries set leased_until=now()-interval'1 second'where event_id=event;
 assert public.customer_android_live_push_dispatch('claim','{}')='[]','expired in-flight lease never automatically replays';
 assert(select state='uncertain'from private.android_live_push_deliveries where event_id=event),'expired lease marked uncertain';
 update private.android_live_push_deliveries set state='pending',attempts=0 where event_id=event;
 j:=public.customer_android_live_push_dispatch('claim','{}')->0;
 perform public.customer_android_live_push_api('push-register',payload||'{"version":3,"token":"rotated-synthetic-token-0000000000"}');
 assert public.customer_android_live_push_dispatch('validate',j)='false','rotation invalidates leased token';
 perform public.customer_android_live_push_dispatch('finish',j||'{"outcome":"invalid-token"}');
 assert(select token is not null and registration_version=3 from private.android_live_push_devices where id=device),'old invalid token response cannot retire new token';
 perform public.customer_android_live_push_api('push-detach',payload||'{"version":4}'-array['user_id','session_id']);
 assert(select detached and token is null from private.android_live_push_devices where id=device),'capability-only detach works';
 perform public.customer_android_live_push_api('push-register',payload||'{"version":2}');
 assert(select detached and token is null from private.android_live_push_devices where id=device),'stale registration cannot revive logout';
 payload2:=payload||jsonb_build_object('deviceId',device2,'deviceSecret',repeat('b',64),'version',1,'user_id',other_person,'session_id',other_sid,'token','other-synthetic-token-0000000000');
 perform public.customer_android_live_push_api('push-register',payload2);
 perform public.customer_android_live_push_api('push-register',payload||'{"version":5}');
 delete from auth.sessions where id=sid;
 assert(select detached and token is null and session_id is null from private.android_live_push_devices where id=device),'session revocation retires registration';
 assert(select not detached and token is not null from private.android_live_push_devices where id=device2),'other account session unaffected';
 -- Delete only this transaction's synthetic device, not an account. Minimal replay marker contains no owner/token.
 delete from private.android_live_push_devices where id=device;
 assert exists(select 1 from private.android_live_push_closed where device_hash=extensions.digest(device::text,'sha256')),'deleted installation retains minimal replay fence';
 denied:=false;begin perform public.customer_android_live_push_api('push-register',payload||'{"version":6,"user_id":null,"session_id":null}');exception when others then denied:=sqlerrm='DEVICE_REQUIRED';end;assert denied,'closed installation cannot revive';
 assert (select not active from cron.job where jobname='customer-android-live-push-dispatch'),'Android cron remains inactive';
 assert before_apns=(select count(*)from private.customer_push_deliveries),'APNs delivery queue untouched';
 if before_test is not null then
 assert before_test=jsonb_build_array((select count(*)from private.customer_android_push_devices),(select count(*)from private.customer_android_push_deliveries),(select md5(to_jsonb(r)::text)from private.customer_android_push_runtime r)),'two-device Test experiment untouched';
 end if;
end$checks$;
select pass('44 Android Live registry and queue assertions passed');
select * from finish();
rollback;
