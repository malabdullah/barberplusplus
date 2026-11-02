-- Durable, per-person dashboard delivery. No external messaging or Auth writes.
begin;
alter table public.bookings drop constraint bookings_added_by_type_check;
alter table public.bookings add constraint bookings_added_by_type_check check (added_by_type in ('manager','barber','whatsapp_agent','admin','system','customer'));
alter table public.bookings drop constraint bookings_modified_by_type_check;
alter table public.bookings add constraint bookings_modified_by_type_check check (modified_by_type in ('manager','barber','whatsapp_agent','admin','system','customer'));

-- Resolve existing branch-addressed manager alerts to their actual recipient.
update public.notifications n set recipient_user_id=b.manager_id
from public.branches b where n.recipient_branch_id=b.id and n.recipient_role='manager' and n.recipient_user_id is null;
alter table public.notifications add column event_id uuid;
create unique index notifications_event_recipient_unique on public.notifications(event_id,recipient_user_id) where event_id is not null;

-- Preserve admin policies; replace broad branch policies with personal delivery.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='notifications' and policyname not like 'Admins %' loop
    execute format('drop policy %I on public.notifications',p.policyname);
  end loop;
end $$;
create policy notifications_read_recipient on public.notifications for select to authenticated
using (recipient_user_id=(select auth.uid()) and recipient_role=(select auth.jwt()->'app_metadata'->>'role'));
create policy notifications_update_recipient on public.notifications for update to authenticated
using (recipient_user_id=(select auth.uid()) and recipient_role=(select auth.jwt()->'app_metadata'->>'role'))
with check (recipient_user_id=(select auth.uid()) and recipient_role=(select auth.jwt()->'app_metadata'->>'role'));
revoke all on public.notifications from anon,authenticated;
grant select on public.notifications to authenticated;
grant update(is_read,read_at) on public.notifications to authenticated;

-- Private trigger helpers may read routing/preferences across tenants; no client
-- can invoke them or create notifications. All writes share the booking transaction.
create function private.dashboard_notification_enabled(p_user uuid,p_type text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select case
    when p_type in ('booking_created','booking_reminder') then p.new_bookings
    when p_type='booking_cancelled' then p.cancellations
    when p_type in ('booking_updated','booking_status_changed','booking_completed','booking_reassigned') then p.booking_updates
    when p_type in ('barber_profile_updated','barber_availability_updated') then p.barber_updates
    when p_type='barber_invite_accepted' then p.team_invites
    else p.system_alerts end from public.user_notification_preferences p where p.user_id=p_user),true)
$$;
revoke all on function private.dashboard_notification_enabled(uuid,text) from public,anon,authenticated,service_role;

create function private.deliver_dashboard_notification(p_event uuid,p_user uuid,p_branch uuid,p_role text,p_type text,p_entity uuid,p_entity_type text,p_metadata jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_user is null or p_user is not distinct from auth.uid() then return; end if;
  if not exists(select 1 from auth.users u where u.id=p_user and u.raw_app_meta_data->>'role'=p_role and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then return; end if;
  if not private.dashboard_notification_enabled(p_user,p_type) then return; end if;
  insert into public.notifications(event_id,recipient_user_id,recipient_branch_id,recipient_role,type,title,message,entity_type,entity_id,metadata)
  values(p_event,p_user,p_branch,p_role,p_type,'Appointment update','Open to view details',p_entity_type,p_entity,p_metadata||jsonb_build_object('dashboardEvent',true))
  on conflict(event_id,recipient_user_id) where event_id is not null do nothing;
end $$;
revoke all on function private.deliver_dashboard_notification(uuid,uuid,uuid,text,text,uuid,text,jsonb) from public,anon,authenticated,service_role;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in ('booking_created','booking_cancelled','booking_completed','booking_status_changed','booking_updated','booking_reassigned','booking_reminder','barber_invite_accepted','barber_availability_updated','barber_profile_updated','low_availability_warning','system_alert'));

create function private.notify_booking_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare event uuid:=gen_random_uuid(); kind text; info jsonb; recipient record;
begin
  if tg_op='INSERT' then kind:='booking_created';
  elsif row(new.branch_id,new.barber_id,new.customer_id,new.date,new.time,new.service_ids,new.duration,new.price,new.status,new.notes)
    is not distinct from row(old.branch_id,old.barber_id,old.customer_id,old.date,old.time,old.service_ids,old.duration,old.price,old.status,old.notes) then return null;
  elsif new.barber_id is distinct from old.barber_id or new.branch_id is distinct from old.branch_id then kind:='booking_reassigned';
  elsif new.status is distinct from old.status then
    kind:=case new.status when 'cancelled' then 'booking_cancelled' when 'completed' then 'booking_completed' else 'booking_status_changed' end;
  else kind:='booking_updated'; end if;
  info:=jsonb_build_object('branchId',new.branch_id,'barberId',new.barber_id,'date',new.date,'time',to_char(new.time,'HH24:MI'),'status',new.status,
    'customerName',(select c.name from public.customers c where c.id=new.customer_id),
    'barberName',(select b.name from public.barbers b where b.id=new.barber_id),
    'shopName',(select b.name from public.branches b where b.id=new.branch_id));
  -- UNION deduplicates a recipient when both old/new assignments share a manager.
  for recipient in
    select b.manager_id as user_id,b.id as branch_id,'manager'::text as role from public.branches b where b.id=new.branch_id
    union select b.user_id,b.branch_id,'barber' from public.barbers b where b.id=new.barber_id
    union select b.manager_id,b.id,'manager' from public.branches b where tg_op='UPDATE' and b.id=old.branch_id
    union select b.user_id,b.branch_id,'barber' from public.barbers b where tg_op='UPDATE' and b.id=old.barber_id
  loop
    perform private.deliver_dashboard_notification(event,recipient.user_id,recipient.branch_id,recipient.role,kind,new.id,'booking',info);
  end loop;
  return null;
end $$;
revoke all on function private.notify_booking_change() from public,anon,authenticated,service_role;
create trigger notify_booking_change after insert or update on public.bookings for each row execute function private.notify_booking_change();

-- Barber settings and invitations use the same durable delivery path.
create function private.notify_barber_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;
begin
  if new.invite_status='accepted' and old.invite_status is distinct from new.invite_status then kind:='barber_invite_accepted';
  elsif new.user_id=auth.uid() then
    if row(new.availability,new.time_offs,new.vacations) is distinct from row(old.availability,old.time_offs,old.vacations) then kind:='barber_availability_updated';
    elsif row(new.name,new.name_ar,new.avatar_url,new.phone,new.email) is distinct from row(old.name,old.name_ar,old.avatar_url,old.phone,old.email) then kind:='barber_profile_updated';
    end if;
  end if;
  if kind is not null then
    perform private.deliver_dashboard_notification(gen_random_uuid(),(select b.manager_id from public.branches b where b.id=new.branch_id),new.branch_id,'manager',kind,new.id,'barber',jsonb_build_object('barberName',new.name,'branchId',new.branch_id));
  end if;
  return null;
end $$;
revoke all on function private.notify_barber_change() from public,anon,authenticated,service_role;
create trigger notify_barber_change after update on public.barbers for each row execute function private.notify_barber_change();

-- Publication membership is required for live delivery (idempotent on replay).
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.customer_booking(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_barber public.barbers%rowtype;
  v_branch public.branches%rowtype;
  v_booking public.bookings%rowtype;
  v_services uuid[];
  v_date date;
  v_time time;
  v_today date := (current_timestamp at time zone 'Asia/Kuwait')::date;
  v_day text;
  v_schedule jsonb;
  v_hours jsonb;
  v_start time;
  v_end time;
  v_duration integer;
  v_price numeric;
  v_count integer;
  v_slots jsonb := '[]'::jsonb;
  v_customer uuid;
  v_id uuid;
  v_phone text;
  v_code text;
  v_name text;
begin
  if p_action not in ('slots', 'book') or p_action is null then
    raise exception 'INVALID_REQUEST';
  end if;
  if p_action = 'book' then
    v_id := (p_data ->> 'id')::uuid;
    v_phone := p_data ->> 'phone';
    v_code := p_data ->> 'country_code';
    v_name := trim(p_data ->> 'name');
    if v_id is null or v_name is null or length(v_name) not between 2 and 120
       or v_code is null or v_code not in ('+965','+966','+971','+973','+974','+968')
       or v_phone is null or v_phone !~ '^[0-9]{8,9}$'
       or length(coalesce(p_data ->> 'notes', '')) > 500 then
      raise exception 'INVALID_REQUEST';
    end if;
    -- Serializes retries of the same verified booking, even across barbers.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text, 0));
    select * into v_booking from public.bookings where id = v_id;
    if found then
      if not exists (select 1 from public.customers where id = v_booking.customer_id
        and phone = v_phone and country_code = v_code) then
        raise exception 'INVALID_REQUEST';
      end if;
    end if;
  end if;
  if v_booking.id is null then
    select * into v_barber from public.barbers where id = (p_data ->> 'barber_id')::uuid
      and status = 'active';
    select * into v_branch from public.branches where id = v_barber.branch_id and status = 'active';
    if v_barber.id is null or v_branch.id is null
       or v_branch.id is distinct from (p_data ->> 'branch_id')::uuid then
      raise exception 'INVALID_SELECTION';
    end if;
    select array_agg(value::uuid) into v_services
      from jsonb_array_elements_text(p_data -> 'service_ids');
    if coalesce(cardinality(v_services), 0) not between 1 and 10
       or not v_services <@ coalesce(v_barber.service_ids, '{}'::uuid[])
       or cardinality(v_services) <> (select count(distinct x) from unnest(v_services) x) then
      raise exception 'INVALID_SELECTION';
    end if;
    select count(*), sum(duration), sum(price) into v_count, v_duration, v_price
      from public.services where id = any(v_services) and branch_id = v_branch.id and status = 'active';
    if v_count <> cardinality(v_services) or v_duration not between 5 and 480 or v_price < 0 then
      raise exception 'INVALID_SELECTION';
    end if;
    v_date := (p_data ->> 'date')::date;
    if v_date is null or v_date < v_today or v_date > v_today + v_barber.max_booking_days then
      raise exception 'INVALID_DATE';
    end if;
    v_day := lower(trim(to_char(v_date, 'Day')));
    v_schedule := v_barber.availability -> v_day;
    v_hours := v_branch.working_hours -> v_day;
    if coalesce((v_schedule ->> 'enabled')::boolean, (v_schedule ->> 'available')::boolean, false)
       and not coalesce((v_hours ->> 'closed')::boolean, false)
       and not exists (
         select 1 from jsonb_array_elements(coalesce(v_barber.vacations, '[]')) x
         where v_date between (x ->> 'startDate')::date and (x ->> 'endDate')::date
       ) then
      v_start := greatest((v_schedule ->> 'start')::time, (v_hours ->> 'open')::time);
      v_end := least((v_schedule ->> 'end')::time, (v_hours ->> 'close')::time);
      if v_start is not null and v_end is not null and v_end > v_start
         and v_hours ->> 'open' is not null and v_hours ->> 'close' is not null then
        select coalesce(jsonb_agg(to_char(s, 'HH24:MI') order by s), '[]'::jsonb) into v_slots
        from generate_series(v_date + v_start, v_date + v_end - v_duration * interval '1 minute', interval '15 minutes') s
        where s at time zone 'Asia/Kuwait' > current_timestamp
          and not exists (
            select 1 from public.bookings b where b.barber_id = v_barber.id and b.date = v_date
              and b.status not in ('cancelled','no_show')
              and tsrange(b.date + b.time, b.date + b.time + b.duration * interval '1 minute', '[)')
                && tsrange(s, s + v_duration * interval '1 minute', '[)')
          )
          and not exists (
            select 1 from jsonb_array_elements(coalesce(v_barber.time_offs, '[]')) x
            where ((x ->> 'type' = 'one-time' and x ->> 'date' = v_date::text)
              or (x ->> 'type' = 'recurring' and x ->> 'day' = v_day))
              and tsrange(v_date + (x ->> 'start')::time, v_date + (x ->> 'end')::time, '[)')
                && tsrange(s, s + v_duration * interval '1 minute', '[)')
          );
      end if;
    end if;
    if p_action = 'slots' then
      return jsonb_build_object('slots', v_slots, 'duration', v_duration, 'price', v_price,
        'today', v_today, 'last_date', v_today + v_barber.max_booking_days);
    end if;
    v_time := (p_data ->> 'time')::time;
    if v_time is null or not v_slots ? to_char(v_date + v_time, 'HH24:MI') then
      raise exception 'SLOT_UNAVAILABLE';
    end if;
    if nullif(p_data->>'account_user_id','') is not null then
      v_customer:=private.resolve_booking_customer((p_data->>'account_user_id')::uuid,(p_data->>'session_id')::uuid);
      if not exists(select 1 from public.customers where id=v_customer and phone=v_phone and country_code=v_code) then raise exception 'INVALID_REQUEST'; end if;
    else
      -- Guests reuse a contact without editing it or acquiring its history.
      insert into public.customers(name,country_code,phone,preferred_branch_id,preferred_barber_id,created_by_type)
        values(v_name,v_code,v_phone,v_branch.id,v_barber.id,'customer') on conflict(country_code,phone) do nothing;
      select id into v_customer from public.customers where country_code=v_code and phone=v_phone and status='active';
      if v_customer is null then raise exception 'BOOKING_UNAVAILABLE'; end if;
    end if;
    insert into public.bookings (id, branch_id, barber_id, service_ids, customer_id, date, time,
      duration, price, status, notes, added_by_type)
    values (v_id, v_branch.id, v_barber.id, v_services, v_customer, v_date, v_time,
      v_duration, v_price, 'confirmed', nullif(trim(p_data ->> 'notes'), ''), 'customer') returning * into v_booking;
  end if;
  if p_action = 'book' and nullif(p_data->>'account_user_id','') is not null then
    perform private.record_customer_booking_owner(v_booking.id, (p_data->>'account_user_id')::uuid, (p_data->>'session_id')::uuid);
  end if;
  return (
    select jsonb_build_object('id', b.id, 'reference', upper(left(replace(b.id::text, '-', ''), 10)),
      'date', b.date, 'time', to_char(b.date + b.time, 'HH24:MI'), 'duration', b.duration, 'price', b.price,
      'status', b.status, 'branch_name', br.name, 'branch_name_ar', br.name_ar,
      'barber_name', ba.name, 'barber_name_ar', ba.name_ar, 'address', br.address,
      'location_url', br.location_url, 'service_names', (select jsonb_agg(jsonb_build_object('name', s.name, 'name_ar', s.name_ar))
        from public.services s where s.id = any(b.service_ids)))
    from public.bookings b join public.branches br on br.id = b.branch_id
      join public.barbers ba on ba.id = b.barber_id where b.id = v_booking.id
  );
end;
$function$;

-- A consumed booking-specific challenge proves origin. A customer FK or account
-- ownership alone does not: staff can also book for an existing customer.
update public.bookings b set added_by_type='customer'
where b.added_by_type='system' and b.added_by_user_id is null and exists(
  select 1 from private.customer_auth_challenges ch where ch.purpose='booking'
    and ch.consumed_at is not null and ch.payload->>'id'=b.id::text
);
commit;
