begin;
create table private.admin_invitations(
 id uuid primary key default gen_random_uuid(),email text not null,name text not null,
 token_hash text not null check(token_hash~'^[0-9a-f]{64}$'),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',last_sent_at timestamptz not null default now(),
 sends integer not null default 1,state text not null default 'pending' check(state in('pending','processing','accepted','cancelled')),
 delivery text not null default 'pending' check(delivery in('pending','sent','failed')),
 operation uuid,lease_until timestamptz,accepted_user_id uuid references auth.users(id)
);
create unique index admin_invitation_email_pending on private.admin_invitations(lower(email))where state in('pending','processing');
create table private.admin_deletions(
 user_id uuid primary key references auth.users(id),operation uuid not null unique default gen_random_uuid(),
 actor uuid not null references auth.users(id),state text not null default 'pending'check(state in('pending','done')),
 created_at timestamptz not null default now()
);
alter table private.admin_invitations enable row level security;
alter table private.admin_deletions enable row level security;
revoke all on private.admin_invitations,private.admin_deletions from public,anon,authenticated,service_role;
create function private.admin_inviter_allowed(person uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from auth.users u where u.id=person and u.raw_app_meta_data->>'role'='admin'
 and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
 and exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified'and f.factor_type='totp'));
$$;
revoke all on function private.admin_inviter_allowed(uuid)from public,anon,authenticated,service_role;

-- Correct the existing address validator before using the shared audited writer.
do $$begin execute replace(pg_get_functiondef('private.write_account_email(uuid,text,uuid,text,text)'::regprocedure),
 chr(92)||chr(92)||'.','[.]');end $$;

create or replace function public.manage_administrators(p_action text,p_data jsonb default '{}')returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor uuid:=auth.uid();target auth.users%rowtype;inv private.admin_invitations%rowtype;
 page_number integer;rows jsonb;more boolean;address text;full_name text;result jsonb;job private.admin_deletions%rowtype;
begin
 perform public.enforce_account_session();
 if not public.is_super_admin()then raise exception 'SUPER_ADMIN_REQUIRED'using errcode='42501';end if;
 if p_action='list'then
  page_number:=coalesce((p_data->>'page')::integer,1);
  if page_number<1 or page_number>10000 then raise exception 'INVALID_REQUEST';end if;
  with directory as(
   select u.id,u.email,coalesce(u.raw_user_meta_data->>'name','')as name,
    case when u.raw_app_meta_data->>'role'='admin'then 'super_admin'else 'admin'end as role,
    coalesce(u.banned_until<=now(),true)as enabled,u.created_at,'account'::text as kind,
    case when d.state='pending'then 'deleting'when u.banned_until>now()then 'inactive'else 'active'end as status
   from auth.users u left join private.admin_deletions d on d.user_id=u.id
   where u.deleted_at is null and u.raw_app_meta_data->>'role'in('admin','agent')
   union all
   select i.id,i.email,i.name,'admin',false,i.created_at,'invitation',
    case when i.expires_at<=now()then 'expired'when i.state='processing'and i.lease_until>now()then 'processing'
     when i.delivery='failed'then 'failed'else 'invited'end
   from private.admin_invitations i where i.state in('pending','processing')
  ),candidates as(select *from directory order by created_at desc,id limit 26 offset(page_number-1)*25),
  page as(select *from candidates order by created_at desc,id limit 25)
  select coalesce(jsonb_agg(to_jsonb(page)order by created_at desc,id),'[]'),(select count(*)>25 from candidates)
   into rows,more from page;
  return jsonb_build_object('users',rows,'hasMore',more);
 end if;
 if p_action='add'then raise exception 'DIRECT_INVITATION_REQUIRED';end if;
 if p_action='invite'then
  address:=lower(trim(p_data->>'email'));full_name:=trim(p_data->>'name');
  if address is null or length(address)>254 or address!~'^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
   or full_name is null or length(full_name)not between 2 and 120
   or coalesce(p_data->>'tokenHash','')!~'^[0-9a-f]{64}$'then raise exception 'INVALID_DETAILS';end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-invite:'||address,0));
  select *into target from auth.users where deleted_at is null and lower(email)=address for update;
  if(target.id is not null and(target.raw_app_meta_data->>'role'is distinct from 'admin_invited' or target.email_confirmed_at is not null
   or not exists(select 1 from private.admin_invitations prior where prior.id::text=target.raw_app_meta_data->>'admin_invitation_id' and prior.state='cancelled'and prior.email=address)))
   or exists(select 1 from auth.identities where lower(identity_data->>'email')=address and user_id is distinct from target.id)then raise exception 'EMAIL_IN_USE';end if;
  if exists(select 1 from private.admin_invitations where lower(email)=address and state in('pending','processing'))then raise exception 'INVITE_EXISTS';end if;
  if(select count(*)from private.admin_invitations where created_by=actor and created_at>now()-interval'1 hour')>=20 then raise exception 'RATE_LIMITED';end if;
  insert into private.admin_invitations(email,name,token_hash,created_by)values(address,full_name,p_data->>'tokenHash',actor)returning *into inv;
  if target.id is not null then update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('admin_invitation_id',inv.id)where id=target.id;end if;
  insert into public.audit_logs(admin_user_id,action_type,target_entity_type,target_entity_id,metadata)
   values(actor,'user_updated','admin_invitation',inv.id,'{"event":"invited"}');
  return jsonb_build_object('id',inv.id,'email',inv.email,'name',inv.name);
 end if;
 if p_action in('resend','cancel')then
  select *into inv from private.admin_invitations where id=(p_data->>'id')::uuid for update;
  if inv.id is null or inv.state not in('pending','processing')then raise exception 'INVITE_INVALID';end if;
  if inv.state='processing'and inv.lease_until>now()then raise exception 'INVITE_PROCESSING';end if;
  if p_action='cancel'then
   update private.admin_invitations set state='cancelled',operation=null,lease_until=null where id=inv.id;
  else
   if coalesce(p_data->>'tokenHash','')!~'^[0-9a-f]{64}$'then raise exception 'INVALID_REQUEST';end if;
   if inv.sends>=10 or(inv.last_sent_at>now()-interval'60 seconds'and inv.delivery<>'failed')then raise exception 'RATE_LIMITED';end if;
   update private.admin_invitations set token_hash=p_data->>'tokenHash',state='pending',operation=null,lease_until=null,
    last_sent_at=now(),expires_at=now()+interval'7 days',delivery='pending',sends=sends+1,created_by=actor where id=inv.id;
  end if;
  insert into public.audit_logs(admin_user_id,action_type,target_entity_type,target_entity_id,metadata)
   values(actor,'user_updated','admin_invitation',inv.id,jsonb_build_object('event',p_action));
  return jsonb_build_object('id',inv.id,'email',inv.email,'name',inv.name);
 end if;
 if p_action='delete-prepare'then
  select *into job from private.admin_deletions where user_id=(p_data->>'userId')::uuid;
  if job.user_id is not null and exists(select 1 from auth.users where id=job.user_id and deleted_at is not null)then
   return jsonb_build_object('operation',job.operation,'userId',job.user_id,'finished',job.state='done','authDeleted',true);
  end if;
 end if;
 select *into target from auth.users where id=(p_data->>'userId')::uuid for update;
 if target.id is null or target.id=actor or target.raw_app_meta_data->>'role'is distinct from 'agent'
  or(target.deleted_at is not null and p_action<>'delete-prepare')then raise exception 'PROTECTED_ADMIN_ACCOUNT';end if;
 select *into job from private.admin_deletions where user_id=target.id;
 if p_action='delete-prepare'then
  if target.deleted_at is not null and job.user_id is null then raise exception 'PROTECTED_ADMIN_ACCOUNT';end if;
  if job.user_id is null then
   insert into private.admin_deletions(user_id,actor)values(target.id,actor)returning *into job;
   insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,metadata)
    values(actor,target.id,'security_event','user',target.id,'{"source":"admin_account_management","event":"deletion_requested"}');
   update auth.users set banned_until=now()+interval'100 years',updated_at=now()where id=target.id;
  end if;
  insert into private.account_revoked_sessions(session_id,user_id)select id,user_id from auth.sessions where user_id=target.id on conflict(session_id)do nothing;
  update auth.sessions set not_after=now()where user_id=target.id;
  return jsonb_build_object('operation',job.operation,'userId',target.id,'finished',job.state='done');
 end if;
 if job.state='pending'then raise exception 'ADMIN_DELETION_PENDING';end if;
 if p_action='edit'then
  full_name:=trim(p_data->>'name');address:=lower(trim(p_data->>'email'));
  if full_name is null or length(full_name)not between 2 and 120 or address is null
   or length(address)>254 or address!~'^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'then raise exception 'INVALID_DETAILS';end if;
  if lower(target.email)is distinct from lower(p_data->>'expectedEmail')then raise exception 'EMAIL_CHANGED_REFRESH';end if;
  if address<>lower(target.email)then
   result:=private.write_account_email(target.id,address,actor,'admin_change','Super Admin updated administrative account');
  end if;
  update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}')||jsonb_build_object('name',full_name),updated_at=now()where id=target.id;
  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,new_values)
   values(actor,target.id,'user_updated','user',target.id,jsonb_build_object('name',full_name,'email',address));
 elsif p_action in('disable','enable')then
  update auth.users set banned_until=case when p_action='enable'then null else now()+interval'100 years'end,updated_at=now()where id=target.id;
  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,new_values)
   values(actor,target.id,case when p_action='enable'then 'user_enabled'else 'user_disabled'end,'user',target.id,jsonb_build_object('enabled',p_action='enable'));
  if p_action='disable'then
   insert into private.account_revoked_sessions(session_id,user_id)select id,user_id from auth.sessions where user_id=target.id on conflict(session_id)do nothing;
   update auth.sessions set not_after=now()where user_id=target.id;
  end if;
 else raise exception 'INVALID_REQUEST';end if;
 return jsonb_build_object('success',true);
end $$;

create function public.admin_invitation_service(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare inv private.admin_invitations%rowtype;person auth.users%rowtype;job private.admin_deletions%rowtype;op uuid;
begin
 if p_action='delete-finish'then
  select *into job from private.admin_deletions where operation=(p_data->>'operation')::uuid and user_id=(p_data->>'userId')::uuid for update;
  if job.user_id is null or not exists(select 1 from auth.users where id=job.user_id and deleted_at is not null)then raise exception 'ADMIN_DELETION_PENDING';end if;
  if job.state<>'done'then
   update private.admin_deletions set state='done'where user_id=job.user_id;
   insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,metadata)
    values(job.actor,job.user_id,'user_deleted','user',job.user_id,'{"source":"admin_account_management","auditRetained":true}');
  end if;
  return '{"success":true}';
 end if;
 select *into inv from private.admin_invitations where id=(p_data->>'id')::uuid and token_hash=p_data->>'tokenHash' for update;
 if inv.id is null then raise exception 'INVITE_INVALID';end if;
 if p_action='delivery'then
  if p_data->>'delivery'not in('sent','failed')then raise exception 'INVALID_REQUEST';end if;
  update private.admin_invitations set delivery=p_data->>'delivery'where id=inv.id;return '{"success":true}';
 end if;
 if inv.state='accepted'then raise exception 'INVITE_USED';end if;
 if inv.state='cancelled'then raise exception 'INVITE_CANCELLED';end if;
 if inv.expires_at<=now()then raise exception 'INVITE_EXPIRED';end if;
 if not private.admin_inviter_allowed(inv.created_by)then raise exception 'INVITE_INVALID';end if;
 if p_action='release'then
  update private.admin_invitations set state='pending',operation=null,lease_until=null
   where id=inv.id and operation=(p_data->>'operation')::uuid and state='processing';return '{"success":true}';
 end if;
 select *into person from auth.users where deleted_at is null and lower(email)=inv.email;
 if person.id is not null and(person.raw_app_meta_data->>'role'is distinct from 'admin_invited'
  or person.raw_app_meta_data->>'admin_invitation_id'is distinct from inv.id::text)then raise exception 'EMAIL_IN_USE';end if;
 if p_action='resolve'then return jsonb_build_object('id',inv.id,'name',inv.name,'email',inv.email);end if;
 if p_action='prepare'then
  if inv.state='processing'and inv.lease_until>now()then raise exception 'INVITE_PROCESSING';end if;
  op:=gen_random_uuid();
  update private.admin_invitations set state='processing',operation=op,lease_until=now()+interval'2 minutes'where id=inv.id;
  return jsonb_build_object('id',inv.id,'name',inv.name,'email',inv.email,'operation',op,'setupUser',person.id);
 end if;
 if p_action='finish'then
  if inv.state<>'processing'or inv.operation is distinct from(p_data->>'operation')::uuid or inv.lease_until<=now()
   or person.id is null or person.id is distinct from(p_data->>'userId')::uuid then raise exception 'INVITE_INVALID';end if;
  update auth.users set email_confirmed_at=now(),confirmation_token='',confirmation_sent_at=null,
   raw_app_meta_data=(coalesce(raw_app_meta_data,'{}')-'admin_invitation_id')||'{"role":"agent"}',
   raw_user_meta_data=coalesce(raw_user_meta_data,'{}')||jsonb_build_object('name',inv.name),updated_at=now()where id=person.id;
  update private.admin_invitations set state='accepted',accepted_user_id=person.id,operation=null,lease_until=null where id=inv.id;
  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,metadata)
   values(inv.created_by,person.id,'role_assigned','user',person.id,jsonb_build_object('source','admin_invitation','invitationId',inv.id,'role','admin'));
  return jsonb_build_object('success',true,'email',inv.email);
 end if;
 raise exception 'INVALID_REQUEST';
end $$;
revoke all on function public.admin_invitation_service(text,jsonb)from public,anon,authenticated;
grant execute on function public.admin_invitation_service(text,jsonb)to service_role;

-- GoTrue soft deletion may scrub the email only for this exact queued Admin.
create or replace function private.guard_account_email()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if old.raw_app_meta_data->>'role'='agent'and old.deleted_at is null and new.deleted_at is not null
  and exists(select 1 from private.admin_deletions where user_id=old.id and state='pending')then return new;end if;
 if new.email is distinct from old.email or(coalesce(new.email_change,'')<>''and coalesce(new.email_change,'')<>coalesce(old.email_change,''))then
  if not exists(select 1 from private.account_email_changes e where e.user_id=old.id and e.transaction_id=txid_current()
   and e.old_email=coalesce(old.email,'')and e.new_email=coalesce(new.email,'')and(e.kind='admin_change'or old.email_confirmed_at is null))then
   raise exception 'EMAIL_ADMIN_ONLY'using errcode='42501';end if;
 end if;return new;
end $$;
commit;
