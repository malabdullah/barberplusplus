begin;
-- Explicit revocation takes effect even within the issuing transaction.
create or replace function private.account_tools_api(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=(p_data->>'user_id')::uuid;sid uuid:=(p_data->>'session_id')::uuid;
 role_name text;profile_id uuid;canonical uuid;allowed_users uuid[];target uuid;cursor_id bigint;
 cursor_time timestamptz;session_cursor uuid;rows jsonb;current_row jsonb;more boolean;next_cursor jsonb;
begin
 select u.raw_app_meta_data->>'role' into role_name from auth.users u join auth.sessions s on s.user_id=u.id
 where u.id=viewer and s.id=sid and(s.not_after is null or s.not_after>clock_timestamp())
 and not exists(select 1 from private.account_revoked_sessions r where r.session_id=sid)
 and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
 and(u.raw_app_meta_data->>'role'<>'admin' or(p_data->>'aal'='aal2' and s.aal='aal2' and exists(select 1 from auth.mfa_factors f where f.id=s.factor_id and f.user_id=u.id and f.factor_type='totp' and f.status='verified')));
 if role_name is null then raise exception 'AUTH_REQUIRED';end if;
 if role_name not in('customer','manager','barber','admin','agent')then raise exception 'FORBIDDEN';end if;
 if p_action not in('status','sessions','revoke-session','activity')or p_action is null then raise exception 'INVALID_REQUEST';end if;
 if p_action='status' then return jsonb_build_object('accountId',viewer,'role',role_name);end if;
 canonical:=viewer;
 if role_name='customer' then select coalesce((select i.account_user_id from private.customer_social_identities i where i.user_id=viewer),viewer)into canonical;end if;
 select a.customer_id into profile_id from private.customer_accounts a where a.user_id=canonical;
 select array_agg(u.id)into allowed_users from auth.users u where u.id=viewer or(role_name='customer' and u.raw_app_meta_data->>'role'='customer' and(u.id=canonical or exists(select 1 from private.customer_social_identities i where i.user_id=u.id and i.account_user_id=canonical)));
 if p_action in('sessions','revoke-session')then
  if p_action='revoke-session' then
   target:=(p_data->>'targetId')::uuid;
   if target is null then raise exception 'INVALID_REQUEST';end if;
   if target=sid then raise exception 'USE_SIGN_OUT_FOR_CURRENT_SESSION';end if;
   perform pg_advisory_xact_lock(hashtextextended(viewer::text,81212));
   update auth.sessions set not_after=least(coalesce(not_after,'infinity'::timestamptz),clock_timestamp()) where id=target and user_id=any(allowed_users);
   if not found then raise exception 'SESSION_NOT_FOUND';end if;
   insert into private.account_revoked_sessions(session_id,user_id)select id,user_id from auth.sessions where id=target on conflict(session_id)do nothing;
   return jsonb_build_object('revoked',true);
  end if;
  if p_data ? 'cursor' then cursor_time:=(p_data->'cursor'->>'createdAt')::timestamptz;session_cursor:=(p_data->'cursor'->>'id')::uuid;if cursor_time is null or session_cursor is null then raise exception 'INVALID_REQUEST';end if;end if;
  select jsonb_build_object('id',s.id,'device',left(coalesce(s.user_agent,''),256),'createdAt',s.created_at,'lastActiveAt',coalesce(s.refreshed_at at time zone 'UTC',s.created_at),'current',true)into current_row from auth.sessions s where s.id=sid;
  with candidates as(select s.* from auth.sessions s where s.user_id=any(allowed_users)and s.id<>sid and(s.not_after is null or s.not_after>clock_timestamp())and(cursor_time is null or(s.created_at,s.id)<(cursor_time,session_cursor))order by s.created_at desc,s.id desc limit 26),page as(select * from candidates order by created_at desc,id desc limit 25)
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'device',left(coalesce(p.user_agent,''),256),'createdAt',p.created_at,'lastActiveAt',coalesce(p.refreshed_at at time zone 'UTC',p.created_at),'current',false)order by p.created_at desc,p.id desc),'[]'::jsonb),(select count(*)>25 from candidates)into rows,more from page p;
  if more then next_cursor:=jsonb_build_object('createdAt',rows->-1->'createdAt','id',rows->-1->'id');end if;
  return jsonb_build_object('currentSession',current_row,'rows',rows,'nextCursor',next_cursor);
 end if;
 if p_data->>'view'not in('customer','work')or p_data->>'view'is null then raise exception 'INVALID_REQUEST';end if;
 if p_data->>'view'='customer'and(role_name not in('customer','manager','barber')or profile_id is null)then raise exception 'FORBIDDEN';end if;
 if p_data->>'view'='work'and role_name='customer'then raise exception 'FORBIDDEN';end if;
 if p_data ? 'cursor' then cursor_id:=(p_data->>'cursor')::bigint;if cursor_id is null or cursor_id<1 then raise exception 'INVALID_REQUEST';end if;end if;
 with candidates as(
  select a.* from private.account_activity a where(cursor_id is null or a.id<cursor_id)and(
   (p_data->>'view'='customer'and a.booking_id in(select o.booking_id from private.customer_booking_owners o where o.account_user_id=canonical))or
   (p_data->>'view'='work'and(role_name='admin' or
    (role_name='manager'and a.branch_id in(select b.id from public.branches b where b.manager_id=viewer))or
    (role_name='barber'and a.barber_id in(select x.id from public.barbers x where x.user_id=viewer and x.status='active'))or
    (role_name='agent'and a.actor_user_id=viewer))))order by a.id desc limit 26
 ),page as(select * from candidates order by id desc limit 25)
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'happenedAt',e.happened_at,'kind',e.kind,'shop',b.name,'shopAr',b.name_ar,'reference',upper(left(replace(e.booking_id::text,'-',''),10)),'byYou',e.actor_user_id=viewer,'actorRole',coalesce(e.actor_role,'unknown'),'actorName',case when p_data->>'view'='work'and role_name in('admin','manager')and e.actor_role in('admin','manager','barber','agent')then left(u.raw_user_meta_data->>'name',120)end)order by e.id desc),'[]'::jsonb),(select count(*)>25 from candidates)into rows,more from page e left join public.branches b on b.id=e.branch_id left join auth.users u on u.id=e.actor_user_id;
 return jsonb_build_object('rows',rows,'nextCursor',case when more then rows->-1->'id'else null end);
end $$;
notify pgrst,'reload schema';
commit;
