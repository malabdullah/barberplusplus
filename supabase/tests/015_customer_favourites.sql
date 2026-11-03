begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='private.customer_favourites'::regclass),'favourite storage has RLS');
select ok(not has_table_privilege('authenticated','private.customer_favourites','SELECT'),'customers cannot read raw favourite rows');
select ok(not has_table_privilege('service_role','private.customer_favourites','INSERT'),'gateway cannot bypass the validated API');
select ok(not has_function_privilege('anon','public.customer_favourites_api(text,jsonb)','EXECUTE'),'anonymous direct RPC denied');
select ok(not has_function_privilege('authenticated','public.customer_favourites_api(text,jsonb)','EXECUTE'),'staff and customers cannot forge gateway identity');
select ok(has_function_privilege('service_role','public.customer_favourites_api(text,jsonb)','EXECUTE'),'gateway can call the scoped API');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('af920000-0000-4000-8000-000000000101','favourite-one@example.test',now(),'{"role":"customer"}'),
('af920000-0000-4000-8000-000000000102','favourite-two@example.test',now(),'{"role":"customer"}'),
('af920000-0000-4000-8000-000000000103','favourite-manager@example.test',now(),'{"role":"manager"}');
insert into auth.sessions(id,user_id) values
('af920000-0000-4000-8000-000000000201','af920000-0000-4000-8000-000000000101'),
('af920000-0000-4000-8000-000000000202','af920000-0000-4000-8000-000000000102'),
('af920000-0000-4000-8000-000000000203','af920000-0000-4000-8000-000000000103');
select set_config('fav.one','{"user_id":"af920000-0000-4000-8000-000000000101","session_id":"af920000-0000-4000-8000-000000000201","name":"Favourite One"}',true);
select set_config('fav.two','{"user_id":"af920000-0000-4000-8000-000000000102","session_id":"af920000-0000-4000-8000-000000000202","name":"Favourite Two"}',true);
select public.customer_account_api('email-ensure',current_setting('fav.one')::jsonb);
select public.customer_account_api('email-ensure',current_setting('fav.two')::jsonb);
insert into public.branches(id,manager_id,name,city,status) values ('af920000-0000-4000-8000-000000000301','af920000-0000-4000-8000-000000000103','Favourite Shop','Salmiya','active'),('af920000-0000-4000-8000-000000000302','af920000-0000-4000-8000-000000000103','New Shop','Hawally','active');
insert into public.services(id,branch_id,name,duration,price,status) values('af920000-0000-4000-8000-000000000401','af920000-0000-4000-8000-000000000301','Haircut',30,5,'active');
insert into public.barbers(id,branch_id,name,status,service_ids) values('af920000-0000-4000-8000-000000000501','af920000-0000-4000-8000-000000000301','Favourite Barber','active',array['af920000-0000-4000-8000-000000000401']::uuid[]);
select set_config('fav.shop','{"kind":"shop","target_id":"af920000-0000-4000-8000-000000000301"}',true);
select set_config('fav.barber','{"kind":"barber","target_id":"af920000-0000-4000-8000-000000000501"}',true);
select is(jsonb_array_length(public.customer_favourites_api('favourites-save',current_setting('fav.one')::jsonb||current_setting('fav.shop')::jsonb)),1,'save shop');
select is(jsonb_array_length(public.customer_favourites_api('favourites-save',current_setting('fav.one')::jsonb||current_setting('fav.shop')::jsonb)),1,'repeated save is idempotent');
select is(jsonb_array_length(public.customer_favourites_api('favourites-save',current_setting('fav.one')::jsonb||current_setting('fav.barber')::jsonb)),2,'save barber alongside shop');
select is(public.customer_favourites_api('favourites-list',current_setting('fav.two')::jsonb),'[]'::jsonb,'another customer sees none');
select is(jsonb_array_length(public.customer_favourites_api('favourites-remove',current_setting('fav.two')::jsonb||current_setting('fav.shop')::jsonb)),0,'another customer cannot remove owner favourite');
select is(jsonb_array_length(public.customer_favourites_api('favourites-list',current_setting('fav.one')::jsonb)),2,'original customer keeps both');
select throws_ok($$select public.customer_favourites_api('favourites-list',current_setting('fav.one')::jsonb||'{"session_id":"af920000-0000-4000-8000-000000000202"}')$$,'P0001','AUTH_REQUIRED','session must belong to account');
select throws_ok($$select public.customer_favourites_api('favourites-list','{"user_id":"af920000-0000-4000-8000-000000000103","session_id":"af920000-0000-4000-8000-000000000203"}')$$,'P0001','AUTH_REQUIRED','manager cannot use customer favourites');
update public.barbers set name='Updated Barber',branch_id='af920000-0000-4000-8000-000000000302' where id='af920000-0000-4000-8000-000000000501';
select is((select i->>'name' from jsonb_array_elements(public.customer_favourites_api('favourites-list',current_setting('fav.one')::jsonb)) i where i->>'kind'='barber'),'Updated Barber','current name is referenced without a duplicate');
select is((select i->>'locationChanged' from jsonb_array_elements(public.customer_favourites_api('favourites-list',current_setting('fav.one')::jsonb)) i where i->>'kind'='barber'),'true','moving barber requires location review');
update public.barbers set status='inactive' where id='af920000-0000-4000-8000-000000000501';
select is((select i->>'available' from jsonb_array_elements(public.customer_favourites_api('favourites-list',current_setting('fav.one')::jsonb)) i where i->>'kind'='barber'),'false','unavailable favourite remains visible');
select throws_ok($$select public.customer_favourites_api('favourites-save',current_setting('fav.two')::jsonb||current_setting('fav.barber')::jsonb)$$,'P0001','FAVOURITE_UNAVAILABLE','cannot save inactive barber');
select is(jsonb_array_length(public.customer_favourites_api('favourites-remove',current_setting('fav.one')::jsonb||current_setting('fav.barber')::jsonb)),1,'unavailable favourite can be removed');
delete from auth.sessions where id='af920000-0000-4000-8000-000000000201';
select throws_ok($$select public.customer_favourites_api('favourites-list',current_setting('fav.one')::jsonb)$$,'P0001','AUTH_REQUIRED','revoked sessions cannot access favourites');
select * from finish();
rollback;
