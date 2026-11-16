begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(1);
set local statement_timeout='45s';
create temp table share_checks(label text);
create function pg_temp.share_assert(value boolean,label text)returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'SHARE_ASSERT: %',label;end if;
 insert into share_checks values(label);
end$$;
do $tests$
#variable_conflict use_variable
declare
 uid uuid:=gen_random_uuid();other_uid uuid:=gen_random_uuid();manager uuid:=gen_random_uuid();
 sid uuid:=gen_random_uuid();other_sid uuid:=gen_random_uuid();cid uuid:=gen_random_uuid();other_cid uuid:=gen_random_uuid();guest_cid uuid:=gen_random_uuid();
 bid uuid:=gen_random_uuid();guest_bid uuid:=gen_random_uuid();past_bid uuid:=gen_random_uuid();future_bid uuid:=gen_random_uuid();
 shop uuid:=gen_random_uuid();barber uuid:=gen_random_uuid();svc uuid:=gen_random_uuid();svc2 uuid:=gen_random_uuid();job uuid:=gen_random_uuid();
 identity jsonb;got jsonb;viewed jsonb;receipt jsonb;scope jsonb;preview jsonb;payload jsonb;lease jsonb;
 token text;guest_token text;past_token text;future_token text;denied boolean;legacy text:=repeat('a',64);revoked text:=repeat('b',64);
 past_start timestamp:=(clock_timestamp()at time zone'Asia/Kuwait')-interval'1 hour';
 future_start timestamp:=(clock_timestamp()at time zone'Asia/Kuwait')+interval'1 hour';
begin
 perform pg_temp.share_assert(not has_function_privilege('anon','public.customer_booking_share(text,jsonb)','execute')and not has_function_privilege('authenticated','public.customer_booking_share(text,jsonb)','execute'),'no browser RPC bypass');
 perform pg_temp.share_assert(has_function_privilege('service_role','public.customer_booking_share(text,jsonb)','execute'),'gateway RPC permitted');
 perform pg_temp.share_assert((select relrowsecurity from pg_class where oid='private.booking_public_links'::regclass)and(select relrowsecurity from pg_class where oid='private.booking_share_aliases'::regclass),'both stores have RLS');
 perform pg_temp.share_assert(not has_table_privilege('anon','private.booking_public_links','select')and not has_table_privilege('authenticated','private.booking_share_aliases','select')and not has_table_privilege('service_role','private.booking_public_links','select'),'no direct capability enumeration');
 perform pg_temp.share_assert(not has_function_privilege('authenticated','private.booking_share_live(uuid)','execute'),'private live builder inaccessible');
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values
 (uid,uid||'@example.test',now(),'{"role":"customer","deletion_qa":true}'),
 (other_uid,other_uid||'@example.test',now(),'{"role":"customer","deletion_qa":true}'),(manager,manager||'@example.test',now(),'{"role":"manager","deletion_qa":true}');
 insert into auth.sessions(id,user_id)values(sid,uid),(other_sid,other_uid);
 insert into public.customers(id,name,email)values(cid,'PRIVATE owner',uid||'@example.test'),(other_cid,'PRIVATE other',other_uid||'@example.test'),(guest_cid,'PRIVATE guest',uid||'@example.test');
 insert into private.customer_accounts(user_id,customer_id)values(uid,cid),(other_uid,other_cid);
 insert into public.branches(id,manager_id,name,name_ar,address,status)values(shop,manager,'Share fixture shop','صالون تجريبي','Fixture address','active');
 insert into public.services(id,branch_id,name,name_ar,duration,price)values(svc,shop,'Purchased cut','قص الشعر',30,10),(svc2,shop,'Changed cut','خدمة جديدة',30,12);
 insert into public.barbers(id,branch_id,name,name_ar,status,service_ids)values(barber,shop,'Share fixture barber','حلاق تجريبي','active',array[svc]);
 insert into public.bookings(id,customer_id,branch_id,barber_id,service_ids,date,time,duration,price,status,notes,added_by_type,service_snapshot)values
 (bid,cid,shop,barber,array[svc],current_date+20,'23:00',30,10,'cancelled','PRIVATE NOTE','customer','[{"name":"Purchased cut","name_ar":"قص الشعر","quantity":2,"private":"PRIVATE"}]'),
 (guest_bid,guest_cid,shop,barber,array[svc],current_date+21,'23:00',30,10,'cancelled','PRIVATE NOTE','customer','[{"name":"Guest cut"}]'),
 (past_bid,cid,shop,barber,array[svc],past_start::date,past_start::time,30,10,'confirmed','PRIVATE NOTE','customer','[{"name":"Past cut"}]'),
 (future_bid,cid,shop,barber,array[svc],future_start::date,future_start::time,30,10,'pending','PRIVATE NOTE','customer','[{"name":"Future cut"}]');
 insert into private.customer_booking_owners(booking_id,account_user_id)values(bid,uid),(past_bid,uid),(future_bid,uid);
 insert into private.customer_booking_email_context(booking_id,customer_id,guest,language)values(guest_bid,guest_cid,true,'en');
 identity:=jsonb_build_object('user_id',uid,'session_id',sid,'booking_id',bid);
 got:=public.customer_booking_share('create',identity);token:=got->>'publicId';
 select public_id into guest_token from private.booking_public_links where booking_id=guest_bid;
 select public_id into past_token from private.booking_public_links where booking_id=past_bid;
 select public_id into future_token from private.booking_public_links where booking_id=future_bid;
 perform pg_temp.share_assert(token~'^[0-9a-f]{64}$'and got->>'permanent'='true'and got->>'sharingVersion'='2','new bookings automatically provision a permanent random identity');
 perform pg_temp.share_assert((select count(*)from private.booking_public_links where booking_id=any(array[bid,guest_bid,past_bid,future_bid]))=4,'all creation paths provision exactly once');
 perform pg_temp.share_assert(public.customer_booking_share('create',identity)=got,'repeated lookup reuses exact identity');
 perform pg_temp.share_assert(not exists(select 1 from private.customer_booking_share_versions where booking_id=bid),'sharing creates no snapshot');
 payload:=jsonb_build_object('token',token,'hash',encode(extensions.digest(token,'sha256'),'hex'));
 viewed:=public.customer_booking_share('view',payload);
 perform pg_temp.share_assert(viewed->>'status'='cancelled'and viewed->'services'->0->>'name'='Purchased cut'and coalesce((viewed->'services'->0->>'quantity')::integer,1)=1,'live status and booked service quantities');
 perform pg_temp.share_assert(not(viewed ?| array['id','booking_id','customer_id','email','phone','notes','user_id','session_id','token','nonce','hash','expiresAt']),'public field whitelist');
 perform pg_temp.share_assert(viewed::text not like '%PRIVATE%'and viewed::text not like '%example.test%'and viewed::text not like '%'||uid||'%','no nested PII or account IDs');
 denied:=false;begin perform public.customer_booking_share('create',identity||jsonb_build_object('user_id',other_uid,'session_id',other_sid));exception when others then denied:=sqlerrm='LINK_UNAVAILABLE';end;perform pg_temp.share_assert(denied,'wrong owner denied');
 denied:=false;begin perform public.customer_booking_share('create',identity||jsonb_build_object('session_id',other_sid));exception when others then denied:=sqlerrm='AUTH_REQUIRED';end;perform pg_temp.share_assert(denied,'wrong session denied');
 denied:=false;begin perform public.customer_booking_share('create',jsonb_build_object('booking_id',bid,'email',uid||'@example.test'));exception when others then denied:=sqlerrm='LINK_UNAVAILABLE';end;perform pg_temp.share_assert(denied,'email alone never grants lookup');
 denied:=false;begin perform public.customer_booking_share('view',jsonb_build_object('token',replace(bid::text,'-',''),'hash',repeat('1',64)));exception when others then denied:=sqlerrm='LINK_UNAVAILABLE';end;perform pg_temp.share_assert(denied,'internal booking ID is not a public capability');
 update public.bookings set time='23:15',date=current_date-10,price=12,service_ids=array[svc2]where id=bid;
 update public.branches set name='Changed shop',address='Changed address',location_url='https://maps.example.test/new'where id=shop;
 update public.barbers set name='Changed barber'where id=barber;
 viewed:=public.customer_booking_share('view',payload);
 perform pg_temp.share_assert(viewed->>'time'='23:15'and(viewed->>'date')::date=current_date-10 and (viewed->>'price')::numeric=12,'reschedule and price read live even in distant past');
 perform pg_temp.share_assert(viewed->>'shop'='Changed shop'and viewed->>'barber'='Changed barber'and viewed->>'address'='Changed address','shop barber and location read live');
 perform pg_temp.share_assert(viewed->'services'->0->>'name'='Changed cut'and viewed->'package'='null'::jsonb and viewed::text not like '%PRIVATE%','changed services and no package projected without private extras');
 perform pg_temp.share_assert(public.customer_booking_share('create',identity)=got,'past booking is shareable with same identity');
 denied:=false;begin perform public.customer_booking_share('revoke',identity);exception when others then denied:=sqlerrm='PERMANENT_LINK';end;perform pg_temp.share_assert(denied,'removed management API does not falsely report revocation');
 insert into private.customer_booking_share_versions(booking_id,id,nonce,token_hash,customer_id,account_user_id,snapshot,expires_at,snapshot_at)values
 (bid,gen_random_uuid(),gen_random_uuid(),encode(extensions.digest(legacy,'sha256'),'hex'),cid,uid,'{"shop":"OBSOLETE SNAPSHOT"}',now()-interval'1 day',now());
 perform pg_temp.share_assert(public.customer_booking_share('view',jsonb_build_object('hash',encode(extensions.digest(legacy,'sha256'),'hex'),'token',legacy))=viewed,'expired unrevoked legacy URL resolves live rather than snapshot');
 insert into private.customer_booking_share_versions(booking_id,id,nonce,token_hash,customer_id,account_user_id,snapshot,expires_at,snapshot_at,revoked_at)values
 (bid,gen_random_uuid(),gen_random_uuid(),encode(extensions.digest(revoked,'sha256'),'hex'),cid,uid,'{}',now()+interval'1 day',now(),now());
 denied:=false;begin perform public.customer_booking_share('view',jsonb_build_object('token',revoked,'hash',encode(extensions.digest(revoked,'sha256'),'hex')));exception when others then denied:=sqlerrm='LINK_UNAVAILABLE';end;perform pg_temp.share_assert(denied,'explicitly revoked legacy alias remains unavailable');
 denied:=false;begin update private.booking_public_links set public_id=revoked where booking_id=bid;exception when others then denied:=sqlerrm='PUBLIC_LINK_IMMUTABLE';end;perform pg_temp.share_assert(denied,'canonical identity immutable');
 denied:=false;begin insert into private.booking_share_aliases(token_hash,booking_id)values(encode(extensions.digest(token,'sha256'),'hex'),bid);exception when others then denied:=sqlerrm='SHARE_TOKEN_COLLISION';end;perform pg_temp.share_assert(denied,'alias cannot shadow canonical identity');
 receipt:=jsonb_build_object('id',guest_bid,'guest_contact','email','email',uid||'@example.test','phone','','country_code','+965');
 perform pg_temp.share_assert(public.customer_booking_share('create',jsonb_build_object('booking_id',guest_bid,'receipt',receipt))->>'publicId'=guest_token,'gateway-verified guest receipt lookup');
 denied:=false;begin perform public.customer_booking_share('create',jsonb_build_object('booking_id',guest_bid,'receipt',receipt||'{"email":"wrong@example.test"}'));exception when others then denied:=sqlerrm='LINK_UNAVAILABLE';end;perform pg_temp.share_assert(denied,'wrong receipt contact denied');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.customer_claim_booking(guest_bid,uid,sid);
 perform pg_temp.share_assert(public.customer_booking_share('view',jsonb_build_object('token',guest_token,'hash',encode(extensions.digest(guest_token,'sha256'),'hex')))->>'status'='cancelled','guest link survives claim');
 denied:=false;begin perform public.customer_booking_share('create',jsonb_build_object('booking_id',guest_bid,'receipt',receipt));exception when others then denied:=sqlerrm='LINK_UNAVAILABLE';end;perform pg_temp.share_assert(denied,'guest proof cannot privately look up claimed booking');
 perform pg_temp.share_assert(public.customer_booking_share('create',identity||jsonb_build_object('booking_id',guest_bid))->>'publicId'=guest_token,'claimed booking owner gets original canonical identity');
 update private.customer_deletion_runtime set deployment_environment='cloud-test',test_mode=true,function_url='https://qvkucvcjmojjbphlzlks.supabase.co/functions/v1/customer-account-deletion',allowed_test_users=array[uid]where singleton;
 scope:=jsonb_build_object('id',job,'user_id',uid,'session_id',sid,'receipt_hash',repeat('c',64),'receipt_box','synthetic-only','code_hash',repeat('d',64));
 preview:=public.customer_deletion_service('preview',scope);
 perform public.customer_deletion_service('start',scope);perform public.customer_deletion_service('verify',scope);
 got:=public.customer_deletion_service('confirm',scope||jsonb_build_object('digest',preview->>'digest','confirmCancellation',true));
 perform pg_temp.share_assert(got->>'state'='cleanup_pending','real deletion application routine reaches cleanup');
 perform pg_temp.share_assert((select status='confirmed'from public.bookings where id=past_bid),'already-started appointment keeps status based on Kuwait timestamp');
 perform pg_temp.share_assert((select status='cancelled'from public.bookings where id=future_bid),'future appointment cancelled based on Kuwait start timestamp');
 perform pg_temp.share_assert(public.customer_booking_share('view',payload)->>'shop'='Changed shop','canonical URL survives customer anonymization and owner removal');
 perform pg_temp.share_assert(public.customer_booking_share('view',jsonb_build_object('token',legacy,'hash',encode(extensions.digest(legacy,'sha256'),'hex')))->>'shop'='Changed shop','legacy alias survives old snapshot PII deletion');
 perform pg_temp.share_assert(not exists(select 1 from private.customer_booking_share_versions where booking_id=bid)and exists(select 1 from private.booking_share_aliases where booking_id=bid),'only minimal alias remains after PII cleanup');
 perform pg_temp.share_assert((select name='Deleted customer'and email is null and phone is null and status='inactive'from public.customers where id=cid),'customer PII actually removed');
 perform pg_temp.share_assert(not exists(select 1 from auth.sessions where user_id=uid)and not exists(select 1 from public.bookings where customer_id=cid and notes is not null),'sessions and notes cleaned');
 denied:=false;begin perform public.customer_booking_share('create',identity);exception when others then denied:=sqlerrm='AUTH_REQUIRED';end;perform pg_temp.share_assert(denied,'deleted account cannot privately recover URL');
 lease:=public.customer_deletion_service('claim',jsonb_build_object('id',job));
 delete from auth.users where id=uid;
 perform pg_temp.share_assert(public.customer_deletion_service('finish',lease)='true'::jsonb,'synthetic Auth cleanup completes');
 perform pg_temp.share_assert(public.customer_booking_share('view',payload)->>'status'='cancelled','public URL independent of deleted Auth identity');
 delete from public.bookings where id=bid;
 perform pg_temp.share_assert(not exists(select 1 from private.booking_public_links where booking_id=bid)and not exists(select 1 from private.booking_share_aliases where booking_id=bid),'actual booking deletion removes canonical mapping and aliases');
 denied:=false;begin perform public.customer_booking_share('view',payload);exception when others then denied:=sqlerrm='LINK_UNAVAILABLE';end;perform pg_temp.share_assert(denied,'actually removed booking gives generic unavailable');
end$tests$;
select pass('Permanent live links: '||(select count(*)from share_checks)||' policy, ownership, privacy, legacy, claim and deletion checks');
select *from finish();
rollback;
