-- Synthetic 5,000-appointment benchmark, rolled back in full.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(1);
create temp table report_benchmark(result jsonb);
do $$
declare m uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();shop uuid:=gen_random_uuid();service uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();
 chairs uuid[];r jsonb;j jsonb;started timestamptz;elapsed numeric;g jsonb;
begin
 perform set_config('request.jwt.claims','{}',true);
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values(m,m||'@example.test',now(),'{"role":"manager"}');
 insert into auth.sessions(id,user_id)values(sid,m);
 insert into public.branches(id,manager_id,name)values(shop,m,'Reports performance rollback QA');
 insert into public.customers(id,name)values(customer,'Reports benchmark');
 insert into public.services(id,branch_id,name,duration,price)values(service,shop,'Benchmark service',30,3);
 with created as(insert into public.barbers(branch_id,name,status,service_ids)select shop,'Performance barber '||n,'active',array[service]from generate_series(1,25)n returning id)
 select array_agg(id)into chairs from created;
 insert into public.bookings(branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type)
 select shop,chairs[barber],customer,date'2026-09-01'+(n/10),time'09:00'+(n%10)*interval'30 minutes',array[service],30,3,'completed','customer'
 from generate_series(1,25)barber cross join generate_series(0,199)n;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'session_id',sid,'role','authenticated','aal','aal1','app_metadata',jsonb_build_object('role','manager'))::text,true);
 j:=public.staff_reports('create','{"preset":"custom","from":"2026-09-01","to":"2026-09-30","type":"barbers"}');
 started:=clock_timestamp();r:=public.staff_reports('build',j);elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 if r->>'state'<>'ready'or r->'result'->'summary'->>'completed'<>'5000'or r->'result'->'summary'->>'salesFils'<>'15000000'then raise exception 'BENCHMARK_TOTALS_FAILED: %',r;end if;
 if jsonb_array_length(r->'result'->'breakdown')<>20 or r->'result'->>'breakdownTotal'<>'25'then raise exception 'BENCHMARK_BOUNDING_FAILED';end if;
 g:=public.staff_reports('groups',j||'{"after":20,"limit":20}');
 if jsonb_array_length(g->'rows')<>5 then raise exception 'BENCHMARK_GROUP_PAGING_FAILED';end if;
 if octet_length(r::text)>30000 then raise exception 'BENCHMARK_RESPONSE_NOT_BOUNDED';end if;
 insert into report_benchmark values(jsonb_build_object('appointments',5000,'barbers',25,'buildMs',round(elapsed,1),'previewBytes',octet_length(r::text),'groupPages',2,'salesFils',15000000));
end $$;
select diag(result::text)from report_benchmark;
select ok((select (result->>'appointments')::int=5000 and (result->>'buildMs')::numeric>0 from report_benchmark),'production-size report generation and complete pagination');
select *from finish();
rollback;
