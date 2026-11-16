-- Read-only catalog checks: no fixture, account, proof, booking or message creation.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(1);
do $tests$
declare shop public.branches%rowtype;barber public.barbers%rowtype;result jsonb;denied boolean;inactive uuid;missing uuid:=gen_random_uuid();
begin
 assert not has_function_privilege('anon','public.customer_booking_discovery(text,jsonb)','EXECUTE'),'anonymous cannot bypass gateway';
 assert not has_function_privilege('authenticated','public.customer_booking_discovery(text,jsonb)','EXECUTE'),'customer cannot impersonate identity via RPC';
 select b.* into barber from public.barbers b join public.branches s on s.id=b.branch_id where b.status='active'and s.status='active'and s.publication_state='published'and private.booking_provider_ready(b,s)order by b.id limit 1;
 if barber.id is null then raise exception 'Published synthetic catalog required';end if;
 select *into shop from public.branches where id=barber.branch_id;
 result:=private.customer_booking_discovery('entry',jsonb_build_object('kind','shop','branch_id',shop.id));
 assert result->>'branchId'=shop.id::text and result->>'barberId'is null and result->>'kind'='shop','shop points to barber selection';
 result:=private.customer_booking_discovery('entry',jsonb_build_object('kind','barber','barber_id',barber.id));
 assert result->>'branchId'=shop.id::text and result->>'barberId'=barber.id::text and result->>'kind'='barber','barber entry derives its current shop';
 assert nullif(result->>'city','')is not null,'city resolved from current catalog';
 assert not(result?|array['email','phone','notes','user_id','session_id','date','time','services','booking_id']),'entry contains no private or old booking data';
 denied:=false;begin perform private.customer_booking_discovery('entry',jsonb_build_object('kind','shop','branch_id',missing));exception when others then denied:=sqlerrm='INVALID_SELECTION';end;assert denied,'missing shop unavailable';
 denied:=false;begin perform private.customer_booking_discovery('entry',jsonb_build_object('kind','barber','barber_id',missing));exception when others then denied:=sqlerrm='INVALID_SELECTION';end;assert denied,'missing barber unavailable';
 denied:=false;begin perform private.customer_booking_discovery('entry',jsonb_build_object('kind','booking','branch_id',shop.id));exception when others then denied:=sqlerrm='INVALID_REQUEST';end;assert denied,'invalid target kind rejected';
 denied:=false;begin perform private.customer_booking_discovery('entry',jsonb_build_object('kind','shop','branch_id',shop.id,'account_user_id',missing,'session_id',missing));exception when others then denied:=sqlerrm='AUTH_REQUIRED';end;assert denied,'forged session denied';
 select id into inactive from public.branches where status<>'active'or publication_state<>'published'limit 1;
 if inactive is not null then denied:=false;begin perform private.customer_booking_discovery('entry',jsonb_build_object('kind','shop','branch_id',inactive));exception when others then denied:=sqlerrm='INVALID_SELECTION';end;assert denied,'unpublished shop unavailable';end if;
end$tests$;
select pass('Shared catalog entries: private-data exclusion, bounded current catalog lookup, publication and session denials');
select *from finish();
rollback;
