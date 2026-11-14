-- Synthetic 5,000-appointment benchmark, rolled back in full.
begin;
create temp table finance_benchmark(result jsonb);
do $$
declare m uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();shop uuid:=gen_random_uuid();service uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();
 chairs uuid[];r jsonb;j jsonb;started timestamptz;elapsed numeric;g jsonb;after_row bigint:=0;counted integer:=0;
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
 insert into private.shop_finance_entries(id,shop_id,booking_id,kind,amount_fils,signed_fils,occurred_on,method,created_by)
 select gen_random_uuid(),shop,id,'receipt',1500,1500,'2026-09-15','cash',m from public.bookings where branch_id=shop;
 with created as(insert into private.shop_finance_expenses(shop_id,incurred_on,category,description,amount_fils,created_by)select shop,'2026-09-15','supplies','Benchmark supplies',30000,m from generate_series(1,50)returning id)
 insert into private.shop_finance_entries(id,shop_id,expense_id,kind,amount_fils,signed_fils,occurred_on,method,created_by)
 select gen_random_uuid(),shop,id,'expense_payment',10000,10000,'2026-09-15','transfer',m from created;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'session_id',sid,'role','authenticated','aal','aal1','app_metadata',jsonb_build_object('role','manager'))::text,true);
 started:=clock_timestamp();r:=public.manager_finances('generate','{"from":"2026-09-01","to":"2026-09-30"}');elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 if r->'summary'->>'salesFils'<>'15000000'or r->'summary'->>'dueFils'<>'7500000'or r->'summary'->>'cashFlowFils'<>'7000000'or r->'summary'->>'operatingFils'<>'13500000'then raise exception 'FINANCE_BENCHMARK_TOTALS: %',r;end if;
 if octet_length(r::text)>10000 then raise exception 'FINANCE_RESPONSE_UNBOUNDED';end if;
 g:=public.manager_finances('rows',jsonb_build_object('id',r->>'id','limit',500));
 if jsonb_array_length(g->'rows')<>501 then raise exception 'FINANCE_PAGE_FAILED';end if;
 loop
  g:=public.manager_finances('rows',jsonb_build_object('id',r->>'id','limit',500,'after',after_row));
  counted:=counted+least(500,jsonb_array_length(g->'rows'));
  exit when jsonb_array_length(g->'rows')<=500;
  after_row:=(g->'rows'->499->>'ordinal')::bigint;
 end loop;
 if counted<>(r->>'total')::int then raise exception 'FINANCE_EXPORT_ROW_LOSS';end if;
 insert into finance_benchmark values(jsonb_build_object('appointments',5000,'barbers',25,'buildMs',round(elapsed,1),'previewBytes',octet_length(r::text),'rows',r->>'total'));

end $$;
select result from finance_benchmark;
rollback;
