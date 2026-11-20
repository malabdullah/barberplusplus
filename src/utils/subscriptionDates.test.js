import { expect, it } from 'vitest';
import { subscriptionDateRows } from './subscriptionDates';

const now = Date.parse('2026-11-20T12:00:00+03:00');
const periodEndsAt = '2026-12-19T22:05:45Z';
const grant = { kind: 'full', starts_at: '2026-11-19T21:00:00Z', ends_at: '2027-11-18T21:00:00Z', revoked_at: null };
const business = { periodEndsAt, access: { status: 'active', until: periodEndsAt }, grants: [grant] };

it('keeps the paid monthly period and longer complimentary grant independent', () => {
  expect(subscriptionDateRows(business, now)).toEqual([
    { label: 'billingPeriodEnds', value: periodEndsAt },
    { label: 'complimentaryAccessExpires', value: grant.ends_at },
  ]);
  expect(business.access.until).toBe(periodEndsAt);
});

it('uses the manager-safe dates without requiring private Admin grant records', () => {
  expect(subscriptionDateRows({ ...business, grants: [], complimentaryAccess: [{ startsAt: grant.starts_at, expiresAt: grant.ends_at }] }, now))
    .toEqual(subscriptionDateRows(business, now));
  expect(subscriptionDateRows({ ...business, complimentaryAccess: [] }, now))
    .toEqual([{ label: 'billingPeriodEnds', value: periodEndsAt }]);
});

it('does not present the grant expiry as a paid period when there has been no payment', () => {
  expect(subscriptionDateRows({ ...business, periodEndsAt: null, access: { status: 'complimentary', until: grant.ends_at } }, now)).toEqual([
    { label: 'billingPeriodEnds', value: null }, { label: 'complimentaryAccessExpires', value: grant.ends_at },
  ]);
});

it('shows no complimentary expiry for manual, revoked, expired or invalid grants', () => {
  const grants = [
    { ...grant, kind: 'manual' }, { ...grant, revoked_at: '2026-11-20T01:00:00Z' },
    { ...grant, ends_at: '2026-11-19T21:00:00Z' }, { ...grant, starts_at: 'invalid' },
    { ...grant, starts_at: grant.ends_at },
  ];
  expect(subscriptionDateRows({ ...business, grants }, now)).toEqual([{ label: 'billingPeriodEnds', value: periodEndsAt }]);
});

it('uses the longest currently active grant without folding in a disconnected future grant', () => {
  const future = { ...grant, starts_at: '2028-01-01T00:00:00Z', ends_at: '2029-01-01T00:00:00Z' };
  const grants = [{ ...grant, ends_at: '2027-01-01T00:00:00Z' }, future, grant];
  expect(subscriptionDateRows({ ...business, grants }, now)).toEqual([
    { label: 'billingPeriodEnds', value: periodEndsAt },
    { label: 'complimentaryAccessExpires', value: grant.ends_at },
    { label: 'scheduledComplimentaryExpiry', value: future.ends_at, startsAt: future.starts_at },
  ]);
});

it('handles the exact exclusive expiry boundary without extending the grant by a day', () => {
  expect(subscriptionDateRows(business, Date.parse(grant.ends_at) - 1)).toHaveLength(2);
  expect(subscriptionDateRows(business, Date.parse(grant.ends_at))).toEqual([{ label: 'billingPeriodEnds', value: periodEndsAt }]);
});

it.each([
  ['trial', 'trialEnds'], ['transition', 'transitionEnds'], ['grace', 'graceEnds'], ['manual', 'manualAccessExpires'],
])('preserves the separate %s access deadline', (status, label) => {
  expect(subscriptionDateRows({ periodEndsAt, access: { status, until: grant.ends_at } }, now)).toEqual([
    { label: 'billingPeriodEnds', value: periodEndsAt }, { label, value: grant.ends_at },
  ]);
});

it('preserves a server-reported complimentary deadline when grant details are absent', () => {
  expect(subscriptionDateRows({ access: { status: 'complimentary', until: grant.ends_at } }, now)[1])
    .toEqual({ label: 'complimentaryAccessExpires', value: grant.ends_at });
});
