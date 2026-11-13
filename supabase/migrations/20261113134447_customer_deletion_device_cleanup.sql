create or replace function public.customer_deletion_service(p_action text,p_data jsonb default '{}') returns jsonb
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
      return jsonb_build_object('id',j.id,'state',j.state,'created',false,'receiptBox',j.receipt_box,'email',actor->>'email','expiresAt',j.code_expires_at)||preview;
    end if;
    if (select count(*) from private.customer_deletion_jobs where user_id=u and created_at>now()-interval'1 hour')>=3 then raise exception 'RATE_LIMITED'; end if;
    insert into private.customer_deletion_jobs(id,user_id,user_ids,customer_ids,session_id,receipt_hash,receipt_box,code_hash,email_hash,code_expires_at,preview_digest,providers)
      values((p_data->>'id')::uuid,u,array(select jsonb_array_elements_text(actor->'userIds')::uuid),cids,s,p_data->>'receipt_hash',p_data->>'receipt_box',p_data->>'code_hash',encode(extensions.digest(coalesce(actor->>'email',''),'sha256'),'hex'),clock_timestamp()+interval'10 minutes',preview->>'digest',array(select jsonb_array_elements_text(actor->'providers')))returning *into j;
    return jsonb_build_object('id',j.id,'state',j.state,'created',true,'receiptBox',j.receipt_box,'email',actor->>'email','expiresAt',j.code_expires_at)||preview;
  end if;
  if p_action='confirm'then
    select coalesce(a.customer_id,d.user_id) into u from private.customer_deletion_jobs d left join private.customer_accounts a
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
      code_hash=null,email_hash=null,password_attempt=null,verified_until=null,preview_digest=null,receipt_box=null where id<>j.id and user_id=any(ids);
    select coalesce(array_agg(id),'{}')into bids from public.bookings where customer_id=any(cids)
      or id in(select booking_id from private.customer_booking_owners where account_user_id=any(ids));
    select coalesce(array_agg(distinct lower(email))filter(where email_confirmed_at is not null and email is not null),'{}')into emails from auth.users where id=any(ids);
    select coalesce(array_agg(distinct '+'||ltrim(phone,'+'))filter(where phone_confirmed_at is not null and phone is not null),'{}')into phones from auth.users where id=any(ids);
    update auth.users set banned_until=clock_timestamp()+interval'100 years'where id=any(ids);
    delete from auth.refresh_tokens where user_id=any(array(select x::text from unnest(ids)x));
    -- Session deletion detaches push devices, so remove owned registrations first.
    delete from private.customer_push_devices where account_id=any(ids);
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
    update private.customer_deletion_jobs set state='cleanup_pending',cancelled_count=count_cancelled,code_hash=null,verified_until=null,session_id=null,receipt_box=null,
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


