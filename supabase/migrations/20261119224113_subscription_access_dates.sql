-- Managers may read grant dates without receiving Admin reasons, actors or IDs.
-- Existing billing authorization and all grant/payment behavior stay intact.
begin;
do $$
declare source text; fixed text;
begin
  source := pg_get_functiondef('private.billing_business_view(uuid,uuid,boolean)'::regprocedure);
  if position('''complimentaryAccess''' in source) > 0 then
    raise exception 'subscription access dates already present';
  end if;
  fixed := replace(source,
    $old$'trialStartedAt',s.trial_started_at$old$,
    $new$'complimentaryAccess',(select coalesce(jsonb_agg(jsonb_build_object(
      'startsAt',g.starts_at,'expiresAt',g.ends_at) order by g.starts_at,g.ends_at),'[]'::jsonb)
      from private.billing_access_grants g where g.business_id=b.id and g.kind='full'
      and g.revoked_at is null and g.ends_at>now()),
    'trialStartedAt',s.trial_started_at$new$);
  if fixed = source then raise exception 'subscription business view contract changed'; end if;
  execute fixed;
end $$;
commit;
