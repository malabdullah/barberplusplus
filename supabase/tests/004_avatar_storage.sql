begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(14);
select ok(exists(select 1 from storage.buckets where id='avatars' and public), 'public avatar bucket exists');
select ok(not has_function_privilege('anon','public.can_write_avatar_object(text)','execute'), 'anonymous callers cannot inspect avatar ownership');
select ok((select not prosecdef from pg_proc where oid='public.can_write_avatar_object(text)'::regprocedure), 'avatar helper respects caller RLS');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"manager"}}',true);
select ok(public.can_write_avatar_object('branches/10000000-0000-4000-8000-000000000001-1700000000000.png'), 'manager can write own branch avatar');
select ok(not public.can_write_avatar_object('branches/10000000-0000-4000-8000-000000000002-1700000000000.png'), 'manager cannot write another tenant avatar');
select ok(not public.can_write_avatar_object('branches/../10000000-0000-4000-8000-000000000001-1700000000000.png'), 'nested or traversal paths denied');
select ok(not public.can_write_avatar_object('branches/10000000-0000-4000-8000-000000000001-1700000000000.svg'), 'active-content extension denied');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) values ('avatars','branches/10000000-0000-4000-8000-000000000001-1700000000000.png','{"mimetype":"image/png","size":10}')$$, 'manager may insert own image metadata');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values ('avatars','branches/10000000-0000-4000-8000-000000000002-1700000000000.png','{"mimetype":"image/png","size":10}')$$,'42501');
select throws_ok($$update storage.objects set name='branches/10000000-0000-4000-8000-000000000002-1700000000000.png' where name='branches/10000000-0000-4000-8000-000000000001-1700000000000.png'$$,'42501');
reset role;
select is((select file_size_limit from storage.buckets where id='avatars'),5242880::bigint,'Storage API enforces five megabyte limit');
select ok((select allowed_mime_types @> array['image/png'] and not ('text/html'=any(allowed_mime_types)) from storage.buckets where id='avatars'), 'Storage API permits images and denies active HTML content');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"role":"barber"}}',true);
select ok(public.can_write_avatar_object('barbers/30000000-0000-4000-8000-000000000001-1700000000000.png'), 'barber may write own portrait');
select ok(not public.can_write_avatar_object('branches/10000000-0000-4000-8000-000000000001-1700000000000.png'), 'barber cannot write branch avatar');
reset role;
select * from finish();
rollback;
