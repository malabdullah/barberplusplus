begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(33);

select ok(not has_table_privilege('authenticated','private.customer_booking_ratings','SELECT'),'ratings are private');
select ok(not has_table_privilege('authenticated','private.customer_booking_reviews','SELECT'),'written reviews are private');
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
  '{"shop_rating":2,"barber_rating":5,"review":null}'::jsonb,'shop and barber scores save independently');
select is(public.customer_account_api('rate-booking',current_setting('rating.one')::jsonb || current_setting('rating.target')::jsonb || '{"shop_rating":4}'),
  '{"shop_rating":4,"barber_rating":5,"review":null}'::jsonb,'editing the shop score keeps the barber score');
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
select set_config('rating.target',(current_setting('rating.target')::jsonb || '{"shop_rating":4}')::text,true);
select is(public.customer_account_api('rate-booking',current_setting('rating.one')::jsonb || current_setting('rating.target')::jsonb || '{"review":"  Great service.  "}') ->> 'review',
  'Great service.','review text is trimmed and saved with the scores');
select is(public.customer_account_api('rate-booking',current_setting('rating.one')::jsonb || current_setting('rating.target')::jsonb) ->> 'review',
  'Great service.','legacy rating clients preserve the existing review');
select is((select item->>'review' from jsonb_array_elements(public.customer_account_api('bookings',current_setting('rating.one')::jsonb)) item
  where item->>'id'='dc060000-0000-4000-8000-000000000501'),'Great service.','booking owner can read their review');
select is(jsonb_array_length(public.customer_account_api('bookings',current_setting('rating.two')::jsonb)), 0,
  'another customer cannot read the reviewed booking');
select throws_ok(format('select public.customer_account_api(''rate-booking'',%L::jsonb)',
  current_setting('rating.one')::jsonb || current_setting('rating.target')::jsonb || jsonb_build_object('review',repeat('x',1001))),
  'P0001','INVALID_RATING','review length is enforced server-side');
select is(public.customer_account_api('rate-booking',current_setting('rating.one')::jsonb || current_setting('rating.target')::jsonb || '{"review":null}') ->> 'review',
  null,'customer can clear the review while keeping the scores');
reset role;
select ok(not has_function_privilege('anon','public.customer_catalog_ratings()','EXECUTE')
  and not has_function_privilege('authenticated','public.customer_catalog_ratings()','EXECUTE'),
  'only the catalog gateway can access the aggregate RPC');
insert into public.bookings(id,branch_id,barber_id,date,time,status)
select v.id::uuid,b.branch_id,b.barber_id,b.date-1,v.time::time,'completed'
from public.bookings b cross join (values
  ('dc060000-0000-4000-8000-000000000504','10:00'),
  ('dc060000-0000-4000-8000-000000000505','11:00')
) v(id,time)
where b.id='dc060000-0000-4000-8000-000000000501';
insert into private.customer_booking_owners(booking_id,account_user_id) values
('dc060000-0000-4000-8000-000000000504','dc060000-0000-4000-8000-000000000101'),
('dc060000-0000-4000-8000-000000000505','dc060000-0000-4000-8000-000000000102');
insert into private.customer_booking_ratings(booking_id,shop_rating,barber_rating) values
('dc060000-0000-4000-8000-000000000504',2,1),
('dc060000-0000-4000-8000-000000000505',5,1),
('dc060000-0000-4000-8000-000000000502',1,5);
set local role service_role;
select is(public.customer_catalog_ratings()->'shops'->'dc060000-0000-4000-8000-000000000301',
  '{"average":4.0,"count":2}'::jsonb,'shop counts unique customers and excludes cancelled appointments');
select is(public.customer_catalog_ratings()->'barbers'->'dc060000-0000-4000-8000-000000000401',
  '{"average":2.0,"count":2}'::jsonb,'barber uses the separate scores with equal weight per customer');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"dc060000-0000-4000-8000-000000000101","session_id":"dc060000-0000-4000-8000-000000000201","aal":"aal1"}',true);
select is(jsonb_array_length(public.account_activity()),4,'booking owner sees the four recorded booking events');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"dc060000-0000-4000-8000-000000000102","session_id":"dc060000-0000-4000-8000-000000000202","aal":"aal1"}',true);
select is(jsonb_array_length(public.account_activity()),1,'another customer sees only their own booking event');
reset role;

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('dc060000-0000-4000-8000-000000000104','rating-social@example.test',now(),'{"role":"customer"}');
insert into auth.sessions(id,user_id) values
('dc060000-0000-4000-8000-000000000204','dc060000-0000-4000-8000-000000000104');
insert into private.customer_social_identities(user_id,account_user_id) values
('dc060000-0000-4000-8000-000000000104','dc060000-0000-4000-8000-000000000101');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"dc060000-0000-4000-8000-000000000104","session_id":"dc060000-0000-4000-8000-000000000204","aal":"aal1"}',true);
select is(jsonb_array_length(public.account_sessions()),2,'linked social login sees the same account sessions');
select ok(not exists(select 1 from jsonb_array_elements(public.account_sessions()) item
  where item->>'id'='dc060000-0000-4000-8000-000000000202'),'other customer sessions stay private');
select is(jsonb_array_length(public.account_sessions('dc060000-0000-4000-8000-000000000201')),1,
  'linked customer can end another session of the same account');
reset role;

insert into private.customer_booking_reviews(booking_id,body)
values('dc060000-0000-4000-8000-000000000501','Private written feedback');
insert into auth.sessions(id,user_id) values
('dc060000-0000-4000-8000-000000000203','dc060000-0000-4000-8000-000000000103');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"dc060000-0000-4000-8000-000000000103","session_id":"dc060000-0000-4000-8000-000000000203","aal":"aal1"}',true);
select is(public.shop_reviews()->>'total','1','manager sees private feedback for their shop');
select is(public.shop_reviews()->'rows'->0->>'review','Private written feedback','manager reads the written review');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"dc060000-0000-4000-8000-000000000102","session_id":"dc060000-0000-4000-8000-000000000202","aal":"aal1"}',true);
select throws_ok('select public.shop_reviews()','42501','REVIEWS_FORBIDDEN','customer cannot read staff feedback list');
reset role;
select ok(not has_function_privilege('anon','public.shop_reviews(integer)','EXECUTE'),'anonymous visitors cannot read private reviews');
set local role service_role;
select is(public.customer_session_is_live('dc060000-0000-4000-8000-000000000101','dc060000-0000-4000-8000-000000000201'),false,
  'gateway session check rejects the session ended by the linked login');
reset role;
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
('dc060000-0000-4000-8000-000000000105','rating-other-manager@example.test',now(),'{"role":"manager"}'),
('dc060000-0000-4000-8000-000000000106','rating-assigned-barber@example.test',now(),'{"role":"barber"}'),
('dc060000-0000-4000-8000-000000000107','rating-other-barber@example.test',now(),'{"role":"barber"}');
insert into auth.sessions(id,user_id) values
('dc060000-0000-4000-8000-000000000205','dc060000-0000-4000-8000-000000000105'),
('dc060000-0000-4000-8000-000000000206','dc060000-0000-4000-8000-000000000106'),
('dc060000-0000-4000-8000-000000000207','dc060000-0000-4000-8000-000000000107');
update public.barbers set user_id='dc060000-0000-4000-8000-000000000106'
where id='dc060000-0000-4000-8000-000000000401';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"dc060000-0000-4000-8000-000000000105","session_id":"dc060000-0000-4000-8000-000000000205","aal":"aal1"}',true);
select is(public.shop_reviews()->>'total','0','unrelated manager cannot read the private review');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"dc060000-0000-4000-8000-000000000106","session_id":"dc060000-0000-4000-8000-000000000206","aal":"aal1"}',true);
select is(public.shop_reviews()->>'total','1','assigned active barber can read their private review');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"dc060000-0000-4000-8000-000000000107","session_id":"dc060000-0000-4000-8000-000000000207","aal":"aal1"}',true);
select is(public.shop_reviews()->>'total','0','unrelated barber cannot read the private review');
reset role;
select * from finish();
rollback;
