begin;
-- Keep the original combined records as history; new decisions address one component.
alter table private.availability_requests
 add column category text not null default 'legacy' check(category in('legacy','hours','break','vacation')),
 add column target_key text,
 add column base_value jsonb,
 add column requested_value jsonb,
 add column approved_value jsonb,
 add column legacy_source_id uuid references private.availability_requests(id) on delete set null;
drop index private.availability_one_pending;
create unique index availability_pending_item on private.availability_requests(barber_id,category,target_key) where status='pending' and category<>'legacy';
create index availability_requests_barber_created on private.availability_requests(barber_id,created_at desc);
create index availability_requests_legacy_source on private.availability_requests(legacy_source_id) where legacy_source_id is not null;

create function private.normalized_availability(p_value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:=p_value; field text; hours jsonb; normalized_hours jsonb:='{}'; day text; enabled boolean;
begin
 foreach day in array array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] loop
  hours:=p_value->'availability'->day; enabled:=coalesce(hours->>'enabled',hours->>'available','false')='true';
  normalized_hours:=normalized_hours||jsonb_build_object(day,jsonb_build_object('enabled',enabled,
   'start',case when enabled then hours->>'start' else '09:00' end,'end',case when enabled then hours->>'end' else '18:00' end));
 end loop;
 result:=result||jsonb_build_object('availability',normalized_hours);
 foreach field in array array['time_offs','vacations'] loop
  result:=jsonb_set(result,array[field],coalesce((select jsonb_agg(value||jsonb_build_object('id',coalesce(nullif(value->>'id',''),'legacy-'||md5(value::text))) order by ord)
   from jsonb_array_elements(coalesce(p_value->field,'[]')) with ordinality x(value,ord)),'[]'));
 end loop;
 return result;
end $$;
create function private.valid_availability_items(p_value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare normalized jsonb; field text;
begin
 if private.valid_availability(p_value) is not true then return false;end if;
 normalized:=private.normalized_availability(p_value);
 foreach field in array array['time_offs','vacations'] loop
  if exists(select 1 from jsonb_array_elements(normalized->field) x where length(x->>'id') not between 1 and 120)
   or jsonb_array_length(normalized->field)<>(select count(distinct x->>'id') from jsonb_array_elements(normalized->field) x) then return false;end if;
 end loop;return true;
exception when others then return false;
end $$;
create function private.availability_part(p_snapshot jsonb,p_category text,p_key text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare snapshot jsonb:=private.normalized_availability(p_snapshot); field text;
begin
 if p_category='hours' then return jsonb_build_object('availability',snapshot->'availability','max_booking_days',snapshot->'max_booking_days');end if;
 field:=case p_category when 'break' then 'time_offs' when 'vacation' then 'vacations' end;
 if field is null then raise exception 'INVALID_REQUEST';end if;
 return (select value from jsonb_array_elements(snapshot->field) where value->>'id'=p_key);
end $$;
create function private.apply_availability_part(p_snapshot jsonb,p_category text,p_key text,p_value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:=private.normalized_availability(p_snapshot); field text; items jsonb; present boolean;
begin
 if p_category='hours' then
  if p_key<>'working-hours' or jsonb_typeof(p_value) is distinct from 'object' then raise exception 'INVALID_REQUEST';end if;
  return result||jsonb_build_object('availability',p_value->'availability','max_booking_days',p_value->'max_booking_days');
 end if;
 field:=case p_category when 'break' then 'time_offs' when 'vacation' then 'vacations' end;
 if field is null or (p_value is not null and (jsonb_typeof(p_value)<>'object' or p_value->>'id' is distinct from p_key)) then raise exception 'INVALID_REQUEST';end if;
 select coalesce(jsonb_agg(case when value->>'id'=p_key then p_value else value end order by ord) filter(where value->>'id'<>p_key or p_value is not null),'[]'),
  coalesce(bool_or(value->>'id'=p_key),false) into items,present from jsonb_array_elements(result->field) with ordinality x(value,ord);
 if not present and p_value is not null then items:=items||jsonb_build_array(p_value);end if;
 return jsonb_set(result,array[field],items);
end $$;
create function private.availability_changes(p_before jsonb,p_after jsonb)
returns table(category text,target_key text,base_value jsonb,requested_value jsonb)
language plpgsql immutable set search_path='' as $$
declare old_data jsonb:=private.normalized_availability(p_before); new_data jsonb:=private.normalized_availability(p_after); kind text; field text; item_key text;
begin
 category:='hours';target_key:='working-hours';base_value:=private.availability_part(old_data,category,target_key);requested_value:=private.availability_part(new_data,category,target_key);
 if base_value is distinct from requested_value then return next;end if;
 foreach kind in array array['break','vacation'] loop
  field:=case kind when 'break' then 'time_offs' else 'vacations' end;
  for item_key in select distinct value->>'id' from jsonb_array_elements((old_data->field)||(new_data->field)) loop
   category:=kind;target_key:=item_key;base_value:=private.availability_part(old_data,kind,item_key);requested_value:=private.availability_part(new_data,kind,item_key);
   if base_value is distinct from requested_value then return next;end if;
  end loop;
 end loop;
end $$;
create function private.availability_pending_token(p_barber uuid) returns text
language sql stable set search_path='' as $$ select md5(coalesce(string_agg(id::text,',' order by id),'')) from private.availability_requests where barber_id=p_barber and status='pending' and category<>'legacy'; $$;
create function private.availability_draft(p_barber public.barbers) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb:=private.normalized_availability(private.availability_snapshot(p_barber)); item record;
begin
 for item in select * from private.availability_requests where barber_id=p_barber.id and branch_id=p_barber.branch_id and status='pending' and category<>'legacy' order by created_at,id loop
  result:=private.apply_availability_part(result,item.category,item.target_key,item.requested_value);
 end loop;return result;
end $$;
create function private.submit_availability_items(p_barber public.barbers,p_proposal jsonb,p_source uuid default null) returns jsonb
language plpgsql set search_path='' as $$
declare change record; old_item private.availability_requests%rowtype; item private.availability_requests%rowtype;
 keys text[]:='{}'; result jsonb:='[]'; created jsonb:='[]'; normalized jsonb:=private.normalized_availability(p_proposal);
begin
 for change in select * from private.availability_changes(private.availability_snapshot(p_barber),normalized) loop
  keys:=array_append(keys,change.category||':'||change.target_key);
  select * into old_item from private.availability_requests where barber_id=p_barber.id and category=change.category and target_key=change.target_key and status='pending';
  if old_item.id is not null and old_item.base_value is not distinct from change.base_value and old_item.requested_value is not distinct from change.requested_value then
   result:=result||jsonb_build_array(to_jsonb(old_item));continue;
  end if;
  update private.availability_requests set status='superseded',reviewed_at=clock_timestamp() where id=old_item.id;
  insert into private.availability_requests(barber_id,branch_id,base_revision,proposal,submitted_by,category,target_key,base_value,requested_value,legacy_source_id)
   values(p_barber.id,p_barber.branch_id,p_barber.availability_revision,normalized,coalesce(auth.uid(),p_barber.user_id),change.category,change.target_key,change.base_value,change.requested_value,p_source) returning * into item;
  result:=result||jsonb_build_array(to_jsonb(item));created:=created||jsonb_build_array(item.id);
 end loop;
 -- Returning a pending component to its approved value withdraws only that component.
 update private.availability_requests set status='superseded',reviewed_at=clock_timestamp()
 where barber_id=p_barber.id and status='pending' and category<>'legacy' and not (category||':'||target_key=any(keys));
 return jsonb_build_object('requests',result,'created',created);
end $$;
-- Split pending combined requests without applying any proposed settings or changing bookings.
do $$
declare old_request private.availability_requests%rowtype; barber public.barbers%rowtype;
begin
 for old_request in select * from private.availability_requests where status='pending' and category='legacy' order by created_at loop
  select * into barber from public.barbers where id=old_request.barber_id for update;
  update private.availability_requests set status='superseded',reviewed_at=clock_timestamp() where id=old_request.id;
  if barber.id is not null and barber.branch_id=old_request.branch_id and barber.availability_revision=old_request.base_revision then
   perform private.submit_availability_items(barber,old_request.proposal,old_request.id);
  end if;
 end loop;
end $$;

create or replace function private.availability_api(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text:=private.live_staff_role(); person uuid:=auth.uid(); b public.barbers%rowtype; req private.availability_requests%rowtype;
 v_barber_id uuid:=nullif(p_data->>'barber_id','')::uuid; request_id uuid:=nullif(p_data->>'request_id','')::uuid;
 v_proposal jsonb; candidate jsonb; part jsonb; outcome jsonb; conflicts jsonb; item record;
 skip_count integer:=coalesce((p_data->>'offset')::integer,0); note text:=trim(coalesce(p_data->>'note','')); field text;
begin
 if role_name is null or role_name not in('manager','barber') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'INVALID_REQUEST';end if;
 if p_action='list' then
  if skip_count<0 or skip_count>100000 then raise exception 'INVALID_REQUEST';end if;
  return jsonb_build_object('requests',(select coalesce(jsonb_agg(rows.item order by rows.item->>'created_at' desc,rows.item->>'id' desc),'[]') from (
   select to_jsonb(r)||jsonb_build_object('barber_name',br.name,'shop_name',sh.name) as item
   from private.availability_requests r join public.barbers br on br.id=r.barber_id join public.branches sh on sh.id=r.branch_id
   where r.category<>'legacy' and br.branch_id=r.branch_id
    and ((role_name='manager' and sh.manager_id=person) or (role_name='barber' and br.user_id=person and not br.manager_chair))
    and (nullif(p_data->>'branch_id','') is null or r.branch_id=(p_data->>'branch_id')::uuid)
    and (v_barber_id is null or r.barber_id=v_barber_id)
    and (nullif(p_data->>'status','') is null or r.status=p_data->>'status')
    and (nullif(p_data->>'category','') is null or r.category=p_data->>'category')
   order by r.created_at desc,r.id desc limit 21 offset skip_count) rows));
 end if;
 if request_id is not null then
  select * into req from private.availability_requests where id=request_id;
  if v_barber_id is not null and v_barber_id is distinct from req.barber_id then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  v_barber_id:=req.barber_id;
 end if;
 if p_action in('submit','approve','decline','direct') then select * into b from public.barbers where id=v_barber_id for update;
 else select * into b from public.barbers where id=v_barber_id;end if;
 if b.id is null or not ((role_name='manager' and exists(select 1 from public.branches where id=b.branch_id and manager_id=person))
  or (role_name='barber' and b.user_id=person and not b.manager_chair)) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if request_id is not null then
  if p_action in('approve','decline') then select * into req from private.availability_requests where id=request_id for update;
  else select * into req from private.availability_requests where id=request_id;end if;
  if req.id is null or req.branch_id<>b.branch_id then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 end if;
 if p_action='get' then
  return jsonb_build_object('barber',to_jsonb(b)||private.normalized_availability(private.availability_snapshot(b)),
   'draft',private.availability_draft(b),'draft_token',private.availability_pending_token(b.id),
   'selected_request',case when req.id is not null then to_jsonb(req) else null end,
   'pending_items',(select coalesce(jsonb_agg(to_jsonb(r) order by created_at,id),'[]') from private.availability_requests r where barber_id=b.id and branch_id=b.branch_id and status='pending' and category<>'legacy'),
   'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by created_at desc,id desc),'[]') from (select * from private.availability_requests where barber_id=b.id and branch_id=b.branch_id and category<>'legacy' order by created_at desc,id desc limit 20) r),
   'related_items',(select coalesce(jsonb_agg(to_jsonb(r) order by created_at,id),'[]') from private.availability_requests r where legacy_source_id=req.id));
 end if;
 if length(note)>500 then raise exception 'INVALID_REQUEST';end if;
 if p_action='submit' then
  if role_name<>'barber' then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  if (p_data->>'base_revision')::integer is distinct from b.availability_revision
   or (p_data ? 'draft_token' and p_data->>'draft_token' is distinct from private.availability_pending_token(b.id)) then raise exception 'AVAILABILITY_STALE';end if;
  v_proposal:=p_data->'proposal';
  if private.valid_availability_items(v_proposal) is not true then raise exception 'INVALID_BARBER_HOURS';end if;
  v_proposal:=private.normalized_availability(v_proposal);
  foreach field in array array['time_offs','vacations'] loop
   if exists(select 1 from jsonb_array_elements(v_proposal->field) x where length(x->>'id') not between 1 and 120)
    or jsonb_array_length(v_proposal->field)<>(select count(distinct x->>'id') from jsonb_array_elements(v_proposal->field) x) then raise exception 'INVALID_REQUEST';end if;
  end loop;
  if (select count(distinct created_at) from private.availability_requests where barber_id=b.id and submitted_by=person and created_at>now()-interval '1 minute')>=10 then raise exception 'RATE_LIMITED';end if;
  outcome:=private.submit_availability_items(b,v_proposal);
  for item in select * from private.availability_requests where id in(select value::uuid from jsonb_array_elements_text(outcome->'created')) loop
   perform private.deliver_dashboard_notification(gen_random_uuid(),(select manager_id from public.branches where id=b.branch_id),b.branch_id,'manager','barber_availability_updated',item.id,'availability_request',jsonb_build_object('state','pending','category',item.category,'barberId',b.id,'barberName',b.name));
  end loop;
  return outcome||jsonb_build_object('request',outcome->'requests'->0,'no_changes',jsonb_array_length(outcome->'requests')=0);
 end if;
 if role_name<>'manager' then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if p_action in('approve','decline','preview') and request_id is not null then
  if req.category='legacy' then raise exception 'AVAILABILITY_INDIVIDUAL_REVIEW_REQUIRED';end if;
  if req.status<>'pending' then raise exception 'AVAILABILITY_STALE';end if;
  if p_action='decline' then
   if length(note)<3 then raise exception 'AVAILABILITY_REASON_REQUIRED';end if;
   update private.availability_requests set status='declined',reviewed_by=person,reviewed_at=clock_timestamp(),review_note=note where id=req.id returning * into req;
  else
   if private.availability_part(private.availability_snapshot(b),req.category,req.target_key) is distinct from req.base_value then raise exception 'AVAILABILITY_STALE';end if;
   part:=case when p_data ? 'value' then nullif(p_data->'value','null'::jsonb) else req.requested_value end;
   if part is null and req.base_value is null then raise exception 'INVALID_REQUEST';end if;
   candidate:=private.apply_availability_part(private.availability_snapshot(b),req.category,req.target_key,part);
   if private.valid_availability_items(candidate) is not true then raise exception 'INVALID_BARBER_HOURS';end if;
   conflicts:=private.availability_conflicts(b.id,candidate);
   if p_action='preview' or jsonb_array_length(conflicts)>0 then return jsonb_build_object('blocked',jsonb_array_length(conflicts)>0,'conflicts',conflicts,'revision',b.availability_revision);end if;
   insert into private.availability_writes values(txid_current(),b.id);
   update public.barbers set availability=candidate->'availability',time_offs=candidate->'time_offs',vacations=candidate->'vacations',max_booking_days=(candidate->>'max_booking_days')::integer,
    availability_revision=b.availability_revision+1,
    availability_approved_at=case when req.category='hours' or b.availability_approved_at is not null then clock_timestamp() else null end where id=b.id;
   delete from private.availability_writes where transaction_id=txid_current() and barber_id=b.id;
   update private.availability_requests set status='approved',approved_value=part,approved_proposal=candidate,reviewed_by=person,reviewed_at=clock_timestamp(),review_note=nullif(note,'') where id=req.id returning * into req;
  end if;
  perform private.deliver_dashboard_notification(gen_random_uuid(),b.user_id,b.branch_id,'barber','barber_availability_updated',req.id,'availability_request',jsonb_build_object('state',req.status,'category',req.category,'barberId',b.id,'barberName',b.name));
  return jsonb_build_object('request',to_jsonb(req),'blocked',false,'conflicts','[]'::jsonb);
 end if;
 -- Manager-only approved-schedule editing and My Chair remain available outside pending ordinary-staff requests.
 if p_action in('direct','preview') and request_id is null then
  v_proposal:=p_data->'proposal';
  if private.valid_availability_items(v_proposal) is not true then raise exception 'INVALID_BARBER_HOURS';end if;
  if not b.manager_chair and exists(select 1 from private.availability_requests where barber_id=b.id and status='pending' and category<>'legacy') then raise exception 'AVAILABILITY_INDIVIDUAL_REVIEW_REQUIRED';end if;
  conflicts:=private.availability_conflicts(b.id,v_proposal);
  if p_action='preview' or jsonb_array_length(conflicts)>0 then return jsonb_build_object('blocked',jsonb_array_length(conflicts)>0,'conflicts',conflicts,'revision',b.availability_revision);end if;
  if (p_data->>'base_revision')::integer is distinct from b.availability_revision then raise exception 'AVAILABILITY_STALE';end if;
  insert into private.availability_writes values(txid_current(),b.id);
  update public.barbers set availability=v_proposal->'availability',time_offs=v_proposal->'time_offs',vacations=v_proposal->'vacations',max_booking_days=(v_proposal->>'max_booking_days')::integer,
   availability_revision=b.availability_revision+1,availability_approved_at=clock_timestamp() where id=b.id;
  delete from private.availability_writes where transaction_id=txid_current() and barber_id=b.id;
  for item in select * from private.availability_changes(private.availability_snapshot(b),v_proposal) loop
   insert into private.availability_requests(barber_id,branch_id,base_revision,proposal,approved_proposal,status,submitted_by,reviewed_by,reviewed_at,category,target_key,base_value,requested_value,approved_value)
    values(b.id,b.branch_id,b.availability_revision,v_proposal,v_proposal,'approved',person,person,clock_timestamp(),item.category,item.target_key,item.base_value,item.requested_value,item.requested_value);
  end loop;
  return jsonb_build_object('blocked',false,'conflicts','[]'::jsonb);
 end if;
 raise exception 'INVALID_REQUEST';
end $$;
-- Existing direct-write guard also refuses a batch overwrite of pending ordinary-staff items.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('private.guard_availability_write()'::regprocedure);
 if position('proposal:=private.availability_snapshot(new);' in definition)=0 then raise exception 'Availability guard changed; review migration';end if;
 execute replace(definition,'proposal:=private.availability_snapshot(new);',
  'if not new.manager_chair and exists(select 1 from private.availability_requests where barber_id=old.id and status=''pending'' and category<>''legacy'') then raise exception ''AVAILABILITY_INDIVIDUAL_REVIEW_REQUIRED'';end if; proposal:=private.availability_snapshot(new);');
end $migration$;
revoke all on function private.valid_availability_items(jsonb),private.normalized_availability(jsonb),private.availability_part(jsonb,text,text),private.apply_availability_part(jsonb,text,text,jsonb),private.availability_changes(jsonb,jsonb),private.availability_pending_token(uuid),private.availability_draft(public.barbers),private.submit_availability_items(public.barbers,jsonb,uuid) from public,anon,authenticated,service_role;
commit;
