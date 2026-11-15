-- Preserve anonymous accounting history without retaining customer free text.
-- Existing migrations on hosted Test are not renamed or replayed by this change.
begin;

create index finance_request_booking_privacy on private.shop_finance_requests ((request #>> '{data,bookingId}'));
create index finance_request_entry_privacy on private.shop_finance_requests ((request #>> '{data,entryId}'));
create index finance_request_result_privacy on private.shop_finance_requests ((result ->> 'id'));
create index finance_snapshot_target_privacy on private.shop_finance_rows ((payload ->> 'targetId'));
create index finance_snapshot_reference_privacy on private.shop_finance_rows ((payload ->> 'reference'));

create function private.redact_deleted_customer_finance_entry() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.booking_id is not null and exists(select 1 from public.bookings b where b.id=new.booking_id and b.customer_deleted_at is not null)then
  new.reference:='';new.reason:='';
 end if;
 return new;
end $$;
revoke all on function private.redact_deleted_customer_finance_entry() from public,anon,authenticated,service_role;
create trigger finance_deleted_customer_text before insert or update on private.shop_finance_entries
for each row execute function private.redact_deleted_customer_finance_entry();

-- A one-way digest preserves exact retry detection without keeping request text.
create function private.redact_deleted_customer_finance_request() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.request ? '_deletedCustomerHash' then return new;end if;
 if exists(select 1 from public.bookings b where b.customer_deleted_at is not null and b.id::text=new.request #>> '{data,bookingId}')
 or exists(select 1 from private.shop_finance_entries e join public.bookings b on b.id=e.booking_id
  where b.customer_deleted_at is not null and (e.id::text=new.request #>> '{data,entryId}' or e.id::text=new.result->>'id'))then
  new.request:=jsonb_build_object('_deletedCustomerHash',encode(extensions.digest(new.request::text,'sha256'),'hex'));
 end if;
 return new;
end $$;
revoke all on function private.redact_deleted_customer_finance_request() from public,anon,authenticated,service_role;
create trigger finance_deleted_customer_request before insert or update on private.shop_finance_requests
for each row execute function private.redact_deleted_customer_finance_request();

create function private.scrub_deleted_customer_finances(p_booking_ids uuid[]) returns void
language plpgsql set search_path='' as $$
begin
 if coalesce(cardinality(p_booking_ids),0)=0 then return;end if;
 update private.shop_finance_entries set reference='',reason='' where booking_id=any(p_booking_ids);
 update private.shop_finance_requests set request=jsonb_build_object('_deletedCustomerHash',encode(extensions.digest(request::text,'sha256'),'hex'))
 where not(request ? '_deletedCustomerHash')and (
  request #>> '{data,bookingId}'=any(array(select x::text from unnest(p_booking_ids)x))
  or request #>> '{data,entryId}'in(select id::text from private.shop_finance_entries where booking_id=any(p_booking_ids))
  or result->>'id'in(select id::text from private.shop_finance_entries where booking_id=any(p_booking_ids)));
 update private.shop_finance_rows set payload=payload||jsonb_build_object('paymentReference','','reason','')
 where payload->>'targetId'=any(array(select x::text from unnest(p_booking_ids)x))
 or payload->>'reference'=any(array(select x::text from unnest(p_booking_ids)x))
 or payload->>'reference'in(select id::text from private.shop_finance_entries where booking_id=any(p_booking_ids));
end $$;
revoke all on function private.scrub_deleted_customer_finances(uuid[]) from public,anon,authenticated,service_role;

-- Patch only the reviewed bodies. Drift must stop this migration, not overwrite it.
do $migration$
declare definition text;anchor text;
begin
 if(select md5(prosrc)from pg_proc where oid='private.customer_deletion_base_v1(text,jsonb)'::regprocedure)<>'a65088f4d075d005a1617b6afd1ddfb5'then
  raise exception 'DELETION_BASE_REVIEW_REQUIRED';end if;
 definition:=pg_get_functiondef('private.customer_deletion_base_v1(text,jsonb)'::regprocedure);
 anchor:='    update private.customer_deletion_jobs set state=''cleanup_pending'',cancelled_count=count_cancelled';
 if strpos(definition,anchor)=0 then raise exception 'DELETION_HOOK_NOT_FOUND';end if;
 execute replace(definition,anchor,'    perform private.scrub_deleted_customer_finances(bids);'||chr(10)||anchor);

 if(select md5(prosrc)from pg_proc where oid='public.manager_finances(text,jsonb)'::regprocedure)<>'ef9d1eca063d71ec970160d8e022bd51'then
  raise exception 'FINANCE_BASE_REVIEW_REQUIRED';end if;
 definition:=pg_get_functiondef('public.manager_finances(text,jsonb)'::regprocedure);
 anchor:='cached.request<>jsonb_build_object(''action'',p_action,''data'',p_data)';
 if strpos(definition,anchor)=0 then raise exception 'FINANCE_RETRY_HOOK_NOT_FOUND';end if;
 execute replace(definition,anchor,'(case when cached.request ? ''_deletedCustomerHash'' then cached.request->>''_deletedCustomerHash''<>encode(extensions.digest(jsonb_build_object(''action'',p_action,''data'',p_data)::text,''sha256''),''hex'') else '||anchor||' end)');
end $migration$;

commit;
