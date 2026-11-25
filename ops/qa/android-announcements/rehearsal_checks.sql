do $checks$
declare
 u uuid:='adab1125-0000-4000-8000-000000000001';s uuid:='adab1125-0000-4000-8000-000000000002';
 a uuid:='adab1125-0000-4000-8000-000000000003';d uuid:='adab1125-0000-4000-8000-000000000004';
 c uuid:='adab1125-0000-4000-8000-000000000005';t uuid:='adab1125-0000-4000-8000-000000000006';
 j uuid:='adab1125-0000-4000-8000-000000000007';other_j uuid:='adab1125-0000-4000-8000-000000000008';
 secret text:=repeat('a',64);token text:='synthetic-android-announcement-token';reply jsonb;lease jsonb;denied boolean;saved_binding text;before_other text;
begin
 assert not(select enabled from qa.android_announcement_runtime),'new general runtime defaults off';
 assert not has_function_privilege('authenticated','qa.android_announcement_acceptance_worker(text,jsonb)','execute'),'private acceptance inaccessible';
 assert not has_table_privilege('service_role','qa.android_announcement_acceptance','select'),'scope not exposed';
 insert into qa.users(id,admin)values(u,false),(a,true);insert into qa.sessions values(s,u);
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values(u,u||'@example.test',now(),'{"role":"customer"}'),(a,a||'@example.test',now(),'{"role":"admin"}');
 insert into auth.sessions(id,user_id)values(s,u);
 insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)values(a,a,'Synthetic rollback QA','totp','verified','synthetic-not-usable',now(),now());
 perform public.customer_account_api('email-ensure',jsonb_build_object('user_id',u,'session_id',s,'name','Synthetic rollback notification QA'));
 assert private.android_live_push_owner(u,s),'deployed real Auth/session helper accepts synthetic customer';
 assert private.announcement_author_allowed(a),'deployed real MFA/author helper accepts synthetic admin';
 insert into qa.android_live_push_runtime(singleton,environment,api_url,project_id,package_name,registration_enabled,delivery_enabled,mode)
 values(true,'production','https://srv1073968.hstgr.cloud','barber-plus-plus-phone-prod','com.barberplusplus.customer',true,false,'capture');
 insert into qa.announcement_runtime(singleton,enabled,mode,api_url)values(true,false,'apns','https://srv1073968.hstgr.cloud');
 insert into qa.android_live_push_devices(id,secret_hash,account_id,session_id,token,token_hash,registration_version,registration_hash,permission,language)
 values(d,extensions.digest(secret,'sha256'),u,s,token,extensions.digest(token,'sha256'),1,extensions.digest('fixture','sha256'),true,'en');
 reply:=qa.customer_announcement_api('register',jsonb_build_object('client','android','user_id',u,'session_id',s,'deviceId',d,'deviceSecret',secret,'version',1,'initializeDefaults',true));
 assert reply->>'enabled'='true','register initializes preferences';saved_binding:=reply->>'recipientBinding';
 assert saved_binding~'^[0-9a-f]{64}$','frozen recipient binding';
 reply:=qa.customer_announcement_api('preference',jsonb_build_object('client','android','user_id',u,'session_id',s,'deviceId',d,'deviceSecret',secret,'version',1,'enabled',false));
 perform qa.customer_announcement_api('register',jsonb_build_object('client','android','user_id',u,'session_id',s,'deviceId',d,'deviceSecret',secret,'version',1,'initializeDefaults',true));
 assert not(select enabled from qa.announcement_preferences where account_id=u),'defaults preserve explicit optout';
 update qa.announcement_preferences set enabled=true,enabled_since=clock_timestamp()-interval'1 second'where account_id=u;
 assert qa.customer_announcement_api('status','{}')->>'ios'='true','iOS API delegates unchanged';
 assert(select count(*)=0 from qa.android_announcement_eligible_devices),'global Android sends stay disabled';
 insert into qa.announcement_campaigns(id,created_by,title_en,body_en,destination,filters,state,delivery_mode)values(c,a,'Barber++','Neutral acceptance','book','{}','preview','apns');
 insert into qa.announcement_targets(id,campaign_id,account_id)values(t,c,u);
 insert into qa.android_announcement_deliveries(id,campaign_id,target_id,device_id,registration_version,token_hash,recipient_binding,eligibility_epoch,delivery_mode)
 values(j,c,t,d,1,extensions.digest(token,'sha256'),saved_binding,1,'apns');
 -- Another queued Android job and a pending iOS job must remain byte-for-byte unchanged.
 insert into qa.announcement_campaigns(id,created_by,title_en,body_en,destination,filters,state,delivery_mode)
 values(other_j,a,'Other','Unrelated','book','{}','queued','apns');
 insert into qa.announcement_targets(id,campaign_id,account_id)values(other_j,other_j,u);
 insert into qa.android_announcement_deliveries(id,campaign_id,target_id,device_id,registration_version,token_hash,recipient_binding,eligibility_epoch)
 values(other_j,other_j,other_j,d,1,extensions.digest(token,'sha256'),saved_binding,1);
 insert into qa.announcement_deliveries(id,campaign_id,target_id,device_id,registration_version,token_hash,recipient_binding,eligibility_epoch)
 values(other_j,other_j,other_j,d,1,extensions.digest(token,'sha256'),saved_binding,1);
 select md5(to_jsonb(x)::text)into before_other from qa.android_announcement_deliveries x where id=other_j;
 denied:=false;begin perform qa.admin_push_worker('acceptance-configure',jsonb_build_object('deliveryId',j));exception when others then denied:=sqlerrm='FORBIDDEN';end;assert denied,'operator role required';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform qa.admin_push_worker('acceptance-configure',jsonb_build_object('deliveryId',j));
 assert qa.android_announcement_acceptance_allowed(j),'exact frozen installation eligible with general sends off';
 update qa.android_announcement_acceptance set expires_at=clock_timestamp()-interval'1 second';
 assert qa.admin_push_worker('acceptance-claim','{}')='[]','expired acceptance cannot claim';
 perform qa.admin_push_worker('acceptance-configure',jsonb_build_object('deliveryId',j));
 update qa.android_announcement_deliveries set registration_version=2 where id=j;
 assert not qa.android_announcement_acceptance_allowed(j),'stale registration snapshot rejected';
 update qa.android_announcement_deliveries set registration_version=1 where id=j;
 update qa.android_announcement_devices set binding=repeat('b',64)where device_id=d;
 assert not qa.android_announcement_acceptance_allowed(j),'changed account capability rejected';
 update qa.android_announcement_devices set binding=saved_binding where device_id=d;
 update qa.android_live_push_devices set permission=false where id=d;
 assert not qa.android_announcement_acceptance_allowed(j),'permission change blocks';
 assert qa.admin_push_worker('acceptance-claim','{}')='[]','ineligible cannot lease';
 update qa.android_live_push_devices set permission=true where id=d;
 assert not qa.android_announcement_acceptance_allowed(j),'epoch prevents silent resurrection';
 update qa.android_announcement_deliveries set eligibility_epoch=(select eligibility_epoch from qa.android_announcement_devices where device_id=d)where id=j;
 update auth.users set banned_until=clock_timestamp()+interval'1 day'where id=u;assert not qa.android_announcement_acceptance_allowed(j),'deployed account guard blocks suspended account';update auth.users set banned_until=null where id=u;
 update qa.announcement_preferences set enabled=false where account_id=u;assert not qa.android_announcement_acceptance_allowed(j),'announcement optout blocks';update qa.announcement_preferences set enabled=true where account_id=u;
 update qa.android_live_push_runtime set delivery_enabled=true;assert not qa.android_announcement_acceptance_allowed(j),'general delivery activation invalidates acceptance';update qa.android_live_push_runtime set delivery_enabled=false;
 lease:=qa.admin_push_worker('acceptance-claim','{}')->0;
 assert lease->>'id'=j::text and lease->>'client'='android','one exact Android lease';
 assert qa.admin_push_worker('acceptance-claim','{}')='[]','second claim cannot replay';
 assert qa.admin_push_worker('acceptance-validate',lease)='true','live scope validates';
 assert qa.admin_push_worker('acceptance-validate',lease||jsonb_build_object('lease',other_j))='false','foreign lease rejected';
 perform qa.admin_push_worker('acceptance-finish',lease||'{"status":503,"reason":"SyntheticUnavailable"}');
 assert(select state='failed'and attempts=1 from qa.android_announcement_deliveries where id=j),'even retryable provider status terminal';
 assert qa.admin_push_worker('acceptance-claim','{}')='[]','no automatic retry';
 assert qa.admin_push_worker('acceptance-finish',lease||'{"status":200}')='false','late acknowledgment cannot rewrite';
 denied:=false;begin perform qa.admin_push_worker('acceptance-configure',jsonb_build_object('deliveryId',j));exception when others then denied:=sqlerrm='ACCEPTANCE_SCOPE_INVALID';end;assert denied,'consumed attempt cannot be rearmed';
 assert(select n=0 from qa.delegations),'no iOS/general worker calls';
 assert(select md5(to_jsonb(x)::text)=before_other from qa.android_announcement_deliveries x where id=other_j),'other Android queue unchanged';
 assert(select state='pending'and attempts=0 from qa.announcement_deliveries where id=other_j),'iOS pending job unchanged';
 assert not(select delivery_enabled from qa.android_live_push_runtime)and not(select enabled from qa.android_announcement_runtime),'general flags unchanged';
end $checks$;
select 'PASS: isolated migration and single-installation acceptance checks' as result;
