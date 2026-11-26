begin;
-- Completion records are separate from gateway receipts and never change them.
create table private.booking_completion_payments (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.bookings(id) on delete cascade,
 method text not null check(method in('cash','card','transfer','other','unpaid','online','recorded','free')),
 received_fils bigint not null check(received_fils>=0),
 completed_by uuid not null, completed_at timestamptz not null default clock_timestamp(),
 transaction_id bigint not null default txid_current()
);
create index booking_completion_payment_booking on private.booking_completion_payments(booking_id,completed_at desc);
alter table private.booking_completion_payments enable row level security;
revoke all on private.booking_completion_payments from public,anon,authenticated,service_role;

create function public.staff_booking_completion(p_action text,p_booking_id uuid,p_method text default null,p_expected_due bigint default null)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare actor uuid:=auth.uid(); staff text:=private.live_staff_role(); b public.bookings%rowtype;
 shop uuid; paid bigint; due bigint; online_paid boolean; chosen text; received bigint:=0;
 last_method text;
begin
 if actor is null or staff is null or staff not in('manager','barber') or nullif(auth.jwt()->>'session_id','') is null then
  raise exception 'COMPLETION_FORBIDDEN' using errcode='42501';end if;
 if p_action is null or p_action not in('read','complete') then raise exception 'COMPLETION_INVALID';end if;
 select b0.branch_id into shop from public.bookings b0 where b0.id=p_booking_id and
  (staff='manager' and exists(select 1 from public.branches s where s.id=b0.branch_id and s.manager_id=actor)
   or staff='barber' and exists(select 1 from public.barbers r where r.id=b0.barber_id and r.branch_id=b0.branch_id and r.user_id=actor));
 if not found then raise exception 'COMPLETION_FORBIDDEN' using errcode='42501';end if;
 -- Same lock order as manager_finances: shop, then appointment.
 perform 1 from public.branches where id=shop for update;
 select * into b from public.bookings where id=p_booking_id for update;
 if b.id is null or not(staff='manager' and exists(select 1 from public.branches s where s.id=b.branch_id and s.manager_id=actor)
  or staff='barber' and exists(select 1 from public.barbers r where r.id=b.barber_id and r.branch_id=b.branch_id and r.user_id=actor)) then
  raise exception 'COMPLETION_FORBIDDEN' using errcode='42501';end if;
 if b.status not in('confirmed','completed') then raise exception 'COMPLETION_NOT_CONFIRMED';end if;
 if b.date+b.time+b.duration*interval'1 minute'>clock_timestamp() at time zone'Asia/Kuwait' then raise exception 'BOOKING_NOT_FINISHED';end if;
 if coalesce(to_jsonb(b)->>'online_payment_state','') in('pending_approval','awaiting_payment') then raise exception 'COMPLETION_NOT_CONFIRMED';end if;
 select coalesce(sum(e.signed_fils),0) into paid from private.shop_finance_entries e where e.booking_id=b.id;
 online_paid:=coalesce(to_jsonb(b)->>'online_payment_state','')='paid' or
  (b.price>0 and coalesce((select sum(r.amount_fils) from private.settlement_receipts r where r.booking_id=b.id),0)>=round(b.price*1000)::bigint);
 due:=case when online_paid then 0 else greatest(0,round(b.price*1000)::bigint-paid) end;
 select method into last_method from private.booking_completion_payments where booking_id=b.id order by completed_at desc,id limit 1;
 if p_action='read' then return jsonb_build_object('status',b.status,'onlinePaid',online_paid,'dueFils',due::text,
  'paidFils',case when online_paid then round(b.price*1000)::bigint else paid end::text,'method',last_method);end if;
 -- Retried/concurrent completion is harmless, including a lost HTTP response.
 if b.status='completed' then return jsonb_build_object('id',b.id);end if;
 if p_expected_due is distinct from due then raise exception 'COMPLETION_PAYMENT_CHANGED';end if;
 if due>0 and (p_method is null or p_method not in('cash','card','transfer','other','unpaid')) then raise exception 'COMPLETION_METHOD_REQUIRED';end if;
 chosen:=case when online_paid then 'online' when b.price=0 then 'free' when due=0 then 'recorded' else p_method end;
 if due>0 and chosen<>'unpaid' then
  received:=due;
  insert into private.shop_finance_entries(id,shop_id,booking_id,kind,amount_fils,signed_fils,occurred_on,method,reference,created_by)
   values(gen_random_uuid(),b.branch_id,b.id,'receipt',due,due,(clock_timestamp() at time zone'Asia/Kuwait')::date,chosen,'Booking completion',actor);
 end if;
 insert into private.booking_completion_payments(booking_id,method,received_fils,completed_by) values(b.id,chosen,received,actor);
 update public.bookings set status='completed',modified_by_type=staff,modified_by_user_id=actor where id=b.id;
 return jsonb_build_object('id',b.id);
end $$;
revoke all on function public.staff_booking_completion(text,uuid,text,bigint) from public,anon,service_role;
grant execute on function public.staff_booking_completion(text,uuid,text,bigint) to authenticated;

create function private.require_completion_payment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and private.live_staff_role() in('manager','barber') and new.status='completed'
  and (tg_op='INSERT' or old.status is distinct from 'completed')
  and not exists(select 1 from private.booking_completion_payments c where c.booking_id=new.id and c.completed_by=auth.uid() and c.transaction_id=txid_current()) then
  raise exception 'COMPLETION_METHOD_REQUIRED';end if;
 return new;
end $$;
revoke all on function private.require_completion_payment() from public,anon,authenticated,service_role;
create trigger require_completion_payment before insert or update on public.bookings for each row execute function private.require_completion_payment();

-- A durable queue, not a booking-status automation or customer push campaign.
create table private.booking_completion_reminders (
 booking_id uuid primary key references public.bookings(id) on delete cascade,
 scheduled_at timestamptz not null, event_id uuid not null default gen_random_uuid(), delivered_at timestamptz
);
create index booking_completion_reminder_due on private.booking_completion_reminders(scheduled_at) where delivered_at is null;
alter table private.booking_completion_reminders enable row level security;
revoke all on private.booking_completion_reminders from public,anon,authenticated,service_role;
create function private.queue_booking_completion_reminder() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'confirmed' then delete from private.booking_completion_reminders where booking_id=new.id;return null;end if;
 if tg_op='UPDATE' and row(new.date,new.time,new.duration,new.status,new.branch_id,new.barber_id)
  is not distinct from row(old.date,old.time,old.duration,old.status,old.branch_id,old.barber_id) then return null;end if;
 insert into private.booking_completion_reminders(booking_id,scheduled_at)
  values(new.id,((new.date+new.time+new.duration*interval'1 minute') at time zone'Asia/Kuwait')+interval'24 hours')
  on conflict(booking_id) do update set scheduled_at=excluded.scheduled_at,event_id=excluded.event_id,delivered_at=null;
 return null;
end $$;
revoke all on function private.queue_booking_completion_reminder() from public,anon,authenticated,service_role;
create trigger queue_booking_completion_reminder after insert or update on public.bookings for each row execute function private.queue_booking_completion_reminder();
-- Existing upcoming appointments join the queue; do not flood users with years of historical reminders.
insert into private.booking_completion_reminders(booking_id,scheduled_at)
 select id,((date+time+duration*interval'1 minute') at time zone'Asia/Kuwait')+interval'24 hours'
 from public.bookings where status='confirmed' and date+time+duration*interval'1 minute'>=clock_timestamp() at time zone'Asia/Kuwait';

create function private.notify_overdue_bookings() returns integer language plpgsql security definer set search_path='' set statement_timeout='25s' as $$
declare q record; b public.bookings%rowtype; recipient record; info jsonb; sent integer:=0;
begin
 for q in select * from private.booking_completion_reminders where delivered_at is null and scheduled_at<=clock_timestamp()
  order by scheduled_at,booking_id limit 200 loop
  -- Booking-before-queue matches the appointment trigger's lock order.
  select * into b from public.bookings where id=q.booking_id for update skip locked;
  if not found then continue;end if;
  perform 1 from private.booking_completion_reminders where booking_id=q.booking_id and delivered_at is null for update;
  if not found then continue;end if;
  if b.status='confirmed' and ((b.date+b.time+b.duration*interval'1 minute') at time zone'Asia/Kuwait')+interval'24 hours'<=clock_timestamp() then
   info:=jsonb_build_object('completionOverdue',true,'branchId',b.branch_id,'barberId',b.barber_id,'date',b.date,'time',to_char(b.time,'HH24:MI'),
    'customerName',(select name from public.customers where id=b.customer_id),'barberName',(select name from public.barbers where id=b.barber_id),
    'shopName',(select name from public.branches where id=b.branch_id));
   for recipient in select manager_id as person,id as shop,'manager'::text as role from public.branches where id=b.branch_id
    union select user_id,branch_id,'barber' from public.barbers where id=b.barber_id loop
    perform private.deliver_dashboard_notification(q.event_id,recipient.person,recipient.shop,recipient.role,'booking_status_changed',b.id,'booking',info);
   end loop;
   sent:=sent+1;
  end if;
  update private.booking_completion_reminders set delivered_at=clock_timestamp() where booking_id=q.booking_id;
 end loop;
 return sent;
end $$;
revoke all on function private.notify_overdue_bookings() from public,anon,authenticated,service_role;
select cron.schedule('staff-booking-completion-reminders','*/15 * * * *','select private.notify_overdue_bookings()');
notify pgrst,'reload schema';
commit;
