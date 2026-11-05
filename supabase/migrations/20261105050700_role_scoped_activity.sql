begin;

create table private.account_activity (
  id bigint generated always as identity primary key,
  happened_at timestamptz not null default now(),
  kind text not null check (kind in ('booking_created','booking_rescheduled','booking_status_changed','shop_hours_changed','barber_schedule_changed','booking_deadlines_changed')),
  branch_id uuid,
  booking_id uuid,
  barber_id uuid,
  actor_user_id uuid,
  actor_role text
);
alter table private.account_activity enable row level security;
revoke all on private.account_activity from public, anon, authenticated, service_role;
create index account_activity_booking_idx on private.account_activity (booking_id, id desc) where booking_id is not null;
create index account_activity_branch_idx on private.account_activity (branch_id, id desc) where branch_id is not null;
create index account_activity_barber_idx on private.account_activity (barber_id, id desc) where barber_id is not null;
create index account_activity_actor_idx on private.account_activity (actor_user_id, id desc) where actor_user_id is not null;

create function private.capture_account_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  role_name text;
begin
  if actor is not null then
    select raw_app_meta_data->>'role' into role_name from auth.users where id=actor;
  end if;
  if tg_table_name='bookings' then
    if tg_op='INSERT' then
      insert into private.account_activity(kind,branch_id,booking_id,barber_id,actor_user_id,actor_role)
      values('booking_created',new.branch_id,new.id,new.barber_id,coalesce(actor,new.added_by_user_id),
        coalesce(role_name,nullif(new.added_by_type,'system')));
    else
      if actor is null and new.modified_by_type='customer' then
        actor := new.modified_by_user_id;
        role_name := 'customer';
      end if;
      if row(old.date,old.time) is distinct from row(new.date,new.time) then
        insert into private.account_activity(kind,branch_id,booking_id,barber_id,actor_user_id,actor_role)
        values('booking_rescheduled',new.branch_id,new.id,new.barber_id,actor,role_name);
      end if;
      if old.status is distinct from new.status then
        insert into private.account_activity(kind,branch_id,booking_id,barber_id,actor_user_id,actor_role)
        values('booking_status_changed',new.branch_id,new.id,new.barber_id,actor,role_name);
      end if;
    end if;
  elsif tg_table_name='branches' then
    if old.working_hours is distinct from new.working_hours then
      insert into private.account_activity(kind,branch_id,actor_user_id,actor_role)
      values('shop_hours_changed',new.id,actor,role_name);
    end if;
  elsif tg_table_name='barbers' then
    if row(old.availability,old.time_offs,old.vacations) is distinct from row(new.availability,new.time_offs,new.vacations) then
      insert into private.account_activity(kind,branch_id,barber_id,actor_user_id,actor_role)
      values('barber_schedule_changed',new.branch_id,new.id,actor,role_name);
    end if;
  elsif tg_table_name='admin_settings' then
    if new.setting_key in ('customer_cancel_notice_minutes','customer_reschedule_notice_minutes') and
      (tg_op='INSERT' or new.setting_value is distinct from old.setting_value) then
      insert into private.account_activity(kind,actor_user_id,actor_role)
      values('booking_deadlines_changed',actor,role_name);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.capture_account_activity() from public, anon, authenticated, service_role;
create trigger capture_booking_activity after insert or update of date,time,status on public.bookings
for each row execute function private.capture_account_activity();
create trigger capture_shop_hours_activity after update of working_hours on public.branches
for each row execute function private.capture_account_activity();
create trigger capture_barber_schedule_activity after update of availability,time_offs,vacations on public.barbers
for each row execute function private.capture_account_activity();
create trigger capture_deadline_activity after insert or update of setting_value on public.admin_settings
for each row execute function private.capture_account_activity();

create function public.account_activity(p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  viewer uuid := auth.uid();
  viewer_role text;
  customer_account uuid;
begin
  perform public.enforce_account_session();
  if private.current_account_session() is null then raise sqlstate 'PT401' using message='SESSION_ENDED'; end if;
  select raw_app_meta_data->>'role' into viewer_role from auth.users where id=viewer;
  if viewer_role='customer' then
    select coalesce((select account_user_id from private.customer_social_identities where user_id=viewer), viewer)
      into customer_account;
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',e.id,'happened_at',e.happened_at,'kind',e.kind,
      'shop',b.name,'shop_ar',b.name_ar,
      'reference',upper(left(replace(e.booking_id::text,'-',''),10)),
      'actor_role',coalesce(e.actor_role,case when e.kind='booking_created' and own.booking_id is not null then 'customer' end),
      'actor_name',case when e.actor_user_id=viewer then null
        when viewer_role in ('admin','manager') and e.actor_role in ('admin','manager','barber','agent','whatsapp_agent')
        then left(u.raw_user_meta_data->>'name',120) end,
      'by_you',coalesce(e.actor_user_id=viewer,false) or (viewer_role='customer' and e.kind='booking_created' and
        e.actor_role is null and own.account_user_id=customer_account)
    ) order by e.id desc), '[]'::jsonb)
    from (
      select a.* from private.account_activity a
      where (p_before is null or a.id<p_before) and (
        viewer_role='admin' or
        (viewer_role='manager' and a.branch_id in (select public.get_user_branch_ids())) or
        (viewer_role='barber' and a.barber_id in (
          select x.id from public.barbers x where x.user_id=viewer and x.status='active'
        )) or
        (viewer_role='agent' and a.actor_user_id=viewer) or
        (viewer_role='customer' and a.booking_id in (
          select o.booking_id from private.customer_booking_owners o where o.account_user_id=customer_account
        ))
      )
      order by a.id desc limit 25
    ) e
    left join public.branches b on b.id=e.branch_id
    left join private.customer_booking_owners own on own.booking_id=e.booking_id
    left join auth.users u on u.id=e.actor_user_id
  );
end;
$$;
revoke all on function public.account_activity(bigint) from public, anon, service_role;
grant execute on function public.account_activity(bigint) to authenticated;

commit;
