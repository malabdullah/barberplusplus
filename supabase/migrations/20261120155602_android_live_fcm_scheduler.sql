-- Independent scheduler. Created INACTIVE and requires matching Live binding,
-- delivery flag and a new fixed-name secret. No APNs scheduler/secret is changed.
begin;
create function private.android_live_push_dispatch_secret(p_secret text)returns boolean
language sql stable security definer set search_path=''as $$
 select auth.role()='service_role'and length(p_secret)=64 and p_secret~'^[0-9a-f]+$'and exists(
  select 1 from private.android_live_push_runtime r join vault.decrypted_secrets s on s.name='customer_android_live_dispatch_secret'
  where r.singleton and r.environment='production'and r.delivery_enabled and private.android_live_push_bound(r)
   and length(s.decrypted_secret)=64 and s.decrypted_secret~'^[0-9a-f]+$'
   and extensions.digest(p_secret,'sha256')=extensions.digest(s.decrypted_secret,'sha256'))
$$;
create function public.authorize_android_live_push_dispatch(p_secret text)returns boolean
language sql set search_path=''as $$select private.android_live_push_dispatch_secret(p_secret);$$;
create function private.kick_android_live_push()returns void
language plpgsql security definer set search_path=''as $$
declare r private.android_live_push_runtime;secret text;
begin
 select*into r from private.android_live_push_runtime where singleton;
 if r.environment is distinct from'production'or not r.delivery_enabled or not private.android_live_push_bound(r)then return;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='customer_android_live_dispatch_secret';
 if length(secret)is distinct from 64 or secret!~'^[0-9a-f]+$'then return;end if;
 perform net.http_post(url:=r.api_url||'/functions/v1/customer-android-push-dispatch',
  headers:=jsonb_build_object('Content-Type','application/json','x-android-push-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=10000);
exception when others then
 -- No body, token, secret, recipient or provider response is logged.
 raise log 'Android push wake deferred to scheduler';
end$$;
create function private.android_live_push_event_wake()returns trigger
language plpgsql security definer set search_path=''as $$begin perform private.kick_android_live_push();return null;end$$;
create trigger android_live_push_event_wake after insert on private.customer_push_events for each statement execute function private.android_live_push_event_wake();
revoke all on function private.android_live_push_dispatch_secret(text),private.kick_android_live_push(),private.android_live_push_event_wake(),public.authorize_android_live_push_dispatch(text)from public,anon,authenticated,service_role;
grant execute on function private.android_live_push_dispatch_secret(text),public.authorize_android_live_push_dispatch(text)to service_role;
-- Atomic inactive creation. Activation is a separately reviewed release step.
do $scheduler$declare job bigint;begin
 job:=cron.schedule('customer-android-live-push-dispatch','* * * * *','select private.kick_android_live_push()');
 perform cron.alter_job(job,active:=false);
end$scheduler$;
notify pgrst,'reload schema';
commit;
