begin;
create or replace function public.finish_admin_password_reset(p_guard uuid,p_actor uuid,p_target uuid)returns boolean
language plpgsql security definer set search_path=''as $$
begin
 perform 1 from private.admin_password_reset_guards where id=p_guard and actor_id=p_actor and target_id=p_target for update;
 if not found then raise exception 'Password reset guard not found';end if;
 if exists(select 1 from auth.users where id=p_target and raw_app_meta_data->>'role'='agent')then
  insert into private.account_revoked_sessions(session_id,user_id)select id,user_id from auth.sessions where user_id=p_target on conflict(session_id)do nothing;
  delete from auth.sessions where user_id=p_target;
 end if;
 insert into public.audit_logs(admin_user_id,target_user_id,action_type,target_entity_type,target_entity_id,metadata)
  values(p_actor,p_target,'password_reset_completed','user',p_target,'{"source":"admin_password_reset"}');
 delete from private.admin_password_reset_guards where id=p_guard;
 return true;
end $$;
commit;
