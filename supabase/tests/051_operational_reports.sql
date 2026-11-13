-- All fixtures and report artifacts roll back. No real messages or owner edits.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(1);
create temp table report_checks(label text);
create function pg_temp.report_assert(ok boolean,label text)returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'REPORT_ASSERT: %',label;end if;insert into report_checks values(label);end $$;
do $tests$
declare
 m uuid:=gen_random_uuid();u uuid:=gen_random_uuid();other_m uuid:=gen_random_uuid();c_user uuid:=gen_random_uuid();
 ms uuid:=gen_random_uuid();us uuid:=gen_random_uuid();os uuid:=gen_random_uuid();cs uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();outside uuid:=gen_random_uuid();
 ba uuid:=gen_random_uuid();bb uuid:=gen_random_uuid();chair uuid:=gen_random_uuid();
 c1 uuid:=gen_random_uuid();c2 uuid:=gen_random_uuid();s1 uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();s3 uuid:=gen_random_uuid();s4 uuid:=gen_random_uuid();
 pkg uuid:=gen_random_uuid();offer uuid:=gen_random_uuid();jid uuid;report jsonb;job jsonb;personal_job jsonb;value jsonb;denied boolean;counted integer:=0;started timestamptz;
 manager_claims text;barber_claims text;
begin
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values(m,m||'@example.test',now(),'{"role":"manager"}'),(u,u||'@example.test',now(),'{"role":"barber"}'),(other_m,other_m||'@example.test',now(),'{"role":"manager"}'),(c_user,c_user||'@example.test',now(),'{"role":"customer"}');
 insert into auth.sessions(id,user_id)values(ms,m),(us,u),(os,other_m),(cs,c_user);
 manager_claims:=jsonb_build_object('sub',m,'session_id',ms,'role','authenticated','aal','aal1','app_metadata',jsonb_build_object('role','manager'))::text;
 barber_claims:=jsonb_build_object('sub',u,'session_id',us,'role','authenticated','aal','aal1','app_metadata',jsonb_build_object('role','barber'))::text;
 perform set_config('request.jwt.claims','{}',true);
 insert into public.branches(id,manager_id,name,status)values(a,m,'Reports QA A','active'),(b,m,'Reports QA B','active'),(outside,other_m,'Other tenant','active');
 insert into public.customers(id,name)values(c1,'=HYPERLINK("https://example.test","literal")'),(c2,'عميل التقارير');
 insert into public.services(id,branch_id,name,duration,price)values(s1,a,'Cut',30,3),(s2,a,'Beard',20,5),(s3,a,'Facial',40,7),(s4,a,'Wash',15,2);
 insert into public.barbers(id,user_id,branch_id,name,status,service_ids,manager_chair)values
  (ba,u,a,'Reports Barber','active',array[s1,s2,s3,s4],false),(bb,null,b,'Managed barber','inactive','{}',false);
 perform set_config('request.jwt.claims',manager_claims,true);
 insert into public.barbers(id,user_id,branch_id,name,status,service_ids,manager_chair)values(chair,m,a,'Manager chair','inactive',array[s1],true);
 update public.barbers set status='active',availability='{"monday":{"enabled":true,"start":"09:00","end":"20:00"}}'where id=chair;
 perform set_config('request.jwt.claims','{}',true);
 insert into public.bookings(branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type)
 select a,ba,c1,date'2026-01-01'+n,'09:00',array[s1],30,3,'completed','customer'from generate_series(0,27)n;
 insert into public.bookings(branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type)values
 (a,ba,c2,'2026-01-29','09:00',array[s1],30,3,'completed','customer'),(a,ba,c2,'2026-01-30','09:00',array[s1],30,3,'completed','customer'),
 (b,bb,c2,'2026-01-31','09:00','{}',30,3,'completed','customer'),(a,ba,c1,'2025-12-15','09:00',array[s1],30,3,'completed','customer'),
 (a,ba,c1,'2026-02-01','00:00',array[s1],30,3,'completed','customer'),
 (a,ba,c1,'2026-01-05','11:00',array[s1],30,3,'cancelled','customer'),(a,ba,c1,'2026-01-06','11:00',array[s1],30,3,'no_show','customer'),
 (a,ba,c1,'2026-01-07','11:00',array[s1],30,3,'confirmed','customer'),(a,ba,c1,'2026-01-08','12:00',array[s1],30,4,'completed','customer'),
 (a,chair,c2,'2026-01-10','14:00',array[s1],30,3,'completed','customer');
 insert into private.service_packages(id,branch_id,name)values(pkg,a,'Package');
 insert into private.package_services(package_id,service_id)select pkg,x from unnest(array[s1,s2,s3])x;
 insert into private.package_offers(id,package_id,name,service_ids,price,starts_on,ends_on)values(offer,pkg,'Package',array[s1,s2,s3],10,'2025-12-01','2027-12-31');
 insert into public.bookings(branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type,package_offer_id)
 values(a,ba,c2,'2026-01-09','13:00',array[s1,s2,s3,s4],105,12,'completed','customer',offer);
 insert into private.customer_booking_ratings(booking_id,shop_rating,barber_rating)
 select id,4,5 from public.bookings where branch_id=a and date='2026-01-01';
 update public.barbers set status='inactive'where id=ba;
 perform set_config('request.jwt.claims',manager_claims,true);
 job:=public.staff_reports('create','{"preset":"custom","from":"2026-01-01","to":"2026-01-31","type":"overview"}');jid:=(job->>'id')::uuid;
 report:=public.staff_reports('build',job);
 perform pg_temp.report_assert(report->>'state'='ready','report generated');
 perform pg_temp.report_assert(report->'result'->'summary'->>'salesFils'='112000','completed prices include package once and manager chair');
 perform pg_temp.report_assert(report->'result'->'summary'->>'completed'='34','date boundary excludes February midnight and December creation is irrelevant');
 perform pg_temp.report_assert(report->'result'->'summary'->>'customers'='2','canonical customers deduplicated across shops');
 perform pg_temp.report_assert(report->'result'->'summary'->>'newCustomers'='1'and report->'result'->'summary'->>'returningCustomers'='1','same-month repeat customer counted once as new');
 perform pg_temp.report_assert(report->'result'->'summary'->>'pastEnded'='37'and report->'result'->'summary'->>'needsStatus'='1','unresolved past appointment stays in denominator');
 perform pg_temp.report_assert(report->'result'->'summary'->>'shopRating'='4.00'and report->'result'->'summary'->>'barberRating'='5.00','ratings remain separate');
 perform pg_temp.report_assert(report->'result'->'summary'->>'shopRatingCount'='1','rating submission count');
 perform pg_temp.report_assert(report->'result'->'previous'->>'completed'='1','full month compares with full previous calendar month');
 perform pg_temp.report_assert(report->'result'->>'grouping'='shops','multiple shops grouped by shop');
 perform pg_temp.report_assert((select sum((x->>'salesFils')::bigint)from jsonb_array_elements(report->'result'->'breakdown')x)=112000,'breakdown reconciles to shop totals');
 value:=public.staff_reports('rows',job||'{"limit":25}');counted:=least(25,jsonb_array_length(value->'rows'));
 perform pg_temp.report_assert(jsonb_array_length(value->'rows')=26,'detail page uses a lookahead row');
 value:=public.staff_reports('rows',job||jsonb_build_object('limit',25,'after',value->'rows'->24->'ordinal'));
 counted:=counted+jsonb_array_length(value->'rows');
 perform pg_temp.report_assert(counted=37,'cursor pagination returns every appointment once');
 perform pg_temp.report_assert(not(public.staff_reports('rows',job)::text~'"(email|phone|notes)"'),'report rows exclude phone email and notes');
 value:=public.staff_reports('rows',job||'{"status":"needs_status"}');
 perform pg_temp.report_assert(jsonb_array_length(value->'rows')=1,'needs-status detail filters to unresolved past only');
 perform set_config('request.jwt.claims','{}',true);
 update public.services set price=8 where id=s1;
 perform set_config('request.jwt.claims',manager_claims,true);
 perform pg_temp.report_assert(public.staff_reports('get',job)->'result'->'summary'->>'salesFils'='112000','existing snapshot unchanged after catalogue edit');
 value:=public.staff_reports('build',public.staff_reports('create','{"preset":"custom","from":"2026-01-01","to":"2026-01-31","type":"services"}'));
 perform pg_temp.report_assert(value->'result'->'summary'->>'salesFils'='112000','new report also uses historical prices');
 perform pg_temp.report_assert((select sum((x->>'salesFils')::bigint)from jsonb_array_elements(value->'result'->'breakdown')x)=112000,'packages add-ons and unallocated values reconcile');
 perform pg_temp.report_assert(exists(select 1 from jsonb_array_elements(value->'result'->'breakdown')x where x->>'kind'='included'and x->'salesFils'='null'::jsonb),'included services are usage-only');
 perform pg_temp.report_assert(exists(select 1 from jsonb_array_elements(value->'result'->'breakdown')x where x->>'kind'='unallocated'and(x->>'salesFils')::bigint=4000),'missing lines and legacy mismatch are explicit unallocated values');
 value:=public.staff_reports('build',public.staff_reports('create',jsonb_build_object('preset','custom','from','2026-01-01','to','2026-01-31','shopIds',jsonb_build_array(a))));
 perform pg_temp.report_assert(value->'result'->>'grouping'='barbers','single shop uses barber breakdown');
 personal_job:=public.staff_reports('create','{"preset":"custom","from":"2026-01-01","to":"2026-01-31","personal":true}');
 value:=public.staff_reports('build',personal_job);
 perform pg_temp.report_assert(value->'result'->'summary'->>'salesFils'='3000','manager personal report includes own chair only');
 perform set_config('request.jwt.claims',barber_claims,true);
 value:=public.staff_reports('build',public.staff_reports('create','{"preset":"custom","from":"2026-01-01","to":"2026-01-31"}'));
 perform pg_temp.report_assert(value->'result'->'summary'->>'salesFils'='106000','inactive barber retains own authorized history only');
 denied:=false;begin perform public.staff_reports('get',job);exception when insufficient_privilege then denied:=true;end;
 perform pg_temp.report_assert(denied,'barber cannot download manager snapshot');
 denied:=false;begin perform public.staff_reports('create',jsonb_build_object('preset','month','shopIds',jsonb_build_array(b)));exception when insufficient_privilege then denied:=true;end;
 perform pg_temp.report_assert(denied,'barber cannot select another shop');
 perform set_config('request.jwt.claims',manager_claims,true);
 denied:=false;begin perform public.staff_reports('create',jsonb_build_object('preset','month','shopIds',jsonb_build_array(outside)));exception when insufficient_privilege then denied:=true;end;
 perform pg_temp.report_assert(denied,'other tenant scope rejected server-side');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_m,'session_id',os,'role','authenticated')::text,true);
 denied:=false;begin perform public.staff_reports('get',job);exception when insufficient_privilege then denied:=true;end;
 perform pg_temp.report_assert(denied,'another manager cannot open snapshot ID');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',c_user,'session_id',cs,'role','authenticated','app_metadata',jsonb_build_object('role','manager'))::text,true);
 denied:=false;begin perform public.staff_reports('options');exception when insufficient_privilege then denied:=true;end;
 perform pg_temp.report_assert(denied,'customer cannot spoof a manager role');
 perform set_config('request.jwt.claims',manager_claims,true);
 value:=public.staff_reports('build',public.staff_reports('create','{"preset":"custom","from":"2020-01-01","to":"2020-01-31"}'));
 perform pg_temp.report_assert(value->'result'->'summary'->>'completed'='0'and value->'result'->'summary'->>'salesFils'='0','empty results are actual zero totals');
 denied:=false;begin perform public.staff_reports('create','{"from":"2026-02-01","to":"2026-01-01"}');exception when others then denied:=sqlerrm='REPORT_INVALID_RANGE';end;
 perform pg_temp.report_assert(denied,'invalid range rejected');
 perform set_config('request.jwt.claims','{}',true);
 insert into public.bookings(branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type)
 values(a,ba,c1,'2019-06-10','09:00',array[s1],30,0,'completed','customer'),
 (a,ba,c1,(clock_timestamp()at time zone'Asia/Kuwait')::date+1,'09:00',array[s1],30,3,'confirmed','customer');
 perform set_config('request.jwt.claims',manager_claims,true);
 value:=public.staff_reports('build',public.staff_reports('create','{"from":"2019-06-01","to":"2019-06-30"}'));
 perform pg_temp.report_assert(value->'result'->'summary'->>'salesFils'='0'and value->'result'->'summary'->>'completed'='1','free appointment is a completed visit, not an empty report');
 value:=public.staff_reports('build',public.staff_reports('create',jsonb_build_object('from',(clock_timestamp()at time zone'Asia/Kuwait')::date+1,'to',(clock_timestamp()at time zone'Asia/Kuwait')::date+1)));
 perform pg_temp.report_assert(value->'result'->'summary'->>'pastEnded'='0'and value->'result'->'summary'->>'upcomingMinutes'='30','future appointment stays out of past-performance denominator');
 value:=public.staff_reports('build',public.staff_reports('create',jsonb_build_object('from','2026-01-01','to','2026-01-31','shopIds',jsonb_build_array(b))));
 perform pg_temp.report_assert(value->'result'->'summary'->>'newCustomers'='1','new customers are relative to selected shop set');
 value:=public.staff_reports('build',public.staff_reports('create','{"preset":"month"}'));
 perform pg_temp.report_assert((value->>'currentUntil')::timestamptz<=clock_timestamp()and(value->>'to')::date=(clock_timestamp()at time zone'Asia/Kuwait')::date,'month-to-date stops at generation time');
 perform set_config('request.jwt.claims','{}',true);
 update public.bookings set status='completed'where branch_id=a and date='2026-01-07'and time='11:00';
 perform set_config('request.jwt.claims',manager_claims,true);
 value:=public.staff_reports('build',public.staff_reports('create','{"from":"2026-01-01","to":"2026-01-31"}'));
 perform pg_temp.report_assert(value->'result'->'summary'->>'salesFils'='115000'and public.staff_reports('get',job)->'result'->'summary'->>'salesFils'='112000','new result reflects a correction while earlier snapshot remains fixed');
 update private.staff_report_runs set expires_at=clock_timestamp()-interval'1 second'where id=jid;
 denied:=false;begin perform public.staff_reports('get',job);exception when others then denied:=sqlerrm='REPORT_EXPIRED';end;
 perform pg_temp.report_assert(denied,'expired report cannot be downloaded');
 update private.staff_report_runs set expires_at=clock_timestamp()+interval'1 hour'where id=jid;
 while(select count(*)from private.staff_report_runs where owner_id=m and created_at>clock_timestamp()-interval'1 hour')<30 loop
  perform public.staff_reports('create','{"preset":"month"}');
 end loop;
 denied:=false;begin perform public.staff_reports('create','{"preset":"month"}');exception when others then denied:=sqlerrm='REPORT_RATE_LIMIT';end;
 perform pg_temp.report_assert(denied,'generation rate limit enforced in database');
 update auth.users set banned_until=clock_timestamp()+interval'1 hour'where id=m;
 denied:=false;begin perform public.staff_reports('get',job);exception when insufficient_privilege then denied:=true;end;
 perform pg_temp.report_assert(denied,'suspended manager cannot read a retained report');
 update auth.users set banned_until=null where id=m;
 perform set_config('request.jwt.claims','{}',true);
 update public.branches set manager_id=other_m where id=b;
 perform set_config('request.jwt.claims',manager_claims,true);
 denied:=false;begin perform public.staff_reports('rows',job);exception when insufficient_privilege then denied:=true;end;
 perform pg_temp.report_assert(denied,'shop transfer revokes report and download access immediately');
 update auth.sessions set not_after=now()-interval'1 second'where id=ms;
 denied:=false;begin perform public.staff_reports('options');exception when insufficient_privilege then denied:=true;end;
 perform pg_temp.report_assert(denied,'revoked session cannot generate or read');
 perform pg_temp.report_assert(not has_function_privilege('anon','public.staff_reports(text,jsonb)','execute'),'anonymous execution denied');
 perform pg_temp.report_assert(not has_table_privilege('authenticated','private.staff_report_rows','select'),'direct snapshot table access denied');
 perform pg_temp.report_assert(not has_table_privilege('service_role','private.staff_report_runs','select'),'snapshots are not generally exposed to service role');
end $tests$;
select pass('Operational report assertions: '||(select count(*)from report_checks));
select *from finish();
rollback;
