-- Synthetic 5,000-appointment benchmark, rolled back in full.
begin;
create temp table finance_benchmark(result jsonb);
do $$
declare m uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();shop uuid:=gen_random_uuid();service uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();
 chairs uuid[];r jsonb;j jsonb;started timestamptz;elapsed numeric;g jsonb;
begin
 perform set_config('request.jwt.claims','{}',true);
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values(m,m||'@example.test',now(),'{"role":"manager"}');
 insert into auth.sessions(id,user_id)values(sid,m);
 insert into public.branches(id,manager_id,name)values(shop,m,'Finance performance rollback QA');
 insert into public.customers(id,name)values(customer,'Reports benchmark');
 insert into public.services(id,branch_id,name,duration,price)values(service,shop,'Benchmark service',30,3);
 with created as(insert into public.barbers(branch_id,name,status,service_ids)select shop,'Performance barber '||n,'active',array[service]from generate_series(1,25)n returning id)
 select array_agg(id)into chairs from created;
 insert into public.bookings(branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type)
 select shop,chairs[barber],customer,date'2026-09-01'+(n/10),time'09:00'+(n%10)*interval'30 minutes',array[service],30,3,'completed','customer'
 from generate_series(1,25)barber cross join generate_series(0,199)n;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'session_id',sid,'role','authenticated','aal','aal1','app_metadata',jsonb_build_object('role','manager'))::text,true);
 started:=clock_timestamp();r:=public.manager_finances('generate','{"from":"2026-09-01","to":"2026-09-30"}');elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 if r->'summary'->>'salesFils'<>'15000000'or r->'summary'->>'dueFils'<>'15000000'then raise exception 'FINANCE_BENCHMARK_TOTALS: %',r;end if;
 if octet_length(r::text)>10000 then raise exception 'FINANCE_RESPONSE_UNBOUNDED';end if;
 g:=public.manager_finances('rows',jsonb_build_object('id',r->>'id','limit',500));
 if jsonb_array_length(g->'rows')<>501 then raise exception 'FINANCE_PAGE_FAILED';end if;
 insert into finance_benchmark values(jsonb_build_object('appointments',5000,'barbers',25,'buildMs',round(elapsed,1),'previewBytes',octet_length(r::text),'rows',r->>'total'));

end $$;
select result from finance_benchmark;
rollback;
