begin;
-- A closed, uncommitted key can never be written by a delayed request.
-- No contact details, tokens, profile information or appointment content are stored.
create table if not exists private.native_booking_closures (
  booking_id uuid primary key,
  created_at timestamptz not null default now()
);
alter table private.native_booking_closures enable row level security;
revoke all on private.native_booking_closures from public,anon,authenticated;
grant select,insert on private.native_booking_closures to service_role;

create or replace function public.native_close_booking_attempt(p_booking uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if p_booking is null then raise exception 'INVALID_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_booking::text,0));
  if exists(select 1 from public.bookings where id=p_booking) then
    return jsonb_build_object('found',true,'closed',false);
  end if;
  insert into private.native_booking_closures(booking_id) values(p_booking) on conflict do nothing;
  return jsonb_build_object('found',false,'closed',true);
end;
$$;
revoke all on function public.native_close_booking_attempt(uuid) from public,anon,authenticated;
grant execute on function public.native_close_booking_attempt(uuid) to service_role;

create or replace function public.native_customer_booking(p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare receipt jsonb;
begin
  if p_action is distinct from 'book' or p_data->>'id' is null then raise exception 'INVALID_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((p_data->>'id')::uuid::text,0));
  if exists(select 1 from public.bookings where id=(p_data->>'id')::uuid) then
    return public.customer_booking(p_action,p_data);
  end if;
  if exists(select 1 from private.native_booking_closures where booking_id=(p_data->>'id')::uuid) then
    raise exception 'ATTEMPT_CLOSED';
  end if;
  receipt:=public.customer_booking(p_action,p_data);
  if p_data ? 'expected_price' or p_data ? 'expected_duration' then
    if p_data->>'expected_price' is null or p_data->>'expected_duration' is null
      or (receipt->>'price')::numeric is distinct from (p_data->>'expected_price')::numeric
      or (receipt->>'duration')::integer is distinct from (p_data->>'expected_duration')::integer then
      raise exception 'PRICE_CHANGED';
    end if;
  end if;
  return receipt;
end $$;
revoke all on function public.native_customer_booking(text,jsonb) from public,anon,authenticated;
grant execute on function public.native_customer_booking(text,jsonb) to service_role;

commit;
