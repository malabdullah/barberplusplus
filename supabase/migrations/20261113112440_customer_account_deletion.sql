begin;

alter table public.customers add column account_deleted_at timestamptz;
alter table public.bookings add column customer_deleted_at timestamptz;

create table private.customer_deletion_jobs (
  id uuid primary key,
  parent_id uuid references private.customer_deletion_jobs(id)on delete cascade,
  user_id uuid,
  user_ids uuid[],
  customer_ids uuid[],
  session_id uuid,
  receipt_hash text not null check(receipt_hash ~ '^[0-9a-f]{64}$'),
  code_hash text,
  email_hash text,
  code_expires_at timestamptz,
  code_attempts integer not null default 0,
  mail_sends integer not null default 1,
  last_mail_at timestamptz not null default clock_timestamp(),
  verified_until timestamptz,
  password_attempt uuid,
  preview_digest text,
  providers text[] not null default '{}',
  state text not null default 'awaiting_code' check(state in('awaiting_code','verified','cleanup_pending','complete')),
  cancelled_count integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  available_at timestamptz not null default clock_timestamp(),
  lease_id uuid,
  leased_until timestamptz,
  cleanup_attempts integer not null default 0
);
create index customer_deletion_owner on private.customer_deletion_jobs(user_id,created_at desc);
create index customer_deletion_pending on private.customer_deletion_jobs(available_at) where state='cleanup_pending';
alter table private.customer_deletion_jobs enable row level security;
revoke all on private.customer_deletion_jobs from public,anon,authenticated,service_role;

create table private.customer_deletion_runtime (
  singleton boolean primary key default true check(singleton),
  function_url text,
  test_mode boolean not null default true,
  allowed_test_users uuid[] not null default '{}',
  secret text not null default encode(extensions.gen_random_bytes(32),'hex')
);
insert into private.customer_deletion_runtime(singleton)values(true);
alter table private.customer_deletion_runtime enable row level security;
revoke all on private.customer_deletion_runtime from public,anon,authenticated,service_role;

-- An account cannot keep using Storage or Realtime with a signed but revoked JWT.
create function public.account_deletion_access_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_account_session() is not null
$$;
revoke all on function public.account_deletion_access_allowed() from public,anon;
grant execute on function public.account_deletion_access_allowed() to authenticated,service_role;
create policy "Storage requires a live account session" on storage.objects as restrictive
  for all to authenticated using((select public.account_deletion_access_allowed()))
  with check((select public.account_deletion_access_allowed()));
do $$ declare target text; begin
  foreach target in array array['bookings','notifications','whatsapp_conversations','whatsapp_messages'] loop
    execute format('create policy "Realtime requires a live account session" on public.%I as restrictive for select to authenticated using ((select public.account_deletion_access_allowed()))',target);
  end loop;
end $$;

create function private.deletion_actor(p_user uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare primary_user uuid; people uuid[]; customers uuid[]; destination text; methods text[]; has_password boolean;
begin
  if not public.customer_session_is_live(p_user,p_session) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  primary_user:=coalesce((select account_user_id from private.customer_social_identities where user_id=p_user),p_user);
  select array_agg(distinct id) into people from auth.users where id=primary_user or id=p_user
    or id in(select user_id from private.customer_social_identities where account_user_id=primary_user);
  if exists(select 1 from private.customer_deletion_runtime where singleton and test_mode)and(
    exists(select 1 from unnest(people)x cross join private.customer_deletion_runtime cfg where cfg.singleton and not x=any(cfg.allowed_test_users))
    or exists(select 1 from auth.users where id=any(people)and(raw_app_meta_data->>'deletion_qa'is distinct from'true'or email not like'%@example.test'))
  )then raise exception 'TEST_ACCOUNT_ONLY';end if;
  if exists(select 1 from auth.users where id=any(people) and raw_app_meta_data->>'role' is distinct from 'customer')
    or exists(select 1 from public.barbers where user_id=any(people))
    or exists(select 1 from public.branches where manager_id=any(people))
    or exists(select 1 from public.audit_logs where admin_user_id=any(people))
    or exists(select 1 from private.shop_barber_invitations where manager_id=any(people) or accepted_user_id=any(people))
  then raise exception 'LINKED_WORK_ACCOUNT' using errcode='42501'; end if;
  select array_agg(distinct id) into customers from public.customers where id in(
    select customer_id from private.customer_accounts where user_id=any(people)
    union select b.customer_id from public.bookings b join private.customer_booking_owners o on o.booking_id=b.id where o.account_user_id=any(people)
  );
  if coalesce(cardinality(customers),0)=0 then raise exception 'PROFILE_REQUIRED'; end if;
  if exists(select 1 from private.customer_accounts where customer_id=any(customers) and not user_id=any(people)) then raise exception 'ACCOUNT_SCOPE_CONFLICT'; end if;
  if exists(select 1 from public.customers where id=any(customers) and account_deleted_at is not null) then raise exception 'DELETION_IN_PROGRESS'; end if;
  select email,coalesce(length(encrypted_password)>0,false) into destination,has_password from auth.users where id=p_user;
  if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then destination:=null; end if;
  select coalesce(array_agg(distinct provider),'{}') into methods from auth.identities where user_id=any(people);
  return jsonb_build_object('userIds',people,'customerIds',customers,'email',destination,'hasPassword',has_password,'providers',methods);
end $$;
revoke all on function private.deletion_actor(uuid,uuid) from public,anon,authenticated,service_role;

create function private.deletion_preview(p_customers uuid[]) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('upcoming',coalesce(jsonb_agg(jsonb_build_object('id',b.id,'shop',s.name,'shopAr',s.name_ar,'barber',r.name,'barberAr',r.name_ar,'date',b.date,'time',b.time)order by b.date,b.time,b.id),'[]'),
    'digest',encode(extensions.digest(coalesce(string_agg(b.id::text||':'||b.date::text||':'||b.time::text||':'||b.status,',' order by b.id),''),'sha256'),'hex'))
  from public.bookings b join public.branches s on s.id=b.branch_id join public.barbers r on r.id=b.barber_id
  where b.customer_id=any(p_customers) and b.status in('pending','confirmed') and (b.date+b.time)at time zone'Asia/Kuwait'>clock_timestamp()
$$;
revoke all on function private.deletion_preview(uuid[]) from public,anon,authenticated,service_role;

-- Prevent fresh reservations against an erased profile, including old guest receipts
-- or staff requests that were already in flight when deletion began.
create function private.guard_deleted_customer() returns trigger
language plpgsql security definer set search_path='' as $$
declare deleted_at timestamptz;
begin
  if tg_table_name='customers' then
    if new.account_deleted_at is distinct from old.account_deleted_at and auth.uid()is not null and auth.jwt()->>'role'<>'service_role'then raise exception 'ACCOUNT_DELETION_ONLY';end if;
    if old.account_deleted_at is not null and row(new.name,new.name_ar,new.email,new.phone,new.country_code,new.status,new.preferred_barber_id,new.preferred_branch_id,new.account_deleted_at)
      is distinct from row(old.name,old.name_ar,old.email,old.phone,old.country_code,old.status,old.preferred_barber_id,old.preferred_branch_id,old.account_deleted_at) then
      raise exception 'CUSTOMER_ACCOUNT_DELETED';
    end if;
    return new;
  end if;
  select account_deleted_at into deleted_at from public.customers where id=new.customer_id for key share;
  if deleted_at is not null then
    if tg_op='INSERT' or row(new.customer_id,new.branch_id,new.barber_id,new.date,new.time,new.service_ids,new.package_offer_id)
      is distinct from row(old.customer_id,old.branch_id,old.barber_id,old.date,old.time,old.service_ids,old.package_offer_id)
      or new.status in('pending','confirmed') and old.status not in('pending','confirmed') then raise exception 'CUSTOMER_ACCOUNT_DELETED'; end if;
    new.notes:=null;
    new.staff_cancellation:=null;
    new.customer_deleted_at:=deleted_at;
  elsif new.customer_deleted_at is not null and auth.uid()is not null and auth.jwt()->>'role'<>'service_role'then raise exception 'ACCOUNT_DELETION_ONLY';
  end if;
  return new;
end $$;
revoke all on function private.guard_deleted_customer() from public,anon,authenticated,service_role;
create trigger a_deleted_customer before update on public.customers for each row execute function private.guard_deleted_customer();
create trigger a_deleted_customer before insert or update on public.bookings for each row execute function private.guard_deleted_customer();
create trigger zz_erased_booking before insert or update on public.bookings for each row execute function private.guard_deleted_customer();

create function public.customer_deletion_service(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='40s' as $$
declare j private.customer_deletion_jobs%rowtype; actor jsonb; preview jsonb; u uuid; s uuid; cids uuid[]; ids uuid[]; bids uuid[]; runs uuid[];
  emails text[]; phones text[]; valid boolean; created boolean:=false; count_cancelled integer; target text; objects jsonb;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_action='runtime' then return(select jsonb_build_object('url',function_url,'secret',secret)from private.customer_deletion_runtime where singleton);end if;
  if p_action='configure' then
    if p_data->>'url' is distinct from 'https://qvkucvcjmojjbphlzlks.supabase.co/functions/v1/customer-account-deletion' then raise exception 'INVALID_REQUEST';end if;
    ids:=array(select value::uuid from jsonb_array_elements_text(coalesce(p_data->'users','[]')));
    if exists(select 1 from unnest(ids)x where not exists(select 1 from auth.users where id=x and raw_app_meta_data->>'deletion_qa'='true'and email like'%@example.test'))then raise exception 'TEST_ACCOUNT_ONLY';end if;
    update private.customer_deletion_runtime set function_url=p_data->>'url',allowed_test_users=ids where singleton;return '{}'::jsonb;
  end if;
  if p_action='batch' then
    return(select coalesce(jsonb_agg(id),'[]')from(select id from private.customer_deletion_jobs where parent_id is null and state='cleanup_pending'and available_at<=clock_timestamp()and(leased_until is null or leased_until<=clock_timestamp())order by available_at limit 3)q);
  end if;
  if p_action in('preview','start') then
    u:=(p_data->>'user_id')::uuid;s:=(p_data->>'session_id')::uuid;
    actor:=private.deletion_actor(u,s);cids:=array(select jsonb_array_elements_text(actor->'customerIds')::uuid);
    preview:=private.deletion_preview(cids);
    if p_action='preview' then return actor-'userIds'-'customerIds'||preview; end if;
    perform pg_advisory_xact_lock(hashtextextended('delete-account:'||u::text,0));
    select * into j from private.customer_deletion_jobs where id=(p_data->>'id')::uuid for update;
    if found then
      if j.user_id is distinct from u or j.session_id is distinct from s or j.state not in('awaiting_code','verified') then raise exception 'INVALID_REQUEST'; end if;
      update private.customer_deletion_jobs set receipt_hash=p_data->>'receipt_hash' where id=j.id;
      return jsonb_build_object('id',j.id,'state',j.state,'created',false,'email',actor->>'email','expiresAt',j.code_expires_at)||preview;
    end if;
    if (select count(*) from private.customer_deletion_jobs where user_id=u and created_at>now()-interval'1 hour')>=3 then raise exception 'RATE_LIMITED'; end if;
    insert into private.customer_deletion_jobs(id,user_id,user_ids,customer_ids,session_id,receipt_hash,code_hash,email_hash,code_expires_at,preview_digest,providers)
      values((p_data->>'id')::uuid,u,array(select jsonb_array_elements_text(actor->'userIds')::uuid),cids,s,p_data->>'receipt_hash',p_data->>'code_hash',encode(extensions.digest(coalesce(actor->>'email',''),'sha256'),'hex'),clock_timestamp()+interval'10 minutes',preview->>'digest',array(select jsonb_array_elements_text(actor->'providers')))returning *into j;
    return jsonb_build_object('id',j.id,'state',j.state,'created',true,'email',actor->>'email','expiresAt',j.code_expires_at)||preview;
  end if;
  if p_action='confirm'then
    select a.customer_id into u from private.customer_deletion_jobs d join private.customer_accounts a
      on a.user_id=coalesce((select account_user_id from private.customer_social_identities where user_id=d.user_id),d.user_id)
      where d.id=(p_data->>'id')::uuid and d.user_id=(p_data->>'user_id')::uuid and d.receipt_hash=p_data->>'receipt_hash';
    if u is null then raise exception 'RECEIPT_INVALID';end if;
    perform pg_advisory_xact_lock(hashtextextended('delete-customer:'||u::text,0));
  end if;
  select * into j from private.customer_deletion_jobs where id=(p_data->>'id')::uuid for update;
  if j.id is null then raise exception 'RECEIPT_INVALID'; end if;
  if p_action in('verify','password-proof','password-check','confirm','resend') then
    if j.user_id is distinct from (p_data->>'user_id')::uuid or j.session_id is distinct from(p_data->>'session_id')::uuid then raise exception 'AUTH_REQUIRED'; end if;
    if j.receipt_hash is distinct from p_data->>'receipt_hash' then raise exception 'RECEIPT_INVALID'; end if;
    actor:=private.deletion_actor(j.user_id,j.session_id);
    if j.email_hash is distinct from encode(extensions.digest(coalesce(actor->>'email',''),'sha256'),'hex')then raise exception 'REAUTH_REQUIRED';end if;
    if j.state not in('awaiting_code','verified')then raise exception 'DELETION_IN_PROGRESS';end if;
    if p_action='resend'then
      if actor->>'email'is null then raise exception 'EMAIL_UNAVAILABLE';end if;
      if j.mail_sends>=3 or j.last_mail_at>clock_timestamp()-interval'1 minute'then raise exception 'RATE_LIMITED';end if;
      update private.customer_deletion_jobs set state='awaiting_code',verified_until=null,code_attempts=0,code_hash=p_data->>'code_hash',code_expires_at=clock_timestamp()+interval'10 minutes',mail_sends=mail_sends+1,last_mail_at=clock_timestamp()where id=j.id;
      return jsonb_build_object('state','awaiting_code','email',actor->>'email','expiresAt',clock_timestamp()+interval'10 minutes');
    end if;
    if p_action='password-check'then
      if j.code_expires_at<=clock_timestamp()or j.code_attempts>=5 then return jsonb_build_object('error','CODE_EXPIRED');end if;
      update private.customer_deletion_jobs set code_attempts=code_attempts+1,password_attempt=(p_data->>'attempt')::uuid where id=j.id;
      return '{"allowed":true}'::jsonb;
    end if;
    if p_action in('verify','password-proof') then
      if j.code_expires_at<=clock_timestamp() or(p_action='verify'and j.code_attempts>=5)then return jsonb_build_object('error','CODE_EXPIRED');end if;
      if p_action='password-proof'and(j.password_attempt is null or j.password_attempt is distinct from(p_data->>'attempt')::uuid)then return jsonb_build_object('error','INVALID_CODE');end if;
      valid:=p_action='password-proof' and p_data->>'verified'='true' or p_action='verify' and j.code_hash=p_data->>'code_hash';
      update private.customer_deletion_jobs set code_attempts=code_attempts+case when p_action='verify'then 1 else 0 end,password_attempt=null,
        state=case when valid then 'verified'else state end,
        code_hash=case when valid then null else code_hash end,
        verified_until=case when valid then clock_timestamp()+interval'5 minutes'else verified_until end where id=j.id;
      return case when valid then jsonb_build_object('state','verified','expiresAt',clock_timestamp()+interval'5 minutes')else jsonb_build_object('error','INVALID_CODE')end;
    end if;
    if j.state<>'verified' or j.verified_until<=clock_timestamp()then raise exception 'REAUTH_REQUIRED';end if;
    if p_data->>'confirmCancellation' is distinct from 'true' then raise exception 'CONFIRMATION_REQUIRED';end if;
    -- Serialize role changes and new booking FKs, then recheck the complete scope.
    perform 1 from auth.users where id=any(j.user_ids)order by id for update;
    actor:=private.deletion_actor(j.user_id,j.session_id);
    if j.user_ids is distinct from array(select jsonb_array_elements_text(actor->'userIds')::uuid order by 1)
      and (select array_agg(x order by x)from unnest(j.user_ids)x) is distinct from (select array_agg(value::uuid order by value::uuid)from jsonb_array_elements_text(actor->'userIds')) then raise exception 'ACCOUNT_SCOPE_CONFLICT';end if;
    perform 1 from public.customers where id=any(j.customer_ids)order by id for update;
    if (select array_agg(x order by x)from unnest(j.customer_ids)x)is distinct from(select array_agg(value::uuid order by value::uuid)from jsonb_array_elements_text(actor->'customerIds'))then raise exception 'ACCOUNT_SCOPE_CONFLICT';end if;
    preview:=private.deletion_preview(j.customer_ids);
    if preview->>'digest' is distinct from p_data->>'digest' then
      update private.customer_deletion_jobs set preview_digest=preview->>'digest'where id=j.id;
      return jsonb_build_object('state','review_required')||preview;
    end if;
    ids:=j.user_ids;cids:=j.customer_ids;
    update private.customer_deletion_jobs set parent_id=j.id,state='cleanup_pending',user_id=null,user_ids=null,customer_ids=null,session_id=null,
      code_hash=null,email_hash=null,password_attempt=null,verified_until=null,preview_digest=null where id<>j.id and user_id=any(ids);
    select coalesce(array_agg(id),'{}')into bids from public.bookings where customer_id=any(cids)
      or id in(select booking_id from private.customer_booking_owners where account_user_id=any(ids));
    select coalesce(array_agg(distinct lower(email))filter(where email_confirmed_at is not null and email is not null),'{}')into emails from auth.users where id=any(ids);
    select coalesce(array_agg(distinct '+'||ltrim(phone,'+'))filter(where phone_confirmed_at is not null and phone is not null),'{}')into phones from auth.users where id=any(ids);
    update auth.users set banned_until='infinity'where id=any(ids);
    delete from auth.refresh_tokens where user_id=any(array(select x::text from unnest(ids)x));
    delete from auth.sessions where user_id=any(ids);
    delete from private.customer_social_identities where user_id=any(ids)or account_user_id=any(ids);
    delete from private.customer_accounts where user_id=any(ids);
    delete from private.customer_booking_owners where account_user_id=any(ids)or booking_id=any(bids);
    delete from private.customer_favourites where customer_id=any(cids);
    delete from private.customer_booking_ratings where booking_id=any(bids);
    if to_regclass('private.customer_booking_reviews')is not null then execute 'delete from private.customer_booking_reviews where booking_id=any($1)'using bids;end if;
    delete from public.customer_staff_details where customer_id=any(cids);
    delete from private.customer_phone_verifications where customer_id=any(cids);
    delete from public.notifications where recipient_user_id=any(ids)or entity_id=any(bids)or metadata::text like any(array(select '%'||x::text||'%'from unnest(cids||ids)x));
    delete from private.customer_password_requests where user_id=any(ids)or lower(email)=any(emails);
    delete from private.customer_password_proofs where user_id=any(ids);
    delete from private.account_revoked_sessions where user_id=any(ids);
    delete from private.shop_barber_invitations where accepted_user_id is null and lower(email)=any(emails);
    delete from private.customer_auth_challenges where phone_e164=any(phones)or payload::text like any(array(select '%'||x::text||'%'from unnest(ids)x));
    update public.customers set name='Deleted customer',name_ar='عميل محذوف',email=null,phone=null,country_code='',status='inactive',
      preferred_barber_id=null,preferred_branch_id=null,created_by_user_id=null,created_by_type=null,account_deleted_at=clock_timestamp()where id=any(cids);
    update public.bookings set status='cancelled',modified_by_type='customer',modified_by_user_id=null,notes=null,
      customer_deleted_at=clock_timestamp()where id=any(bids)and status in('pending','confirmed')and(date+time)at time zone'Asia/Kuwait'>clock_timestamp();
    get diagnostics count_cancelled=row_count;
    update public.bookings set notes=null,customer_deleted_at=clock_timestamp(),added_by_user_id=case when added_by_user_id=any(ids)then null else added_by_user_id end,
      modified_by_user_id=case when modified_by_user_id=any(ids)then null else modified_by_user_id end where id=any(bids);
    -- All generated cancellation deliveries are removed in this same transaction.
    delete from private.customer_booking_shares where customer_id=any(cids)or booking_id=any(bids)or account_user_id=any(ids);
    delete from private.customer_booking_share_versions where customer_id=any(cids)or booking_id=any(bids)or account_user_id=any(ids);
    delete from private.customer_booking_email_jobs where booking_id=any(bids);
    delete from private.customer_booking_email_context where customer_id=any(cids)or booking_id=any(bids);
    delete from private.customer_push_schedules where booking_id=any(bids);
    delete from private.customer_push_events where booking_id=any(bids);
    delete from private.customer_push_devices where account_id=any(ids);
    delete from private.customer_push_guests where booking_id=any(bids);
    delete from private.customer_push_preferences where account_id=any(ids);
    delete from private.announcement_deliveries where target_id in(select id from private.announcement_targets where account_id=any(ids));
    delete from private.announcement_targets where account_id=any(ids);
    delete from private.announcement_devices where account_id=any(ids);
    delete from private.announcement_preferences where account_id=any(ids);
    delete from public.booking_reminders where booking_id=any(bids);
    delete from public.logs where user_id=any(ids)or entity_id=any(bids||cids||ids)or metadata::text like any(array(select '%'||x::text||'%'from unnest(ids||cids)x));
    delete from public.audit_logs where target_user_id=any(ids)or target_entity_id=any(bids||cids||ids);
    delete from public.suspicious_activities where user_id=any(ids)or metadata::text like any(array(select '%'||x::text||'%'from unnest(ids||cids)x));
    if to_regclass('private.account_activity')is not null then execute 'delete from private.account_activity where actor_user_id=any($1)or booking_id=any($2)'using ids,bids;end if;
    delete from private.account_email_changes where user_id=any(ids);
    delete from private.admin_password_reset_guards where target_id=any(ids);
    if to_regclass('private.cloud_test_emails')is not null then execute 'delete from private.cloud_test_emails where lower(recipient)=any($1)'using emails;end if;
    -- Legacy WhatsApp history is scoped only by an Auth-verified phone, never a guessed name.
    delete from public.whatsapp_conversations where private.canonical_phone(phone_number,phone_country_code)=any(phones);
    delete from public.whatsapp_logs where private.canonical_phone(phone_number,'',true)=any(phones);
    if to_regclass('private.staff_report_rows')is not null then
      execute 'select array_agg(distinct run_id)from private.staff_report_rows where customer_id=any($1)or booking_id=any($2)'into runs using cids,bids;
      execute 'update private.staff_report_rows set shop_rating=null,barber_rating=null,payload=payload||jsonb_build_object(''customerName'',''Deleted customer'',''customerNameAr'',''عميل محذوف'',''shopRating'',null,''barberRating'',null,''accountDeleted'',true)where customer_id=any($1)or booking_id=any($2)'using cids,bids;
      execute 'delete from private.staff_report_groups where run_id=any($1)'using runs;
      execute 'update private.staff_report_runs set state=''failed'',result=null,error_code=''REPORT_SOURCE_DELETED''where id=any($1)'using runs;
    end if;
    update private.customer_deletion_jobs set state='cleanup_pending',cancelled_count=count_cancelled,code_hash=null,verified_until=null,session_id=null,
      available_at=clock_timestamp()where id=j.id;
    return jsonb_build_object('id',j.id,'state','cleanup_pending','cancelledCount',count_cancelled);
  end if;
  if p_action='status' then
    if j.receipt_hash is distinct from p_data->>'receipt_hash'then raise exception 'RECEIPT_INVALID';end if;
    if j.parent_id is not null then select *into j from private.customer_deletion_jobs where id=j.parent_id;end if;
    return jsonb_build_object('id',p_data->>'id','state',j.state,'cancelledCount',j.cancelled_count,'appleManualRevocation', 'apple'=any(j.providers));
  elsif p_action='claim' then
    if j.parent_id is not null then select *into j from private.customer_deletion_jobs where id=j.parent_id for update;end if;
    if j.state<>'cleanup_pending'or j.available_at>clock_timestamp()or j.leased_until>clock_timestamp()then return 'null'::jsonb;end if;
    update private.customer_deletion_jobs set lease_id=gen_random_uuid(),leased_until=clock_timestamp()+interval'2 minutes',cleanup_attempts=cleanup_attempts+1 where id=j.id returning *into j;
    select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'name',name)),'[]')into objects from(select bucket_id,name from storage.objects where owner_id=any(array(select x::text from unnest(j.user_ids)x))order by bucket_id,name limit 500)q;
    return jsonb_build_object('id',j.id,'lease',j.lease_id,'userIds',j.user_ids,'objects',objects);
  elsif p_action='finish' then
    if j.lease_id is distinct from(p_data->>'lease')::uuid or j.state<>'cleanup_pending'then return 'false'::jsonb;end if;
    if exists(select 1 from auth.users where id=any(j.user_ids))or exists(select 1 from storage.objects where owner_id=any(array(select x::text from unnest(j.user_ids)x)))then raise exception 'CLEANUP_PENDING';end if;
    update private.customer_deletion_jobs set state='complete',user_id=null,user_ids=null,customer_ids=null,session_id=null,code_hash=null,email_hash=null,password_attempt=null,
      preview_digest=null,lease_id=null,leased_until=null,completed_at=clock_timestamp()where id=j.id;
    return 'true'::jsonb;
  elsif p_action='retry' then
    if j.lease_id is not distinct from(p_data->>'lease')::uuid then
      update private.customer_deletion_jobs set lease_id=null,leased_until=null,available_at=clock_timestamp()+make_interval(secs=>least(3600,15*greatest(1,cleanup_attempts)))where id=j.id;
    end if;
    return '{}'::jsonb;
  end if;
  raise exception 'INVALID_REQUEST';
end $$;
revoke all on function public.customer_deletion_service(text,jsonb)from public,anon,authenticated;
grant execute on function public.customer_deletion_service(text,jsonb)to service_role;

create function private.kick_customer_deletions()returns void
language plpgsql security definer set search_path='' as $$
declare cfg private.customer_deletion_runtime%rowtype;
begin
  delete from private.customer_deletion_jobs where state in('awaiting_code','verified')and code_expires_at<clock_timestamp()-interval'1 day';
  delete from private.customer_deletion_jobs where state='complete'and completed_at<clock_timestamp()-interval'7 days';
  select *into cfg from private.customer_deletion_runtime where singleton;
  if cfg.function_url is null or not exists(select 1 from private.customer_deletion_jobs where state='cleanup_pending'and available_at<=clock_timestamp())then return;end if;
  perform net.http_post(url:=cfg.function_url,headers:=jsonb_build_object('Content-Type','application/json','x-account-deletion-worker',cfg.secret),body:='{"action":"dispatch"}'::jsonb,timeout_milliseconds:=10000);
end $$;
revoke all on function private.kick_customer_deletions()from public,anon,authenticated,service_role;
select cron.schedule('customer-deletion-cleanup','* * * * *','select private.kick_customer_deletions()');

commit;
