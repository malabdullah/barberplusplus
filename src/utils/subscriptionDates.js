// Display dates only. Access decisions remain entirely on the server.
export function subscriptionDateRows(business, now = Date.now()) {
  const rows = [{ label: 'billingPeriodEnds', value: business.periodEndsAt }];
  const accessLabel = {
    trial: 'trialEnds', transition: 'transitionEnds', grace: 'graceEnds', manual: 'manualAccessExpires',
  }[business.access?.status];
  if (accessLabel && business.access.until) rows.push({ label: accessLabel, value: business.access.until });

  const accessDates = Array.isArray(business.complimentaryAccess)
    ? business.complimentaryAccess.map(value => ({ kind: 'full', starts_at: value.startsAt, ends_at: value.expiresAt }))
    : business.grants || [];
  const grants = accessDates.filter(grant => grant.kind === 'full' && !grant.revoked_at
    && Number.isFinite(Date.parse(grant.starts_at)) && Date.parse(grant.ends_at) > now
    && Date.parse(grant.starts_at) < Date.parse(grant.ends_at));
  const active = grants.filter(grant => Date.parse(grant.starts_at) <= now)
    .sort((left, right) => Date.parse(right.ends_at) - Date.parse(left.ends_at))[0];
  if (active) rows.push({ label: 'complimentaryAccessExpires', value: active.ends_at });
  else if (business.access?.status === 'complimentary' && Date.parse(business.access.until) > now) {
    rows.push({ label: 'complimentaryAccessExpires', value: business.access.until });
  }
  grants.filter(grant => Date.parse(grant.starts_at) > now)
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))
    .forEach(grant => rows.push({ label: 'scheduledComplimentaryExpiry', value: grant.ends_at, startsAt: grant.starts_at }));
  return rows;
}
