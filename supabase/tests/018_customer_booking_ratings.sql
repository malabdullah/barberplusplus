begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(10);

select ok(not has_table_privilege('authenticated','private.customer_booking_ratings','SELECT'),'ratings are private');
select ok(not has_function_privilege('authenticated','public.customer_account_api(text,jsonb)','EXECUTE'),'only the gateway can submit an identity');

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('dc060000-0000-4000-8000-000000000101','rating-one@example.test',now(),'{"role":"customer"}'),
('dc060000-0000-4000-8000-000000000102','rating-two@example.test',now(),'{"role":"customer"}'),
('dc060000-0000-4000-8000-000000000103','rating-manager@example.test',now(),'{"role":"manager"}');
insert into auth.sessions(id,user_id) values
('dc060000-0000-4000-8000-000000000201','dc060000-0000-4000-8000-000000000101'),
('dc060000-0000-4000-8000-000000000202','dc060000-0000-4000-8000-000000000102');
select set_config('rating.one','{"user_id":"dc060000-0000-4000-8000-000000000101","session_id":"dc060000-0000-4000-8000-000000000201","name":"Rating One"}',true);
select set_config('rating.two','{"user_id":"dc060000-0000-4000-8000-000000000102","session_id":"dc060000-0000-4000-8000-000000000202","name":"Rating Two"}',true);
select public.customer_account_api('email-ensure',current_setting('rating.one')::jsonb);
select public.customer_account_api('email-ensure',current_setting('rating.two')::jsonb);
insert into public.branches(id,manager_id,name,status) values
('dc060000-0000-4000-8000-000000000301','dc060000-0000-4000-8000-000000000103','Rating Shop','active');
insert into public.barbers(id,branch_id,name,status) values
('dc060000-0000-4000-8000-000000000401','dc060000-0000-4000-8000-000000000301','Rating Barber','active');
insert into public.bookings(id,branch_id,barber_id,date,time,status) values
('dc060000-0000-4000-8000-000000000501','dc060000-0000-4000-8000-000000000301','dc060000-0000-4000-8000-000000000401',current_date-7,'10:00','completed'),
('dc060000-0000-4000-8000-000000000502','dc060000-0000-4000-8000-000000000301','dc060000-0000-4000-8000-000000000401',current_date-7,'11:00','cancelled'),
('dc060000-0000-4000-8000-000000000503','dc060000-0000-4000-8000-000000000301','dc060000-0000-4000-8000-000000000401',current_date+7,'10:00','completed');
insert into private.customer_booking_owners(booking_id,account_user_id)
select id,'dc060000-0000-4000-8000-000000000101' from public.bookings
where id in ('dc060000-0000-4000-8000-000000000501','dc060000-0000-4000-8000-000000000502','dc060000-0000-4000-8000-000000000503');
select set_config('rating.target','{"booking_id":"dc060000-0000-4000-8000-000000000501","shop_rating":2,"barber_rating":5}',true);

set local role service_role;
select is(public.customer_account_api('rate-booking',current_setting('rating.one')::jsonb || current_setting('rating.target')::jsonb),
  '{"shop_rating":2,"barber_rating":5}'::jsonb,'shop and barber scores save independently');
select is(public.customer_account_api('rate-booking',current_setting('rating.one')::jsonb || current_setting('rating.target')::jsonb || '{"shop_rating":4}'),
  '{"shop_rating":4,"barber_rating":5}'::jsonb,'editing the shop score keeps the barber score');
select is((select item->>'shop_rating' from jsonb_array_elements(public.customer_account_api('bookings',current_setting('rating.one')::jsonb)) item
  where item->>'id'='dc060000-0000-4000-8000-000000000501'),'4','history returns the updated score');
select throws_ok($$select public.customer_account_api('rate-booking',current_setting('rating.two')::jsonb || current_setting('rating.target')::jsonb)$$,
  'P0001','BOOKING_NOT_RATEABLE','another customer cannot rate the booking');
select throws_ok($$select public.customer_account_api('rate-booking',current_setting('rating.one')::jsonb || current_setting('rating.target')::jsonb || '{"barber_rating":6}')$$,
  'P0001','INVALID_RATING','scores outside the range are rejected');
select throws_ok($$select public.customer_account_api('rate-booking',current_setting('rating.one')::jsonb || current_setting('rating.target')::jsonb || '{"booking_id":"dc060000-0000-4000-8000-000000000502"}')$$,
  'P0001','BOOKING_NOT_RATEABLE','cancelled bookings cannot be rated');
select throws_ok($$select public.customer_account_api('rate-booking',current_setting('rating.one')::jsonb || current_setting('rating.target')::jsonb || '{"booking_id":"dc060000-0000-4000-8000-000000000503"}')$$,
  'P0001','BOOKING_NOT_RATEABLE','a future appointment cannot be rated even when marked completed');
select throws_ok($$select public.customer_account_api('rate-booking',current_setting('rating.one')::jsonb || current_setting('rating.target')::jsonb || '{"session_id":"dc060000-0000-4000-8000-000000000202"}')$$,
  'P0001','AUTH_REQUIRED','a session cannot be borrowed from another account');
reset role;
select * from finish();
rollback;
