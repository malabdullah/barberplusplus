begin;
create or replace function public.admin_invitation_service(p_action text,p_data jsonb)returns jsonb
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
  if p_data->>'password' is null or length(p_data->>'password')<12 or octet_length(p_data->>'password')>72
   or p_data->>'password'!~'[A-Z]'or p_data->>'password'!~'[a-z]'or p_data->>'password'!~'[0-9]'or p_data->>'password'!~'[!@#$%^&*(),.?":{}|<>]'then raise exception 'WEAK_PASSWORD';end if;
  -- Choose the credential and confirm the bound email in one locked transition.
  -- A competing public signup cannot substitute a password before confirmation.
  update auth.users set encrypted_password=extensions.crypt(p_data->>'password',extensions.gen_salt('bf',10)),email_confirmed_at=now(),confirmation_token='',confirmation_sent_at=null,
   raw_app_meta_data=(coalesce(raw_app_meta_data,'{}')-'admin_invitation_id')||'{"role":"agent"}',
   raw_user_meta_data=coalesce(raw_user_meta_data,'{}')||jsonb_build_object('name',inv.name),updated_at=now()where id=person.id;
  update private.admin_invitations set state='accepted',accepted_user_id=person.id,operation=null,lease_until=null where id=inv.id;
  insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,metadata)
   values(inv.created_by,person.id,'role_assigned','user',person.id,jsonb_build_object('source','admin_invitation','invitationId',inv.id,'role','admin'));
  return jsonb_build_object('success',true,'email',inv.email);
 end if;
 raise exception 'INVALID_REQUEST';
end $$;
commit;
