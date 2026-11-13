-- Keep record-variable names distinct from table names.
create or replace function private.deletion_actor(p_user uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare primary_user uuid; people uuid[]; subject_customers uuid[]; destination text; methods text[]; has_password boolean;
begin
  if not public.customer_session_is_live(p_user,p_session) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  primary_user:=coalesce((select account_user_id from private.customer_social_identities where user_id=p_user),p_user);
  select array_agg(distinct id) into people from auth.users where id=primary_user or id=p_user
    or id in(select user_id from private.customer_social_identities where account_user_id=primary_user);
  if exists(select 1 from private.customer_deletion_runtime where singleton and test_mode)and(
    exists(select 1 from unnest(people)x cross join private.customer_deletion_runtime cfg where cfg.singleton and not x=any(cfg.allowed_test_users))
    or exists(select 1 from auth.users where id=any(people)and(raw_app_meta_data->>'deletion_qa'is distinct from'true'or coalesce(email,'') not like'%@example.test'))
  )then raise exception 'TEST_ACCOUNT_ONLY';end if;
  if exists(select 1 from auth.users where id=any(people) and raw_app_meta_data->>'role' is distinct from 'customer')
    or exists(select 1 from public.barbers where user_id=any(people))
    or exists(select 1 from public.branches where manager_id=any(people))
    or exists(select 1 from public.audit_logs where admin_user_id=any(people))
    or exists(select 1 from private.shop_barber_invitations where manager_id=any(people) or accepted_user_id=any(people))
  then raise exception 'LINKED_WORK_ACCOUNT' using errcode='42501'; end if;
  select coalesce(array_agg(distinct id),'{}') into subject_customers from public.customers where id in(
    select customer_id from private.customer_accounts where user_id=any(people)
    union select b.customer_id from public.bookings b join private.customer_booking_owners o on o.booking_id=b.id where o.account_user_id=any(people)
  );
  if exists(select 1 from private.customer_accounts where customer_id=any(subject_customers) and not user_id=any(people)) then raise exception 'ACCOUNT_SCOPE_CONFLICT'; end if;
  if exists(select 1 from public.customers where id=any(subject_customers) and account_deleted_at is not null) then raise exception 'DELETION_IN_PROGRESS'; end if;
  select email,coalesce(length(encrypted_password)>0,false) into destination,has_password from auth.users where id=p_user;
  if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then destination:=null; end if;
  select coalesce(array_agg(distinct provider),'{}') into methods from auth.identities where user_id=any(people);
  return jsonb_build_object('userIds',people,'customerIds',subject_customers,'email',destination,'hasPassword',has_password,'providers',methods);
end $$;
revoke all on function private.deletion_actor(uuid,uuid) from public,anon,authenticated,service_role;

