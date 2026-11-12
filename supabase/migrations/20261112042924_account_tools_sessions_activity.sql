begin;

-- Independent of the deferred private-review package. Preserve existing Test history.
create table if not exists private.account_activity (
 id bigint generated always as identity primary key,
 happened_at timestamptz not null default now(),
 kind text not null check(kind in('booking_created','booking_rescheduled','booking_status_changed','shop_hours_changed','barber_schedule_changed','booking_deadlines_changed')),
 branch_id uuid, booking_id uuid, barber_id uuid, actor_user_id uuid, actor_role text
);
alter table private.account_activity enable row level security;
revoke all on private.account_activity from public,anon,authenticated,service_role;
create index if not exists account_activity_booking_idx on private.account_activity(booking_id,id desc) where booking_id is not null;
create index if not exists account_activity_branch_idx on private.account_activity(branch_id,id desc) where branch_id is not null;
create index if not exists account_activity_barber_idx on private.account_activity(barber_id,id desc) where barber_id is not null;
create index if not exists account_activity_actor_idx on private.account_activity(actor_user_id,id desc) where actor_user_id is not null;

create or replace function private.capture_account_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); role_name text;
begin
 if actor is not null then select raw_app_meta_data->>'role' into role_name from auth.users where id=actor;end if;
 if tg_table_name='bookings' then
  if tg_op='INSERT' then
   insert into private.account_activity(kind,branch_id,booking_id,barber_id,actor_user_id,actor_role)
   values('booking_created',new.branch_id,new.id,new.barber_id,coalesce(actor,new.added_by_user_id),coalesce(role_name,nullif(new.added_by_type,'system')));
  else
   if actor is null and new.modified_by_type='customer' then actor:=new.modified_by_user_id;role_name:='customer';end if;
   if row(old.date,old.time)is distinct from row(new.date,new.time) then
    insert into private.account_activity(kind,branch_id,booking_id,barber_id,actor_user_id,actor_role)values('booking_rescheduled',new.branch_id,new.id,new.barber_id,actor,role_name);
   end if;
   if old.status is distinct from new.status then
    insert into private.account_activity(kind,branch_id,booking_id,barber_id,actor_user_id,actor_role)values('booking_status_changed',new.branch_id,new.id,new.barber_id,actor,role_name);
   end if;
  end if;
 elsif tg_table_name='branches' then
  if old.working_hours is distinct from new.working_hours then
  insert into private.account_activity(kind,branch_id,actor_user_id,actor_role)values('shop_hours_changed',new.id,actor,role_name);end if;
 elsif tg_table_name='barbers' then
  if row(old.availability,old.time_offs,old.vacations)is distinct from row(new.availability,new.time_offs,new.vacations) then
  insert into private.account_activity(kind,branch_id,barber_id,actor_user_id,actor_role)values('barber_schedule_changed',new.branch_id,new.id,actor,role_name);end if;
 elsif tg_table_name='admin_settings' then
  if new.setting_key in('customer_cancel_notice_minutes','customer_reschedule_notice_minutes') and(tg_op='INSERT' or new.setting_value is distinct from old.setting_value)then
   insert into private.account_activity(kind,actor_user_id,actor_role)values('booking_deadlines_changed',actor,role_name);
  end if;
 end if;
 return new;
end $$;
revoke all on function private.capture_account_activity()from public,anon,authenticated,service_role;
drop trigger if exists capture_booking_activity on public.bookings;
create trigger capture_booking_activity after insert or update of date,time,status on public.bookings for each row execute function private.capture_account_activity();
drop trigger if exists capture_shop_hours_activity on public.branches;
create trigger capture_shop_hours_activity after update of working_hours on public.branches for each row execute function private.capture_account_activity();
drop trigger if exists capture_barber_schedule_activity on public.barbers;
create trigger capture_barber_schedule_activity after update of availability,time_offs,vacations on public.barbers for each row execute function private.capture_account_activity();
drop trigger if exists capture_deadline_activity on public.admin_settings;
create trigger capture_deadline_activity after insert or update of setting_value on public.admin_settings for each row execute function private.capture_account_activity();

-- Keep explicit revocations effective for open Realtime subscriptions after Auth cleanup.
create table if not exists private.account_revoked_sessions(session_id uuid primary key,user_id uuid not null,revoked_at timestamptz not null default now());
alter table private.account_revoked_sessions enable row level security;
revoke all on private.account_revoked_sessions from public,anon,authenticated,service_role;
create or replace function private.account_tools_session_live()returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from private.account_revoked_sessions where session_id=nullif(auth.jwt()->>'session_id','')::uuid);
$$;
revoke all on function private.account_tools_session_live()from public,anon;
grant execute on function private.account_tools_session_live()to authenticated,service_role;
do $$ declare target text;begin
 foreach target in array array['bookings','notifications','whatsapp_conversations','whatsapp_messages']loop
  if not exists(select 1 from pg_policy where polrelid=('public.'||target)::regclass and polname='Account tools live session')then
   execute format('create policy "Account tools live session" on public.%I as restrictive for select to authenticated using ((select private.account_tools_session_live()))',target);
  end if;
 end loop;
end $$;

create or replace function private.account_tools_api(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=(p_data->>'user_id')::uuid;sid uuid:=(p_data->>'session_id')::uuid;
 role_name text;profile_id uuid;canonical uuid;allowed_users uuid[];target uuid;cursor_id bigint;
 cursor_time timestamptz;session_cursor uuid;rows jsonb;current_row jsonb;more boolean;next_cursor jsonb;
begin
 select u.raw_app_meta_data->>'role' into role_name from auth.users u join auth.sessions s on s.user_id=u.id
 where u.id=viewer and s.id=sid and(s.not_after is null or s.not_after>now())
 and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
 and(u.raw_app_meta_data->>'role'<>'admin' or(p_data->>'aal'='aal2' and s.aal='aal2' and exists(select 1 from auth.mfa_factors f where f.id=s.factor_id and f.user_id=u.id and f.factor_type='totp' and f.status='verified')));
 if role_name is null then raise exception 'AUTH_REQUIRED';end if;
 if role_name not in('customer','manager','barber','admin','agent')then raise exception 'FORBIDDEN';end if;
 if p_action not in('status','sessions','revoke-session','activity')or p_action is null then raise exception 'INVALID_REQUEST';end if;
 if p_action='status' then return jsonb_build_object('accountId',viewer,'role',role_name);end if;
 canonical:=viewer;
 if role_name='customer' then select coalesce((select i.account_user_id from private.customer_social_identities i where i.user_id=viewer),viewer)into canonical;end if;
 select a.customer_id into profile_id from private.customer_accounts a where a.user_id=canonical;
 select array_agg(u.id)into allowed_users from auth.users u where u.id=viewer or(role_name='customer' and u.raw_app_meta_data->>'role'='customer' and(u.id=canonical or exists(select 1 from private.customer_social_identities i where i.user_id=u.id and i.account_user_id=canonical)));
 if p_action in('sessions','revoke-session')then
  if p_action='revoke-session' then
   target:=(p_data->>'targetId')::uuid;
   if target is null then raise exception 'INVALID_REQUEST';end if;
   if target=sid then raise exception 'USE_SIGN_OUT_FOR_CURRENT_SESSION';end if;
   perform pg_advisory_xact_lock(hashtextextended(viewer::text,81212));
   update auth.sessions set not_after=least(coalesce(not_after,'infinity'::timestamptz),clock_timestamp()) where id=target and user_id=any(allowed_users);
   if not found then raise exception 'SESSION_NOT_FOUND';end if;
   insert into private.account_revoked_sessions(session_id,user_id)select id,user_id from auth.sessions where id=target on conflict(session_id)do nothing;
   return jsonb_build_object('revoked',true);
  end if;
  if p_data ? 'cursor' then cursor_time:=(p_data->'cursor'->>'createdAt')::timestamptz;session_cursor:=(p_data->'cursor'->>'id')::uuid;if cursor_time is null or session_cursor is null then raise exception 'INVALID_REQUEST';end if;end if;
  select jsonb_build_object('id',s.id,'device',left(coalesce(s.user_agent,''),256),'createdAt',s.created_at,'lastActiveAt',coalesce(s.refreshed_at at time zone 'UTC',s.created_at),'current',true)into current_row from auth.sessions s where s.id=sid;
  with candidates as(select s.* from auth.sessions s where s.user_id=any(allowed_users)and s.id<>sid and(s.not_after is null or s.not_after>now())and(cursor_time is null or(s.created_at,s.id)<(cursor_time,session_cursor))order by s.created_at desc,s.id desc limit 26),page as(select * from candidates order by created_at desc,id desc limit 25)
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'device',left(coalesce(p.user_agent,''),256),'createdAt',p.created_at,'lastActiveAt',coalesce(p.refreshed_at at time zone 'UTC',p.created_at),'current',false)order by p.created_at desc,p.id desc),'[]'::jsonb),(select count(*)>25 from candidates)into rows,more from page p;
  if more then next_cursor:=jsonb_build_object('createdAt',rows->-1->'createdAt','id',rows->-1->'id');end if;
  return jsonb_build_object('currentSession',current_row,'rows',rows,'nextCursor',next_cursor);
 end if;
 if p_data->>'view'not in('customer','work')or p_data->>'view'is null then raise exception 'INVALID_REQUEST';end if;
 if p_data->>'view'='customer'and(role_name not in('customer','manager','barber')or profile_id is null)then raise exception 'FORBIDDEN';end if;
 if p_data->>'view'='work'and role_name='customer'then raise exception 'FORBIDDEN';end if;
 if p_data ? 'cursor' then cursor_id:=(p_data->>'cursor')::bigint;if cursor_id is null or cursor_id<1 then raise exception 'INVALID_REQUEST';end if;end if;
 with candidates as(
  select a.* from private.account_activity a where(cursor_id is null or a.id<cursor_id)and(
   (p_data->>'view'='customer'and a.booking_id in(select o.booking_id from private.customer_booking_owners o where o.account_user_id=canonical))or
   (p_data->>'view'='work'and(role_name='admin' or
    (role_name='manager'and a.branch_id in(select b.id from public.branches b where b.manager_id=viewer))or
    (role_name='barber'and a.barber_id in(select x.id from public.barbers x where x.user_id=viewer and x.status='active'))or
    (role_name='agent'and a.actor_user_id=viewer))))order by a.id desc limit 26
 ),page as(select * from candidates order by id desc limit 25)
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'happenedAt',e.happened_at,'kind',e.kind,'shop',b.name,'shopAr',b.name_ar,'reference',upper(left(replace(e.booking_id::text,'-',''),10)),'byYou',e.actor_user_id=viewer,'actorRole',coalesce(e.actor_role,'unknown'),'actorName',case when p_data->>'view'='work'and role_name in('admin','manager')and e.actor_role in('admin','manager','barber','agent')then left(u.raw_user_meta_data->>'name',120)end)order by e.id desc),'[]'::jsonb),(select count(*)>25 from candidates)into rows,more from page e left join public.branches b on b.id=e.branch_id left join auth.users u on u.id=e.actor_user_id;
 return jsonb_build_object('rows',rows,'nextCursor',case when more then rows->-1->'id'else null end);
end $$;
revoke all on function private.account_tools_api(text,jsonb)from public,anon,authenticated;
grant execute on function private.account_tools_api(text,jsonb)to service_role;
create or replace function public.account_tools_api(p_action text,p_data jsonb default'{}'::jsonb)returns jsonb language sql security invoker set search_path='' as $$select private.account_tools_api(p_action,p_data);$$;
revoke all on function public.account_tools_api(text,jsonb)from public,anon,authenticated;
grant execute on function public.account_tools_api(text,jsonb)to service_role;
notify pgrst,'reload schema';
commit;
