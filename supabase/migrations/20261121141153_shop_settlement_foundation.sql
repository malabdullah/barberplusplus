-- Platform-held booking money only. No shop-finance or subscription writes.
-- Disabled until explicitly enabled in the separately approved environment.
create table private.settlement_runtime (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 installed_at timestamptz not null default clock_timestamp()
);
insert into private.settlement_runtime(singleton)values(true);
create table private.settlement_rates (
 id uuid primary key default extensions.gen_random_uuid(), shop_id uuid,
 rate_bps integer check(rate_bps between 0 and 10000),
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 reason text not null check(length(reason)between 3 and 240), check(shop_id is not null or rate_bps is not null)
);
create index settlement_rate_scope on private.settlement_rates(shop_id,created_at desc,id);
create table private.settlement_agreements (
 id uuid primary key default extensions.gen_random_uuid(), shop_id uuid not null,
 fee_bearer text not null check(fee_bearer in('platform','shop')),
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 reason text not null check(length(reason)between 3 and 240)
);
create index settlement_agreement_scope on private.settlement_agreements(shop_id,created_at desc,id);
create table private.settlement_beneficiaries (
 id uuid primary key default extensions.gen_random_uuid(), shop_id uuid not null,
 payee_name text not null check(length(payee_name)between 1 and 160),
 beneficiary_ref text not null check(length(beneficiary_ref)between 1 and 120),
 iban_last_four text not null check(iban_last_four~'^[A-Z0-9]{4}$'),
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 reason text not null check(length(reason)between 3 and 240)
);
create index settlement_beneficiary_scope on private.settlement_beneficiaries(shop_id,created_at desc,id);
create table private.settlement_statements (
 id uuid primary key default extensions.gen_random_uuid(), shop_id uuid not null references public.branches(id)on delete restrict,
 period date not null check(extract(day from period)=1), cutoff_at timestamptz not null,
 state text not null default 'draft'check(state in('draft','final','cancelled')),
 fingerprint text not null, total_fils bigint not null, line_count integer not null check(line_count>0),
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 finalized_at timestamptz, finalized_by uuid,
 check((state='final')=(finalized_at is not null))
);
create index settlement_statement_scope on private.settlement_statements(shop_id,period desc,created_at desc,id);
create table private.settlement_receipts (
 id uuid primary key default extensions.gen_random_uuid(), shop_id uuid not null references public.branches(id)on delete restrict,
 booking_id uuid not null references public.bookings(id)on delete restrict,
 amount_fils bigint not null check(amount_fils between 1 and 1000000000),
 commission_bps integer not null check(commission_bps between 0 and 10000),
 commission_fils bigint not null check(commission_fils between 0 and amount_fils),
 rate_id uuid not null references private.settlement_rates(id), agreement_id uuid not null references private.settlement_agreements(id),
 fee_bearer text not null check(fee_bearer in('platform','shop')),
 source_ref text not null unique check(length(source_ref)between 1 and 120),
 collected_at timestamptz not null, settled_at timestamptz,
 fee_known boolean not null default false, held boolean not null default false,
 statement_id uuid references private.settlement_statements(id),
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 check(settled_at is null or settled_at>=collected_at)
);
create index settlement_receipt_scope on private.settlement_receipts(shop_id,collected_at desc,id);
create index settlement_receipt_booking on private.settlement_receipts(booking_id);
create index settlement_receipt_statement on private.settlement_receipts(statement_id);
create table private.settlement_statement_lines (
 statement_id uuid not null references private.settlement_statements(id),
 receipt_id uuid not null references private.settlement_receipts(id), snapshot jsonb not null,
 primary key(statement_id,receipt_id)
);
create table private.settlement_payouts (
 id uuid primary key default extensions.gen_random_uuid(), shop_id uuid not null references public.branches(id)on delete restrict,
 statement_id uuid not null references private.settlement_statements(id),
 beneficiary_id uuid not null references private.settlement_beneficiaries(id),
 amount_fils bigint not null check(amount_fils between 1 and 1000000000),
 state text not null default 'prepared'check(state in('prepared','uncertain','paid','failed','cancelled')),
 bank_ref text, transferred_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 confirmed_by uuid, check((state='paid')=(bank_ref is not null and transferred_at is not null))
);
create unique index settlement_bank_transfer_unique on private.settlement_payouts(bank_ref)where bank_ref is not null;
create index settlement_payout_scope on private.settlement_payouts(shop_id,created_at desc,id);
create table private.settlement_allocations (
 payout_id uuid not null references private.settlement_payouts(id), receipt_id uuid not null references private.settlement_receipts(id),
 amount_fils bigint not null check(amount_fils<>0),primary key(payout_id,receipt_id)
);
create index settlement_allocation_receipt on private.settlement_allocations(receipt_id);
create table private.settlement_journals (
 id uuid primary key default extensions.gen_random_uuid(), seq bigint generated always as identity unique,
 shop_id uuid not null references public.branches(id)on delete restrict,
 receipt_id uuid references private.settlement_receipts(id), payout_id uuid references private.settlement_payouts(id),
 kind text not null check(kind in('receipt','fee','refund','payout','reversal')),
 amount_fils bigint not null check(amount_fils between -1000000000 and 1000000000),
 external_ref text check(length(external_ref)between 1 and 120),
 reverses_id uuid unique references private.settlement_journals(id),
 occurred_at timestamptz not null, created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 reason text not null default ''check(length(reason)<=240),check((kind='reversal')=(reverses_id is not null))
);
create unique index settlement_external_event_unique on private.settlement_journals(kind,external_ref)where external_ref is not null;
create index settlement_journal_receipt on private.settlement_journals(receipt_id,seq);
create index settlement_journal_scope on private.settlement_journals(shop_id,seq);
create table private.settlement_entries (
 journal_id uuid not null references private.settlement_journals(id),
 account text not null check(account in('cash','shop','commission','fees')),
 signed_fils bigint not null check(signed_fils between -1000000000000 and 1000000000000),
 primary key(journal_id,account)
);
create table private.settlement_requests (
 actor_id uuid not null, request_id uuid not null, input_hash text not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
create table private.settlement_audit (
 id bigint generated always as identity primary key, shop_id uuid, actor_id uuid not null,
 action text not null, details jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create index settlement_audit_scope on private.settlement_audit(shop_id,id desc);

do $security$
declare t text;
begin
 foreach t in array array['settlement_runtime','settlement_rates','settlement_agreements','settlement_beneficiaries','settlement_statements','settlement_receipts','settlement_statement_lines','settlement_payouts','settlement_allocations','settlement_journals','settlement_entries','settlement_requests','settlement_audit']loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $security$;

create function private.settlement_immutable()returns trigger language plpgsql set search_path=''as $$
begin raise exception 'SETTLEMENT_IMMUTABLE'using errcode='42501';end $$;
revoke all on function private.settlement_immutable()from public,anon,authenticated,service_role;
do $immutable$
declare t text;
begin
 foreach t in array array['settlement_rates','settlement_agreements','settlement_beneficiaries','settlement_statement_lines','settlement_allocations','settlement_journals','settlement_entries','settlement_requests','settlement_audit']loop
  execute format('create trigger settlement_immutable before update or delete on private.%I for each row execute function private.settlement_immutable()',t);
 end loop;
end $immutable$;
-- Monetary facts and finalized statements cannot be rewritten, even by a
-- future caller that accidentally gains a broader internal write path.
create function private.settlement_guard_mutation()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_op='DELETE'then raise exception 'SETTLEMENT_IMMUTABLE';end if;
 if tg_table_name='settlement_receipts'then
  if(to_jsonb(new)-array['settled_at','fee_known','held','statement_id'])is distinct from(to_jsonb(old)-array['settled_at','fee_known','held','statement_id'])
   or old.statement_id is not null and new.statement_id is distinct from old.statement_id
   or old.settled_at is not null and new.settled_at is distinct from old.settled_at then raise exception 'SETTLEMENT_IMMUTABLE';end if;
 elsif tg_table_name='settlement_statements'then
  if old.state<>'draft'or(to_jsonb(new)-array['state','finalized_at','finalized_by'])is distinct from(to_jsonb(old)-array['state','finalized_at','finalized_by'])then raise exception 'SETTLEMENT_IMMUTABLE';end if;
 elsif tg_table_name='settlement_payouts'then
  if old.state not in('prepared','uncertain')or(to_jsonb(new)-array['state','bank_ref','transferred_at','confirmed_by'])is distinct from(to_jsonb(old)-array['state','bank_ref','transferred_at','confirmed_by'])then raise exception 'SETTLEMENT_IMMUTABLE';end if;
 end if;
 return new;
end$$;
revoke all on function private.settlement_guard_mutation()from public,anon,authenticated,service_role;
create trigger settlement_guard_mutation before update or delete on private.settlement_receipts for each row execute function private.settlement_guard_mutation();
create trigger settlement_guard_mutation before update or delete on private.settlement_statements for each row execute function private.settlement_guard_mutation();
create trigger settlement_guard_mutation before update or delete on private.settlement_payouts for each row execute function private.settlement_guard_mutation();

create function private.settlement_balanced()returns trigger language plpgsql set search_path=''as $$
begin
 if(select count(*)<2 or sum(signed_fils)<>0 from private.settlement_entries where journal_id=new.id)then
  raise exception 'SETTLEMENT_UNBALANCED';end if;
 return new;
end $$;
revoke all on function private.settlement_balanced()from public,anon,authenticated,service_role;
create constraint trigger settlement_balanced after insert on private.settlement_journals deferrable initially deferred
for each row execute function private.settlement_balanced();

create function private.settlement_post(p_shop uuid,p_receipt uuid,p_payout uuid,p_kind text,p_amount bigint,p_ref text,p_date timestamptz,p_reason text,p_entries jsonb,p_reverse uuid default null)returns uuid
language plpgsql set search_path=''as $$
declare operation uuid;
begin
 if(select sum(value::bigint)from jsonb_each_text(p_entries))<>0 or(select count(*)from jsonb_each(p_entries))<2 then raise exception 'SETTLEMENT_UNBALANCED';end if;
 insert into private.settlement_journals(shop_id,receipt_id,payout_id,kind,amount_fils,external_ref,occurred_at,created_by,reason,reverses_id)
 values(p_shop,p_receipt,p_payout,p_kind,p_amount,nullif(btrim(p_ref),''),p_date,auth.uid(),coalesce(p_reason,''),p_reverse)returning id into operation;
 insert into private.settlement_entries(journal_id,account,signed_fils)select operation,key,value::bigint from jsonb_each_text(p_entries);
 return operation;
end $$;
revoke all on function private.settlement_post(uuid,uuid,uuid,text,bigint,text,timestamptz,text,jsonb,uuid)from public,anon,authenticated,service_role;

create view private.settlement_receipt_state as
with money as(
 select j.receipt_id,
  -sum(e.signed_fils)filter(where e.account='shop')as net_fils,
  sum(e.signed_fils)filter(where e.account='cash')as cash_fils,
  -sum(e.signed_fils)filter(where e.account='commission')as commission_fils,
  max(j.seq)as last_seq
 from private.settlement_journals j join private.settlement_entries e on e.journal_id=j.id where j.receipt_id is not null group by j.receipt_id
), allocations as(
 select a.receipt_id,coalesce(sum(a.amount_fils)filter(where p.state='paid'),0)paid_fils,
  coalesce(sum(a.amount_fils)filter(where p.state in('prepared','uncertain')),0)reserved_fils
 from private.settlement_allocations a join private.settlement_payouts p on p.id=a.payout_id group by a.receipt_id
)
select r.*,coalesce(m.net_fils,0)::bigint net_fils,coalesce(m.cash_fils,0)::bigint cash_fils,
 coalesce(m.commission_fils,0)::bigint current_commission_fils,coalesce(m.last_seq,0)last_seq,
 coalesce(a.paid_fils,0)::bigint paid_fils,coalesce(a.reserved_fils,0)::bigint reserved_fils,
 (coalesce(m.net_fils,0)-coalesce(a.paid_fils,0)-coalesce(a.reserved_fils,0))::bigint remaining_fils,
 exists(select 1 from private.settlement_journals j where j.receipt_id=r.id and j.kind='receipt'and exists(select 1 from private.settlement_journals x where x.reverses_id=j.id))as reversed,
 (r.settled_at is not null and r.settled_at<=clock_timestamp()and r.fee_known and not r.held and b.status='completed'
  and((b.date+b.time)at time zone'Asia/Kuwait')+make_interval(mins=>b.duration)<=clock_timestamp()
  and not exists(select 1 from private.settlement_journals j where j.receipt_id=r.id and j.kind='receipt'and exists(select 1 from private.settlement_journals x where x.reverses_id=j.id)))as eligible,
 greatest(r.settled_at,((b.date+b.time)at time zone'Asia/Kuwait')+make_interval(mins=>b.duration))as eligible_at,
 b.status booking_status,b.date booking_date,b.time booking_time
from private.settlement_receipts r join public.bookings b on b.id=r.booking_id left join money m on m.receipt_id=r.id left join allocations a on a.receipt_id=r.id;
revoke all on private.settlement_receipt_state from public,anon,authenticated,service_role;

create function private.settlement_receipt_json(r private.settlement_receipt_state)returns jsonb language sql stable set search_path=''as $$
 select jsonb_build_object('id',r.id,'shopId',r.shop_id,'bookingId',r.booking_id,'bookingDate',r.booking_date,'bookingTime',r.booking_time,
 'bookingStatus',r.booking_status,'amountFils',r.amount_fils::text,'commissionFils',r.current_commission_fils::text,
 'commissionBps',r.commission_bps,'feeBearer',r.fee_bearer,'feeKnown',r.fee_known,'sourceRef',r.source_ref,
 'collectedAt',r.collected_at,'settledAt',r.settled_at,'held',r.held,'eligible',r.eligible,'reversed',r.reversed,
 'statementId',r.statement_id,'netFils',r.net_fils::text,'paidFils',r.paid_fils::text,'reservedFils',r.reserved_fils::text,
 'remainingFils',r.remaining_fils::text,'verification','admin_confirmed')
$$;
revoke all on function private.settlement_receipt_json(private.settlement_receipt_state)from public,anon,authenticated,service_role;

create function private.settlement_statement_preview(p_shop uuid,p_period date,p_cutoff timestamptz)returns jsonb language sql stable set search_path=''as $$
 with candidates as(
 select r.*,private.settlement_receipt_json(r)as payload from private.settlement_receipt_state r
 where r.shop_id=p_shop and r.statement_id is null and(
  (r.eligible and r.eligible_at<p_cutoff and(r.eligible_at at time zone'Asia/Kuwait')::date<p_period+interval'1 month')
  or r.net_fils<0)
 order by r.id limit 10001
 )select jsonb_build_object('rows',coalesce(jsonb_agg(payload order by id),'[]'),
 'totalFils',coalesce(sum(net_fils),0)::text,'count',count(*),
 'fingerprint',encode(extensions.digest(coalesce(jsonb_agg(jsonb_build_object('id',id,'seq',last_seq,'net',net_fils,'eligible',eligible,'held',held,'settled',settled_at,'status',booking_status,'date',booking_date,'time',booking_time,'eligibleAt',eligible_at)order by id),'[]')::text,'sha256'),'hex'))from candidates
$$;
revoke all on function private.settlement_statement_preview(uuid,date,timestamptz)from public,anon,authenticated,service_role;

create function private.guard_settlement_history()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if tg_op='DELETE'then
  if exists(select 1 from private.settlement_receipts where shop_id=old.id)then raise exception 'SETTLEMENT_HISTORY_PREVENTS_REMOVAL';end if;
  return old;
 end if;
 if new.branch_id is distinct from old.branch_id and exists(select 1 from private.settlement_receipts where booking_id=old.id)then raise exception 'SETTLEMENT_SHOP_CHANGE_FORBIDDEN';end if;
 return new;
end $$;
revoke all on function private.guard_settlement_history()from public,anon,authenticated,service_role;
create trigger settlement_shop_history before delete on public.branches for each row execute function private.guard_settlement_history();
create trigger settlement_booking_history before update of branch_id on public.bookings for each row execute function private.guard_settlement_history();
