begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(1);
create function pg_temp.defaults_assert(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'DEFAULTS_ASSERT: %',label;end if;end$$;
do $tests$
declare uid uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();cid uuid:=gen_random_uuid();device uuid:=gen_random_uuid();guest_device uuid:=gen_random_uuid();client jsonb;got jsonb;chosen jsonb:='{"updates":true,"reminder24":false,"reminder2":true,"reviews":false}';all_on jsonb:='{"updates":true,"reminder24":true,"reminder2":true,"reviews":true}';
begin
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)values(uid,uid::text||'@example.test',now(),'{"role":"customer"}','{}');
 insert into auth.sessions(id,user_id)values(sid,uid);
 insert into public.customers(id,name,email,created_by_type)values(cid,'Notification defaults SQL QA',uid::text||'@example.test','customer');
 insert into private.customer_accounts(user_id,customer_id)values(uid,cid);
 client:=jsonb_build_object('user_id',uid,'session_id',sid,'deviceId',device,'deviceSecret',repeat('a',64),'version',1,'token',repeat('b',64),'environment','sandbox','language','en','permission',false);
 got:=public.customer_push_api('push-register',client);
 perform pg_temp.defaults_assert(got->'preferences'=all_on,'fresh signed-in installation defaults all four on');
 insert into private.customer_push_preferences(account_id)values(uid);
 perform pg_temp.defaults_assert((select preferences=all_on from private.customer_push_preferences where account_id=uid),'future account preference rows default all four on');
 if to_regprocedure('public.customer_announcement_api(text,jsonb)') is not null then
  got:=public.customer_announcement_api('status',jsonb_build_object('user_id',uid,'session_id',sid));
  perform pg_temp.defaults_assert(got->'enabled'='false'::jsonb,'announcements remain separate and default off');
 end if;
 got:=public.customer_push_api('push-preferences',client||jsonb_build_object('preferences',chosen,'notificationsEnabled',false));
 got:=public.customer_push_api('push-preferences',client||jsonb_build_object('preferences',chosen,'notificationsEnabled',true));
 perform pg_temp.defaults_assert(got->'preferences'=chosen,'master off/on preserves saved review and reminder opt-outs');
 got:=public.customer_push_api('push-register',client||'{"version":2}');
 perform pg_temp.defaults_assert(got->'preferences'=chosen,'ordinary re-registration preserves saved account choices');
 got:=public.customer_push_api('push-register',(client-array['user_id','session_id'])||jsonb_build_object('deviceId',guest_device,'deviceSecret',repeat('c',64),'token',repeat('d',64)));
 perform pg_temp.defaults_assert(got->'preferences'=all_on,'fresh guest installation defaults all four on');
 got:=public.customer_push_api('push-preferences',(client-array['user_id','session_id'])||jsonb_build_object('deviceId',guest_device,'deviceSecret',repeat('c',64),'preferences',chosen,'notificationsEnabled',false));
 got:=public.customer_push_api('push-preferences',(client-array['user_id','session_id'])||jsonb_build_object('deviceId',guest_device,'deviceSecret',repeat('c',64),'preferences',chosen,'notificationsEnabled',true));
 perform pg_temp.defaults_assert(got->'preferences'=chosen,'guest saved opt-outs survive master off/on');
end $tests$;
select pass('Future booking notification defaults and saved preferences');
select * from finish();
rollback;
