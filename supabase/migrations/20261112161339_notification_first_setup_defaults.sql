begin;
-- New native first-time setup only. No backfill, table-default or delivery changes.
create or replace function private.customer_announcement_api(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare account uuid:=(p_data->>'user_id')::uuid;sid uuid:=(p_data->>'session_id')::uuid;d private.customer_push_devices;
begin
 if not public.customer_session_is_live(account,sid)then raise exception 'AUTH_REQUIRED';end if;
 if p_action not in ('status','register','preference')or p_action is null then raise exception 'INVALID_REQUEST';end if;
 if p_data ? 'initializeDefaults' and (p_action<>'register' or jsonb_typeof(p_data->'initializeDefaults')is distinct from 'boolean')then raise exception 'INVALID_REQUEST';end if;
 if p_action in ('register','preference')then
  if p_data->>'deviceSecret' !~ '^[0-9a-f]{64}$'or p_data->>'deviceSecret'is null or p_data->>'version'<>'1'then raise exception 'INVALID_REQUEST';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_data->>'deviceId',714));
  select * into d from private.customer_push_devices where id=(p_data->>'deviceId')::uuid for update;
  if not found or d.account_id is distinct from account or d.session_id is distinct from sid
   or d.secret_hash is distinct from extensions.digest(p_data->>'deviceSecret','sha256')then raise exception 'FORBIDDEN';end if;
  insert into private.announcement_devices as saved(device_id,account_id,session_id,registration_version)values(d.id,account,sid,d.registration_version)
   on conflict(device_id)do update set account_id=excluded.account_id,session_id=excluded.session_id,registration_version=excluded.registration_version,registered_at=clock_timestamp(),binding=case when saved.account_id=excluded.account_id and saved.session_id=excluded.session_id then saved.binding else excluded.binding end;
  -- Only an updated client's first-setup request may initialize a missing choice.
  -- A concurrent saved preference wins; ordinary registration never resets it.
  if p_action='register' and coalesce((p_data->>'initializeDefaults')::boolean,false)then
   insert into private.announcement_preferences(account_id,enabled)values(account,true)
    on conflict(account_id)do nothing;
  end if;
  if p_action='preference'then
   if jsonb_typeof(p_data->'enabled')is distinct from 'boolean'then raise exception 'INVALID_REQUEST';end if;
   insert into private.announcement_preferences as saved(account_id,enabled)values(account,(p_data->>'enabled')::boolean)
    on conflict(account_id)do update set enabled=excluded.enabled,enabled_since=case when excluded.enabled and not saved.enabled then clock_timestamp()else saved.enabled_since end;
  end if;
 end if;
 return jsonb_build_object('enabled',coalesce((select enabled from private.announcement_preferences where account_id=account),false),'version',1,
  'preferenceConfigured',exists(select 1 from private.announcement_preferences where account_id=account))||case when p_action='status'then'{}'::jsonb else jsonb_build_object('recipientBinding',(select binding from private.announcement_devices where device_id=d.id and account_id=account and session_id=sid))end;
end $$;

revoke all on function private.customer_announcement_api(text,jsonb) from public,anon,authenticated;
grant execute on function private.customer_announcement_api(text,jsonb) to service_role;
commit;
