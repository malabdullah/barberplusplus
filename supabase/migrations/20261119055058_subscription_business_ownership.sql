begin;
alter table private.billing_businesses drop constraint billing_businesses_origin_manager_id_key;
create index billing_business_origin on private.billing_businesses(origin_manager_id);
create or replace function private.billing_register_shop()returns trigger
language plpgsql security definer set search_path='' as $$
declare business uuid;t timestamptz:=clock_timestamp();
begin
 if tg_op='INSERT'and new.manager_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(new.manager_id::text,712));
  -- A past origin link is not current authority after a handover. Prefer an
  -- assigned business; reuse an empty owned business to preserve its trial.
  select b.id into business from private.billing_businesses b
   where b.billing_manager_id=new.manager_id and(
    exists(select 1 from private.billing_shops l join public.branches br on br.id=l.branch_id where l.business_id=b.id and br.manager_id=new.manager_id)
    or not exists(select 1 from private.billing_shops l where l.business_id=b.id))
   order by b.created_at,b.id limit 1;
  if business is null then
   insert into private.billing_businesses(origin_manager_id,billing_manager_id,name)values(new.manager_id,new.manager_id,new.name)returning id into business;
  end if;
  insert into private.billing_subscriptions(business_id)values(business)on conflict do nothing;
  insert into private.billing_shops(branch_id,business_id)values(new.id,business)on conflict do nothing;
 end if;
 if new.status='active'and new.publication_state='published'and(tg_op='INSERT'or old.publication_state is distinct from 'published')then
  select business_id into business from private.billing_shops where branch_id=new.id;
  update private.billing_subscriptions set trial_started_at=t,trial_ends_at=t+interval'14 days',revision=revision+1
   where business_id=business and trial_started_at is null and transition_ends_at is null and period_started_at is null;
 end if;
 return new;
end $$;
do $fix$
declare source text:=pg_get_functiondef('subscription_billing.billing_api(text,jsonb)'::regprocedure);fixed text;
begin
 fixed:=replace(source,$old$'grants',(select coalesce(jsonb_agg(to_jsonb(a)order by a.created_at desc),'[]')from private.billing_access_grants a where a.business_id=business and a.revoked_at is null)$old$,
  $new$'grants',case when is_admin then(select coalesce(jsonb_agg(to_jsonb(a)order by a.created_at desc),'[]')from private.billing_access_grants a where a.business_id=business and a.revoked_at is null)else'[]'::jsonb end$new$);
 fixed:=replace(fixed,$old$'history',(select coalesce(jsonb_agg(to_jsonb(q)order by q.id desc),'[]')from(select h.id,h.action,h.reason,h.details,h.created_at from private.billing_audit h where h.business_id=business order by h.id desc limit 100)q)$old$,
  $new$'history',case when is_admin or b.billing_manager_id=actor then(select coalesce(jsonb_agg(to_jsonb(q)order by q.id desc),'[]')from(select h.id,h.action,h.reason,h.details,h.created_at from private.billing_audit h where h.business_id=business order by h.id desc limit 100)q)else'[]'::jsonb end$new$);
 if fixed=source then raise exception 'Subscription detail source changed';end if;
 execute fixed;
end $fix$;
commit;
