begin;
-- Independent of provider configuration. Deploying this migration alone changes
-- no checkout behavior; activate email_only explicitly on the chosen environment.
create table private.customer_checkout_runtime (
  singleton boolean primary key default true check(singleton),
  policy text not null default 'standard' check(policy in ('standard','email_only')),
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.customer_checkout_runtime enable row level security;
revoke all on private.customer_checkout_runtime from public,anon,authenticated;
insert into private.customer_checkout_runtime(singleton) values(true);

create function public.customer_checkout_policy() returns text
language sql stable security definer set search_path='' as $$
  select policy from private.customer_checkout_runtime where singleton;
$$;
revoke all on function public.customer_checkout_policy() from public,anon,authenticated;
grant execute on function public.customer_checkout_policy() to service_role;

create function public.configure_customer_checkout_policy(p_policy text) returns text
language plpgsql security definer set search_path='' as $$
begin
  if p_policy is null or p_policy not in ('standard','email_only') then raise exception 'INVALID_REQUEST'; end if;
  update private.customer_checkout_runtime set policy=p_policy,updated_at=clock_timestamp() where singleton;
  if not found then raise exception 'UNAVAILABLE'; end if;
  return p_policy;
end $$;
revoke all on function public.configure_customer_checkout_policy(text) from public,anon,authenticated;
grant execute on function public.configure_customer_checkout_policy(text) to service_role;

-- Patch only contact validation in the canonical booking routine. Availability,
-- package quotes, immutable IDs, native closures and price checks are retained.
do $patch$
declare definition text:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure); updated text;
begin
 updated:=replace(definition,$old$  v_email_guest boolean;$old$,$new$  v_email_guest boolean;
  v_email_account boolean := false;$new$);
 if updated=definition then raise exception 'Checkout declaration changed';end if; definition:=updated;
 updated:=replace(definition,$old$    v_email := lower(btrim(p_data->>'email'));$old$,$new$    v_email := lower(btrim(p_data->>'email'));
    v_email_account := public.customer_checkout_policy()='email_only' and nullif(p_data->>'account_user_id','') is not null;
    if v_email_account then
      -- Live canonical ownership is mandatory, including for an idempotent retry.
      v_customer:=private.resolve_booking_customer((p_data->>'account_user_id')::uuid,(p_data->>'session_id')::uuid);
      select lower(u.email) into v_email from auth.users u where u.id=(p_data->>'account_user_id')::uuid and u.email_confirmed_at is not null;
      if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' then raise exception 'EMAIL_REQUIRED';end if;
    end if;$new$);
 if updated=definition then raise exception 'Checkout email validation changed';end if; definition:=updated;
 updated:=replace(definition,$old$or (not coalesce(v_email_guest,false) and v_phone is null)$old$,$new$or (not coalesce(v_email_guest,false) and not v_email_account and v_phone is null)$new$);
 if updated=definition then raise exception 'Checkout phone validation changed';end if; definition:=updated;
 updated:=replace(definition,$old$where id=v_customer and phone=v_phone and country_code=v_code$old$,$new$where id=v_customer and phone is not distinct from v_phone and country_code=v_code$new$);
 if updated=definition then raise exception 'Checkout canonical contact changed';end if; execute updated;
end $patch$;
notify pgrst,'reload schema';
commit;
