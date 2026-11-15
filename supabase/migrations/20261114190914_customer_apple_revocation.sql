begin;

-- Private opaque envelopes only. No token material is exposed to client roles.
create table private.customer_apple_credentials(
  user_id uuid not null,
  platform text not null check(platform in('ios','web')),
  subject text not null check(length(subject)between 1 and 255),
  cipher text not null check(length(cipher)between 32 and 16384),
  key_id text not null check(key_id='v1'),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(user_id,platform)
);
create table private.customer_apple_attempts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  platform text not null check(platform in('ios','web')),
  proof_hash text unique not null check(proof_hash~'^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  consumed boolean not null default false
);
create index customer_apple_attempt_owner on private.customer_apple_attempts(user_id,created_at);
create table private.customer_apple_tasks(
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references private.customer_deletion_jobs(id)on delete cascade,
  user_id uuid not null,
  platform text not null check(platform in('ios','web')),
  subject text not null,
  cipher text not null,
  key_id text not null,
  unique(job_id,user_id,platform)
);
alter table private.customer_apple_credentials enable row level security;
alter table private.customer_apple_attempts enable row level security;
alter table private.customer_apple_tasks enable row level security;
revoke all on private.customer_apple_credentials,private.customer_apple_attempts,private.customer_apple_tasks from public,anon,authenticated,service_role;
alter table private.customer_deletion_jobs add column apple_prepared boolean not null default false,
  add column apple_manual boolean not null default false,
  add column apple_token_count integer not null default 0;

-- Keep the reviewed local erasure logic intact, but hide its bypass path.
alter function public.customer_deletion_service(text,jsonb)set schema private;
alter function private.customer_deletion_service(text,jsonb)rename to customer_deletion_base_v1;
revoke all on function private.customer_deletion_base_v1(text,jsonb)from public,anon,authenticated,service_role;

create function public.customer_deletion_service(p_action text,p_data jsonb default '{}')returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='40s' as $$
declare result jsonb; actor jsonb; j private.customer_deletion_jobs%rowtype; u uuid; s uuid; v_subject text; kind text; a private.customer_apple_attempts%rowtype; task private.customer_apple_tasks%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role'then raise exception 'FORBIDDEN'using errcode='42501';end if;
  if p_action in('apple-subject','apple-reserve','apple-store')then
    u:=(p_data->>'user_id')::uuid;s:=(p_data->>'session_id')::uuid;kind:=p_data->>'platform';
    if kind not in('ios','web')or kind is null then raise exception 'INVALID_REQUEST';end if;
    -- Same serialization fence used when credentials are frozen for deletion.
    perform pg_advisory_xact_lock(hashtextextended('apple-credential:'||u::text,0));
    if not public.customer_session_is_live(u,s)or not exists(select 1 from auth.users where id=u and raw_app_meta_data->>'role'in('customer','manager','barber'))then raise exception 'AUTH_REQUIRED';end if;
    select coalesce(nullif(identity_data->>'sub',''),provider_id)into v_subject from auth.identities where user_id=u and provider='apple';
    if v_subject is null then raise exception 'APPLE_PROOF_INVALID';end if;
    if p_action='apple-subject'then
      return jsonb_build_object('subject',v_subject,'registered',exists(select 1 from private.customer_apple_credentials where user_id=u and platform=kind and customer_apple_credentials.subject=v_subject));
    elsif p_action='apple-reserve'then
      if coalesce(p_data->>'proof_hash','')!~'^[0-9a-f]{64}$'then raise exception 'INVALID_REQUEST';end if;
      delete from private.customer_apple_attempts where created_at<clock_timestamp()-interval'1 day';
      if(select count(*)from private.customer_apple_attempts where user_id=u and created_at>clock_timestamp()-interval'1 hour')>=5 then raise exception 'RATE_LIMITED';end if;
      if exists(select 1 from private.customer_apple_attempts where proof_hash=p_data->>'proof_hash')then raise exception 'APPLE_PROOF_INVALID';end if;
      insert into private.customer_apple_attempts(user_id,session_id,platform,proof_hash)values(u,s,kind,p_data->>'proof_hash')returning *into a;
      return jsonb_build_object('attempt',a.id);
    else
      select *into a from private.customer_apple_attempts where id=(p_data->>'attempt')::uuid for update;
      if not found or a.user_id<>u or a.session_id<>s or a.platform<>kind or a.consumed or a.created_at<clock_timestamp()-interval'2 minutes'then raise exception 'APPLE_PROOF_INVALID';end if;
      if length(coalesce(p_data->>'cipher',''))not between 32 and 16384 or p_data->>'key_id'is distinct from'v1'then raise exception 'INVALID_REQUEST';end if;
      insert into private.customer_apple_credentials(user_id,platform,subject,cipher,key_id)values(u,kind,v_subject,p_data->>'cipher',p_data->>'key_id')
        on conflict(user_id,platform)do update set subject=excluded.subject,cipher=excluded.cipher,key_id=excluded.key_id,updated_at=clock_timestamp();
      update private.customer_apple_attempts set consumed=true where id=a.id;
      return jsonb_build_object('registered',true);
    end if;
  end if;
  if p_action='apple-complete'then
    select *into j from private.customer_deletion_jobs where id=(p_data->>'id')::uuid for update;
    if not found or j.state<>'cleanup_pending'or j.lease_id is distinct from(p_data->>'lease')::uuid or j.leased_until<=clock_timestamp()then return 'false'::jsonb;end if;
    delete from private.customer_apple_tasks where id=(p_data->>'task')::uuid and job_id=j.id returning *into task;
    return to_jsonb(found);
  end if;
  if p_action='confirm'then
    -- Lock the job before the same account fences to serialize retries.
    select *into j from private.customer_deletion_jobs where id=(p_data->>'id')::uuid for update;
    for u in select x from unnest(j.user_ids)x order by x loop
      perform pg_advisory_xact_lock(hashtextextended('apple-credential:'||u::text,0));
    end loop;
  elsif p_action='finish'then
    select *into j from private.customer_deletion_jobs where id=(p_data->>'id')::uuid for update;
    if j.lease_id is not distinct from(p_data->>'lease')::uuid and exists(select 1 from private.customer_apple_tasks where job_id=j.id)then raise exception 'CLEANUP_PENDING';end if;
  end if;
  result:=private.customer_deletion_base_v1(p_action,p_data);
  if p_action='preview'then
    actor:=private.deletion_actor((p_data->>'user_id')::uuid,(p_data->>'session_id')::uuid);
    return result||jsonb_build_object('appleRevocation',case when exists(select 1 from auth.identities i where i.user_id in(select value::uuid from jsonb_array_elements_text(actor->'userIds'))and i.provider='apple')and not exists(select 1 from auth.identities i where i.user_id in(select value::uuid from jsonb_array_elements_text(actor->'userIds'))and i.provider='apple'and not exists(select 1 from private.customer_apple_credentials c where c.user_id=i.user_id and c.subject=coalesce(nullif(i.identity_data->>'sub',''),i.provider_id)))then'registered'else'manual_required'end);
  end if;
  if p_action='confirm'and result->>'state'='cleanup_pending'then
    select *into j from private.customer_deletion_jobs where id=(result->>'id')::uuid for update;
    if not j.apple_prepared then
      insert into private.customer_apple_tasks(job_id,user_id,platform,subject,cipher,key_id)
        select j.id,c.user_id,c.platform,c.subject,c.cipher,c.key_id from private.customer_apple_credentials c where c.user_id=any(j.user_ids);
      update private.customer_deletion_jobs set apple_prepared=true,
        apple_manual=exists(select 1 from auth.identities i where i.user_id=any(j.user_ids)and i.provider='apple'and not exists(select 1 from private.customer_apple_credentials c where c.user_id=i.user_id and c.subject=coalesce(nullif(i.identity_data->>'sub',''),i.provider_id))),
        apple_token_count=(select count(*)from private.customer_apple_tasks where job_id=j.id)where id=j.id;
      delete from private.customer_apple_credentials where user_id=any(j.user_ids);
      delete from private.customer_apple_attempts where user_id=any(j.user_ids);
    end if;
  elsif p_action='claim'and result<>'null'::jsonb then
    return result||jsonb_build_object('appleTasks',(select coalesce(jsonb_agg(to_jsonb(t)),'[]')from private.customer_apple_tasks t where job_id=(result->>'id')::uuid));
  elsif p_action='status'then
    select *into j from private.customer_deletion_jobs where id=(result->>'id')::uuid;
    if j.parent_id is not null then select *into j from private.customer_deletion_jobs where id=j.parent_id;end if;
    return result||jsonb_build_object('appleManualRevocation',case when j.apple_prepared then j.apple_manual else 'apple'=any(j.providers)end,
      'appleRevocation',case when not'Apple'=any(j.providers)and not'apple'=any(j.providers)then'not_applicable'
        when exists(select 1 from private.customer_apple_tasks where job_id=j.id)then'pending'
        when not j.apple_prepared or j.apple_manual then'manual_required'
        when j.apple_token_count>0 then'revoked'else'manual_required'end);
  end if;
  return result;
end $$;
revoke all on function public.customer_deletion_service(text,jsonb)from public,anon,authenticated;
grant execute on function public.customer_deletion_service(text,jsonb)to service_role;

commit;
