begin;
alter table public.barbers add column availability_revision integer not null default 0;
alter table public.barbers add column availability_approved_at timestamptz default now();
create table private.availability_requests (
 id uuid primary key default gen_random_uuid(), barber_id uuid not null references public.barbers(id) on delete cascade,
 branch_id uuid not null references public.branches(id) on delete cascade,
 base_revision integer not null, proposal jsonb not null, approved_proposal jsonb, status text not null default 'pending'
 check(status in('pending','approved','declined','superseded')),
 submitted_by uuid references auth.users(id) on delete set null, reviewed_by uuid references auth.users(id) on delete set null,
 review_note text check(length(review_note)<=500), created_at timestamptz not null default now(), reviewed_at timestamptz
);
create unique index availability_one_pending on private.availability_requests(barber_id) where status='pending';
create index availability_requests_shop_created on private.availability_requests(branch_id,created_at desc);
alter table private.availability_requests enable row level security;
revoke all on private.availability_requests from public,anon,authenticated,service_role;
create table private.availability_writes (transaction_id bigint not null,barber_id uuid not null,primary key(transaction_id,barber_id));
alter table private.availability_writes enable row level security;
revoke all on private.availability_writes from public,anon,authenticated,service_role;

create function private.availability_snapshot(p_barber public.barbers) returns jsonb
language sql immutable set search_path='' as $$ select jsonb_build_object('availability',p_barber.availability,'time_offs',coalesce(p_barber.time_offs,'[]'),'vacations',coalesce(p_barber.vacations,'[]'),'max_booking_days',p_barber.max_booking_days); $$;
create function private.valid_availability(p_data jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 return jsonb_typeof(p_data)='object' and private.valid_schedule(p_data->'availability',true)
  and p_data ? 'time_offs' and p_data ? 'vacations' and p_data ? 'max_booking_days'
  and private.valid_time_off(p_data->'time_offs',false) and private.valid_time_off(p_data->'vacations',true)
  and (p_data->>'max_booking_days')::integer between 1 and 365;
exception when others then return false;
end $$;
create function private.appointment_fits_availability(p_booking public.bookings,p_data jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare dow text:=lower(trim(to_char(p_booking.date,'day'))); hours jsonb:=p_data->'availability'->dow;
 starts timestamp:=p_booking.date+p_booking.time; ends timestamp:=p_booking.date+p_booking.time+p_booking.duration*interval '1 minute';
begin
 if coalesce(hours->>'enabled',hours->>'available','false')<>'true' or hours->>'start' is null or hours->>'end' is null
  or p_booking.time<(hours->>'start')::time or ends>p_booking.date+(hours->>'end')::time then return false;end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_data->'vacations','[]')) v where p_booking.date between (v->>'startDate')::date and (v->>'endDate')::date)
  or exists(select 1 from jsonb_array_elements(coalesce(p_data->'time_offs','[]')) x where
   ((x->>'type'='one-time' and x->>'date'=p_booking.date::text) or (x->>'type'='recurring' and x->>'day'=dow))
   and tsrange(p_booking.date+(x->>'start')::time,p_booking.date+(x->>'end')::time,'[)') && tsrange(starts,ends,'[)')) then return false;end if;
 return true;
end $$;
create function private.availability_conflicts(p_barber uuid,p_data jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'date',b.date,'time',to_char(b.time,'HH24:MI'),
  'duration',b.duration,'customer_name',c.name,'status',b.status) order by b.date,b.time,b.id),'[]')
 from public.bookings b left join public.customers c on c.id=b.customer_id
 where b.barber_id=p_barber and b.status in('pending','confirmed')
  and b.date+b.time+b.duration*interval '1 minute'>(clock_timestamp() at time zone 'Asia/Kuwait')
  and not private.appointment_fits_availability(b,p_data);
$$;

create function private.guard_availability_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare role_name text:=private.live_staff_role(); permitted boolean; proposal jsonb; request_id uuid;
begin
 if tg_op='INSERT' then
  if auth.uid() is not null and auth.jwt()->>'role'='authenticated' and not new.manager_chair then
   new.availability:='{}';new.time_offs:='[]';new.vacations:='[]';new.availability_revision:=0;new.availability_approved_at:=null;
  end if;return new;
 end if;
 if new.branch_id is distinct from old.branch_id and not new.manager_chair then
  if auth.uid() is not null and auth.jwt()->>'role'='authenticated' and not
   (role_name='manager' and exists(select 1 from public.branches where id=old.branch_id and manager_id=auth.uid())
    and exists(select 1 from public.branches where id=new.branch_id and manager_id=auth.uid()))
   and not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  new.availability:='{}';new.time_offs:='[]';new.vacations:='[]';new.availability_approved_at:=null;new.availability_revision:=old.availability_revision+1;
  update private.availability_requests set status='superseded',reviewed_at=clock_timestamp() where barber_id=old.id and status='pending';
  return new;
 end if;
 if (new.availability,new.time_offs,new.vacations,new.max_booking_days,new.availability_revision,new.availability_approved_at)
  is not distinct from (old.availability,old.time_offs,old.vacations,old.max_booking_days,old.availability_revision,old.availability_approved_at) then return new;end if;
 if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then return new;end if;
 permitted:=exists(select 1 from private.availability_writes where transaction_id=txid_current() and barber_id=new.id);
 if permitted then return new;end if;
 if role_name is distinct from 'manager' or not exists(select 1 from public.branches where id=old.branch_id and manager_id=auth.uid())
  or new.branch_id is distinct from old.branch_id or new.availability_revision<>old.availability_revision
  or new.availability_approved_at is distinct from old.availability_approved_at then raise exception 'AVAILABILITY_APPROVAL_REQUIRED' using errcode='42501';end if;
 proposal:=private.availability_snapshot(new);
 if private.valid_availability(proposal) is not true then raise exception 'INVALID_BARBER_HOURS';end if;
 if jsonb_array_length(private.availability_conflicts(old.id,proposal))>0 then raise exception 'AVAILABILITY_BOOKINGS_CONFLICT';end if;
 new.availability_revision:=old.availability_revision+1;new.availability_approved_at:=clock_timestamp();
 update private.availability_requests set status='superseded',reviewed_at=clock_timestamp(),reviewed_by=auth.uid() where barber_id=old.id and status='pending';
 insert into private.availability_requests(barber_id,branch_id,base_revision,proposal,status,submitted_by,reviewed_by,reviewed_at)
 values(old.id,old.branch_id,old.availability_revision,proposal,'approved',auth.uid(),auth.uid(),clock_timestamp()) returning id into request_id;
 perform private.deliver_dashboard_notification(gen_random_uuid(),new.user_id,new.branch_id,'barber','barber_availability_updated',request_id,'availability_request',jsonb_build_object('state','approved','barberId',new.id,'barberName',new.name));
 return new;
end $$;
create trigger a_availability_workflow before insert or update on public.barbers for each row execute function private.guard_availability_write();

create function private.availability_api(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text:=private.live_staff_role(); person uuid:=auth.uid(); b public.barbers%rowtype; req private.availability_requests%rowtype;
 v_proposal jsonb; conflicts jsonb; request_id uuid:=nullif(p_data->>'request_id','')::uuid;
 v_barber_id uuid:=nullif(p_data->>'barber_id','')::uuid; skip_count integer:=coalesce((p_data->>'offset')::integer,0); note text:=trim(coalesce(p_data->>'note',''));
begin
 if role_name is null or role_name not in('manager','barber') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if p_action='list' then
  if skip_count<0 or skip_count>100000 then raise exception 'INVALID_REQUEST';end if;
  return jsonb_build_object('requests',(select coalesce(jsonb_agg(item order by item->>'created_at' desc,item->>'id' desc),'[]') from (
   select to_jsonb(r)||jsonb_build_object('barber_name',br.name,'shop_name',sh.name) as item
   from private.availability_requests r join public.barbers br on br.id=r.barber_id join public.branches sh on sh.id=r.branch_id
   where br.branch_id=r.branch_id and ((role_name='manager' and sh.manager_id=person) or (role_name='barber' and br.user_id=person and not br.manager_chair))
    and (nullif(p_data->>'branch_id','') is null or r.branch_id=(p_data->>'branch_id')::uuid)
    and (nullif(p_data->>'status','') is null or r.status=p_data->>'status')
   order by r.created_at desc,r.id desc limit 21 offset skip_count
  ) rows));
 end if;
 if request_id is not null then
  select * into req from private.availability_requests where id=request_id;
  if v_barber_id is not null and v_barber_id is distinct from req.barber_id then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  v_barber_id:=req.barber_id;
 end if;
 -- All writes lock the same barber before the request. Booking creation takes a shared barber lock.
 if p_action in('submit','approve','decline','direct') then select * into b from public.barbers where id=v_barber_id for update;
 else select * into b from public.barbers where id=v_barber_id;end if;
 if b.id is null or not ((role_name='manager' and exists(select 1 from public.branches where id=b.branch_id and manager_id=person))
  or (role_name='barber' and b.user_id=person and not b.manager_chair)) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if request_id is not null then
  select * into req from private.availability_requests where id=request_id for update;
  if req.id is null or req.branch_id<>b.branch_id then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 end if;
 if p_action='get' then
  return jsonb_build_object('barber',to_jsonb(b),'selected_request',case when req.id is not null then to_jsonb(req) else null end,'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]') from
   (select * from private.availability_requests where barber_id=b.id and branch_id=b.branch_id order by created_at desc,id desc limit 10) r));
 end if;
 if length(note)>500 then raise exception 'INVALID_REQUEST';end if;
 v_proposal:=coalesce(p_data->'proposal',req.proposal);
 if p_action<>'decline' and private.valid_availability(v_proposal) is not true then raise exception 'INVALID_BARBER_HOURS';end if;
 if p_action='submit' then
  if role_name<>'barber' then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  if (p_data->>'base_revision')::integer is distinct from b.availability_revision then raise exception 'AVAILABILITY_STALE';end if;
  select * into req from private.availability_requests where barber_id=b.id and status='pending' for update;
  if req.id is not null and req.base_revision=b.availability_revision and req.proposal=v_proposal then return jsonb_build_object('request',to_jsonb(req));end if;
  if (select count(*) from private.availability_requests where barber_id=b.id and created_at>now()-interval '1 minute')>=10 then raise exception 'RATE_LIMITED';end if;
  update private.availability_requests set status='superseded',reviewed_at=clock_timestamp() where barber_id=b.id and status='pending';
  insert into private.availability_requests(barber_id,branch_id,base_revision,proposal,submitted_by)
  values(b.id,b.branch_id,b.availability_revision,v_proposal,person) returning * into req;
  perform private.deliver_dashboard_notification(gen_random_uuid(),(select manager_id from public.branches where id=b.branch_id),b.branch_id,'manager','barber_availability_updated',req.id,'availability_request',jsonb_build_object('state','pending','barberId',b.id,'barberName',b.name));
  return jsonb_build_object('request',to_jsonb(req));
 end if;
 if role_name<>'manager' then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if request_id is not null and (req.status<>'pending' or req.base_revision<>b.availability_revision) then raise exception 'AVAILABILITY_STALE';end if;
 if p_action='decline' then
  if req.id is null or length(note)<3 then raise exception 'AVAILABILITY_REASON_REQUIRED';end if;
  update private.availability_requests set status='declined',reviewed_by=person,reviewed_at=clock_timestamp(),review_note=note where id=req.id returning * into req;
 elsif p_action in('preview','approve','direct') then
  if p_action in('approve','direct') and (p_data->>'base_revision')::integer is distinct from b.availability_revision then raise exception 'AVAILABILITY_STALE';end if;
  conflicts:=private.availability_conflicts(b.id,v_proposal);
  if p_action='preview' or jsonb_array_length(conflicts)>0 then return jsonb_build_object('blocked',jsonb_array_length(conflicts)>0,'conflicts',conflicts,'revision',b.availability_revision);end if;
  if p_action='approve' and req.id is null then raise exception 'INVALID_REQUEST';end if;
  if p_action='direct' then
   update private.availability_requests set status='superseded',reviewed_at=clock_timestamp(),reviewed_by=person where barber_id=b.id and status='pending';
   insert into private.availability_requests(barber_id,branch_id,base_revision,proposal,status,submitted_by,reviewed_by,reviewed_at,review_note)
    values(b.id,b.branch_id,b.availability_revision,v_proposal,'approved',person,person,clock_timestamp(),nullif(note,'')) returning * into req;
  else update private.availability_requests set approved_proposal=v_proposal,status='approved',reviewed_by=person,reviewed_at=clock_timestamp(),review_note=nullif(note,'') where id=req.id returning * into req;end if;
  insert into private.availability_writes values(txid_current(),b.id);
  update public.barbers set availability=v_proposal->'availability',time_offs=v_proposal->'time_offs',vacations=v_proposal->'vacations',max_booking_days=(v_proposal->>'max_booking_days')::integer,
   availability_revision=b.availability_revision+1,availability_approved_at=clock_timestamp() where id=b.id;
  delete from private.availability_writes where transaction_id=txid_current() and barber_id=b.id;
 else raise exception 'INVALID_REQUEST';end if;
 perform private.deliver_dashboard_notification(gen_random_uuid(),b.user_id,b.branch_id,'barber','barber_availability_updated',req.id,'availability_request',jsonb_build_object('state',req.status,'barberId',b.id,'barberName',b.name));
 return jsonb_build_object('request',to_jsonb(req),'conflicts','[]'::jsonb,'blocked',false);
end $$;
create function public.barber_availability(p_action text,p_data jsonb default '{}') returns jsonb
language sql security definer set search_path='' as $$ select private.availability_api(p_action,p_data); $$;
revoke all on function public.barber_availability(text,jsonb) from public,anon;
grant execute on function public.barber_availability(text,jsonb) to authenticated;
revoke all on function private.availability_snapshot(public.barbers),private.valid_availability(jsonb),private.appointment_fits_availability(public.bookings,jsonb),private.availability_conflicts(uuid,jsonb),private.guard_availability_write(),private.availability_api(text,jsonb) from public,anon,authenticated,service_role;
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('private.guard_manager_catalogue()'::regprocedure);
 if position('if not exists(select 1 from jsonb_each(new.availability)' in definition)=0 then raise exception 'Catalogue guard definition changed; review migration';end if;
 execute replace(definition,'if not exists(select 1 from jsonb_each(new.availability)','if new.availability_approved_at is not null and not exists(select 1 from jsonb_each(new.availability)');
 definition:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure);
 if position('and status = ''active'';' in definition)=0 then raise exception 'Customer booking definition changed; review migration';end if;
 execute replace(definition,'and status = ''active'';','and status = ''active'' for share;');
end $migration$;
commit;
