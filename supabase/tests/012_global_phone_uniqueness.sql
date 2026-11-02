begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
select is(private.canonical_phone('٥٩٩٩٨٠٠١','+965'),'+96559998001','Arabic digits normalize to the same international number');
select is(private.canonical_phone('٥٩٩٩٨٠٠١','+٩٦٥'),'+96559998001','Arabic country code digits normalize too');
select throws_ok($$select private.canonical_phone('59998001','invalid')$$,'22023','INVALID_PHONE','invalid country code cannot disguise a local contact');
select is(private.canonical_phone('00965 (5999)-8001'),'+96559998001','international prefix and punctuation normalize');
select is(private.canonical_phone('+966 0501234567'),'+966501234567','domestic trunk prefix cannot bypass uniqueness');
select throws_ok($$select private.canonical_phone('phone:59998001')$$,'22023','INVALID_PHONE','invalid characters are rejected');
select ok(not has_table_privilege('anon','private.phone_numbers','SELECT'),'anonymous users cannot enumerate phone owners');
select ok(not has_table_privilege('authenticated','private.phone_sources','SELECT'),'authenticated users cannot read phone sources');
select ok(not has_table_privilege('service_role','private.phone_numbers','INSERT'),'application service cannot bypass ownership through the private registry');
select ok(not has_function_privilege('authenticated','private.sync_phone_record(text,uuid,jsonb)','EXECUTE'),'users cannot forge phone source claims');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
('aa990000-0000-4000-8000-000000000101','phone-admin@customer.test',now(),'{"role":"admin"}','{"phone":"+965 59998001"}'),
('aa990000-0000-4000-8000-000000000102','phone-manager@customer.test',now(),'{"role":"manager"}','{"phone":"+96559998002"}'),
('aa990000-0000-4000-8000-000000000103','phone-barber@customer.test',now(),'{"role":"barber"}','{"phone":"+96559998003"}'),
('aa990000-0000-4000-8000-000000000104','phone-customer@customer.test',now(),'{"role":"customer"}','{"name":"Phone Customer"}'),
('aa990000-0000-4000-8000-000000000105','phone-other@customer.test',now(),'{"role":"customer"}','{"name":"Other Customer"}');
insert into auth.sessions(id,user_id,created_at,updated_at) values
('aa990000-0000-4000-8000-000000000204','aa990000-0000-4000-8000-000000000104',now(),now()),
('aa990000-0000-4000-8000-000000000205','aa990000-0000-4000-8000-000000000105',now(),now());
select set_config('phone.customer','{"user_id":"aa990000-0000-4000-8000-000000000104","session_id":"aa990000-0000-4000-8000-000000000204","name":"Phone Customer"}',true);
select set_config('phone.other','{"user_id":"aa990000-0000-4000-8000-000000000105","session_id":"aa990000-0000-4000-8000-000000000205","name":"Other Customer"}',true);
select public.customer_account_api('email-ensure',current_setting('phone.customer')::jsonb);
select public.customer_account_api('email-ensure',current_setting('phone.other')::jsonb);
insert into public.branches(id,manager_id,name,country_code,phone) values('aa990000-0000-4000-8000-000000000301','aa990000-0000-4000-8000-000000000102','Phone Test Shop','+965','59998004');
insert into public.customers(id,name,country_code,phone) values('aa990000-0000-4000-8000-000000000401','Phone Guest','+965','59998005');
select throws_ok($$select public.customer_account_api('update-profile',current_setting('phone.customer')::jsonb||'{"phone":"59998005","country_code":"+965"}')$$,'23505','PHONE_IN_USE','unverified phone match cannot claim an existing guest profile');
select public.customer_account_api('update-profile',current_setting('phone.customer')::jsonb||'{"phone":"59998015","country_code":"+965"}');
select is(public.customer_account_api('bookings',current_setting('phone.customer')::jsonb),'[]'::jsonb,'phone match never grants appointment ownership');
select throws_ok($$select public.customer_account_api('update-profile',current_setting('phone.other')::jsonb||'{"phone":"59998005","country_code":"+965"}')$$,'23505','PHONE_IN_USE','a second customer account cannot share the number');
select throws_ok($$select public.customer_account_api('update-profile',current_setting('phone.customer')::jsonb||'{"phone":"59998001","country_code":"+965"}')$$,'23505','PHONE_IN_USE','admin number cannot be used by customer');
select throws_ok($$select public.customer_account_api('update-profile',current_setting('phone.customer')::jsonb||'{"phone":"59998002","country_code":"+965"}')$$,'23505','PHONE_IN_USE','manager number cannot be used by customer');
select throws_ok($$select public.customer_account_api('update-profile',current_setting('phone.customer')::jsonb||'{"phone":"59998003","country_code":"+965"}')$$,'23505','PHONE_IN_USE','barber number cannot be used by customer');
select throws_ok($$select public.customer_account_api('update-profile',current_setting('phone.customer')::jsonb||'{"phone":"59998004","country_code":"+965"}')$$,'23505','PHONE_IN_USE','shop number cannot be used by customer');
select is(public.customer_account_api('profile',current_setting('phone.customer')::jsonb)->>'phone','59998015','failed duplicate update preserves the original profile');
select throws_ok($$update auth.users set raw_user_meta_data=raw_user_meta_data||'{"phone":"+965 59998005"}' where id='aa990000-0000-4000-8000-000000000101'$$,'23505','PHONE_IN_USE','admin cannot take a customer number');
select throws_ok($$update public.branches set phone='59998002' where id='aa990000-0000-4000-8000-000000000301'$$,'23505','PHONE_IN_USE','shop cannot share its manager number');
select throws_ok($$insert into public.customers(name,country_code,phone) values('Duplicate formatting','+965','00965 (5999)-8005')$$,'23505',null,'formatting cannot create another business customer');
select lives_ok($$insert into public.customers(name,country_code,phone) values('Same booking contact','+965','00965 (5999)-8005') on conflict(country_code,phone) do update set name=excluded.name$$,'formatted booking contact reuses the existing customer instead of creating a duplicate');
select is((select count(*) from public.customers where country_code='+965' and phone='59998005'),1::bigint,'formatted upsert retains one customer record');
select is((select count(*) from information_schema.columns where table_schema='private' and table_name='customer_accounts' and column_name in ('name','phone','phone_e164','email','country_code')),0::bigint,'account links contain no repeated contact fields');
select is((select phone_e164 from private.customer_account_profiles where user_id='aa990000-0000-4000-8000-000000000104'),'+96559998015','international phone is derived from the canonical customer');
insert into public.barbers(id,branch_id,user_id,name,country_code,phone) values('aa990000-0000-4000-8000-000000000501','aa990000-0000-4000-8000-000000000301','aa990000-0000-4000-8000-000000000103','Phone Test Barber','+965','59998003');
select is((select count(*) from private.phone_sources where phone='+96559998003'),2::bigint,'barber login and linked barber record share one identity');
select throws_ok($$update public.barbers set phone='59998001' where id='aa990000-0000-4000-8000-000000000501'$$,'23505','PHONE_IN_USE','barber cannot use admin number');
select throws_ok($$update public.barbers set user_id='aa990000-0000-4000-8000-000000000102' where id='aa990000-0000-4000-8000-000000000501'$$,'P0001','INVALID_BARBER_ACCOUNT','manager cannot be disguised as a linked barber identity');
select lives_ok($$update auth.users set phone='96559998003' where id='aa990000-0000-4000-8000-000000000103'$$,'native Auth phone is covered without conflicting with the same staff identity');
select throws_ok($$update auth.users set phone='96559998005' where id='aa990000-0000-4000-8000-000000000103'$$,'23505','PHONE_IN_USE','native Auth phone cannot take customer contact');
update auth.users set deleted_at=now() where id='aa990000-0000-4000-8000-000000000103';
select lives_ok($$update public.barbers set user_id=null where id='aa990000-0000-4000-8000-000000000501'$$,'invite reset can release the deleted login while retaining the barber number');
select throws_ok($$update public.branches set phone='59998003' where id='aa990000-0000-4000-8000-000000000301'$$,'23505','PHONE_IN_USE','deleting a login does not free the remaining barber record number');
select lives_ok($$insert into public.customers(name,country_code,phone) values('Different country','+973','59998005')$$,'same national digits in another country are a distinct international number');
update public.branches set phone='59998006' where id='aa990000-0000-4000-8000-000000000301';
select lives_ok($$update auth.users set raw_user_meta_data=raw_user_meta_data||'{"phone":"+96559998004"}' where id='aa990000-0000-4000-8000-000000000102'$$,'a fully released number can be claimed elsewhere');
select throws_ok($$insert into public.barbers(branch_id,name,country_code,phone) values('aa990000-0000-4000-8000-000000000301','Unlinked duplicate','+965','59998006')$$,'23505','PHONE_IN_USE','unlinked barber also cannot reuse shop contact');
insert into auth.users(id,email,raw_app_meta_data) values('aa990000-0000-4000-8000-000000000106','phone-invited@customer.test','{"role":"barber"}');
select lives_ok($$update public.barbers set user_id='aa990000-0000-4000-8000-000000000106' where id='aa990000-0000-4000-8000-000000000501'$$,'invitation links an existing unassigned barber without losing its phone claim');
select is((select owner_key from private.phone_numbers where phone='+96559998003'),'user:aa990000-0000-4000-8000-000000000106','linked invitation transfers the number to the trusted barber identity');
select * from finish();
rollback;
