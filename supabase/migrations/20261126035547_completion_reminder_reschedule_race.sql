begin;
-- A moved appointment must retain its newly scheduled reminder.
create or replace function private.notify_overdue_bookings() returns integer language plpgsql security definer set search_path='' set statement_timeout='25s' as $$
declare q record; b public.bookings%rowtype; recipient record; info jsonb; sent integer:=0;
begin
 for q in select * from private.booking_completion_reminders where delivered_at is null and scheduled_at<=clock_timestamp()
  order by scheduled_at,booking_id limit 200 loop
  -- Booking-before-queue matches the appointment trigger's lock order.
  select * into b from public.bookings where id=q.booking_id for update skip locked;
  if not found then continue;end if;
  perform 1 from private.booking_completion_reminders where booking_id=q.booking_id and event_id=q.event_id
   and delivered_at is null and scheduled_at<=clock_timestamp() for update;
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
commit;
