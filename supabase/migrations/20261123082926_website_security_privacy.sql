begin;
set local lock_timeout = '5s';

DROP POLICY "Barbers can view bookings in their branch" ON public.bookings;
CREATE POLICY "Barbers can view own bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."barbers" "r"
  WHERE (("r"."id" = "bookings"."barber_id") AND ("r"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (NOT "r"."manager_chair")))));

create or replace function private.staff_contact(p_code text,p_phone text,p_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text:=private.live_staff_role(); e164 text; c public.customers%rowtype;
begin
  if role_name not in ('manager','barber','admin','agent') or role_name is null then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  e164:=private.canonical_phone(p_phone,p_code);
  if e164 is null or e164 !~ '^\+(965[569][0-9]{7}|9665[0-9]{8}|9715[0-9]{8}|973[0-9]{8}|974[3567][0-9]{7}|968[79][0-9]{7})$' then raise exception 'INVALID_PHONE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('manager-contact:'||e164,0));
  select * into c from public.customers where country_code=p_code and phone=substring(e164 from length(p_code)+1);
  if c.id is null and p_name is not null then
    if length(trim(p_name)) not between 2 and 120 then raise exception 'INVALID_CUSTOMER_NAME'; end if;
    insert into public.customers(name,country_code,phone,created_by_type,created_by_user_id)
      values(trim(p_name),p_code,substring(e164 from length(p_code)+1),case when role_name='agent' then 'whatsapp_agent' else role_name end,auth.uid()) returning * into c;
  end if;
  if c.id is null or (p_name is null and not public.staff_can_read_customer(c.id)) then return null; end if;
  if c.status<>'active' then raise exception 'CUSTOMER_UNAVAILABLE'; end if;
  return jsonb_build_object('id',c.id,'name',c.name,'country_code',c.country_code,'phone',c.phone);
end $$;

-- Unverified phone details on email guest bookings are booking contacts.
ALTER TABLE public.customers ADD COLUMN booking_contact_phone text;

create function private.clear_deleted_booking_contact() returns trigger
language plpgsql set search_path='' as $$
begin
  new.booking_contact_phone := null;
  return new;
end;
$$;
revoke all on function private.clear_deleted_booking_contact() from public,anon,authenticated,service_role;
create trigger clear_deleted_booking_contact before update on public.customers
for each row when (new.account_deleted_at is not null) execute function private.clear_deleted_booking_contact();

-- Only migrate contacts with clear email-guest provenance and no account or
-- other booking using that customer as its canonical contact.
update public.customers c set booking_contact_phone=c.phone,phone=null
where c.phone is not null and c.account_deleted_at is null and c.created_by_type='customer'
  and c.created_by_user_id is null and c.email is not null
  and exists(select 1 from private.customer_booking_email_context x where x.customer_id=c.id and x.guest)
  and not exists(select 1 from private.customer_accounts a where a.customer_id=c.id)
  and not exists(select 1 from public.bookings b where b.customer_id=c.id
    and not exists(select 1 from private.customer_booking_email_context x where x.booking_id=b.id and x.guest));

do $patch$
declare definition text:=pg_get_functiondef('public.customer_booking(text,jsonb)'::regprocedure); updated text;
begin
  updated:=replace(definition,$old$and phone is not distinct from v_phone and country_code = v_code$old$,$new$and country_code = v_code and (case when coalesce(v_email_guest,false)
          then coalesce(booking_contact_phone,phone) else phone end) is not distinct from v_phone$new$);
  if definition=updated then raise exception 'Booking contact function changed'; end if;
  definition:=updated;
  updated:=replace(definition,$old$insert into public.customers(name,country_code,phone,email,preferred_branch_id,preferred_barber_id,created_by_type)
        values(v_name,v_code,v_phone,v_email,v_branch.id,v_barber.id,'customer')$old$,$new$insert into public.customers(name,country_code,booking_contact_phone,email,preferred_branch_id,preferred_barber_id,created_by_type)
        values(v_name,v_code,v_phone,v_email,v_branch.id,v_barber.id,'customer')$new$);
  if definition=updated then raise exception 'Booking contact function changed'; end if;
  definition:=updated;
  execute definition;
end $patch$;

ALTER TABLE public.logs ADD COLUMN server_verified boolean DEFAULT false NOT NULL;
DROP POLICY "Users insert own logs" ON public.logs;
CREATE POLICY "Users insert own logs" ON "public"."logs" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND (NOT "server_verified")));

CREATE OR REPLACE FUNCTION "public"."detect_suspicious_login_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare recent_failures integer;
begin
  if not new.server_verified or new.log_type <> 'auth' or new.action <> 'login_failure' or new.user_id is null then
    return new;
  end if;
  select count(*) into recent_failures from public.logs where user_id=new.user_id
    and server_verified and log_type='auth' and action='login_failure'
    and created_at>now()-interval '15 minutes';
  if recent_failures in (5,7,10) then
    insert into public.suspicious_activities(user_id,activity_type,severity,description,metadata)
      values(new.user_id,'multiple_failed_logins',
        case recent_failures when 10 then 'critical' when 7 then 'high' else 'medium' end,
        'Multiple failed login attempts detected (' || recent_failures || ' in 15 minutes)',
        jsonb_build_object('failure_count',recent_failures,'last_attempt',now()));
  end if;
  return new;
end
$$;

CREATE OR REPLACE FUNCTION "public"."record_server_login_failure"("p_email" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  insert into public.logs(user_id,level,log_type,action,message,server_verified)
  select id,'warning','auth','login_failure','Password sign-in rejected',true
  from auth.users where lower(email)=lower(p_email) and deleted_at is null
    and (banned_until is null or banned_until<=now());
$$;
revoke all on function public.record_server_login_failure(text) from public,anon,authenticated;
grant execute on function public.record_server_login_failure(text) to service_role;

select cron.schedule('customer-auth-limit-retention','31 * * * *',
  'delete from private.customer_auth_limits where window_start < now() - interval ''1 day''');
notify pgrst,'reload schema';
commit;
