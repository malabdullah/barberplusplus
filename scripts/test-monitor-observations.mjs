import assert from 'node:assert/strict';
import { TEST_POLICY, boundedMaintenance, candidateIdentity, summarizeTestHealth } from './test-environment-policy.mjs';

export function evaluateTestObservations({ remote = null, network = [], expiry = [], notifications = false, previousAt = null, now = Date.now() }) {
  const checks = [...network, ...expiry];
  checks.push({ check: 'monitor-gap', status: previousAt && now - Date.parse(previousAt) > TEST_POLICY.intervalMs * 2 ? 'degraded' : 'healthy',
    reason: previousAt && now - Date.parse(previousAt) > TEST_POLICY.intervalMs * 2 ? 'mac-offline-or-checks-missed' : 'checks-current' });
  let maintenanceActive = false;
  if (remote) {
    assert.equal(remote.host, TEST_POLICY.host); assert.equal(remote.version, 1);
    assert.equal(remote.candidateIdentity, candidateIdentity(remote.candidate));
    const inspected = Date.parse(remote.inspectedAt); assert.ok(now >= inspected - 300000 && now - inspected < TEST_POLICY.intervalMs);
    maintenanceActive = boundedMaintenance(remote.maintenance, now);
    if (remote.maintenance) assert.equal(remote.maintenance.candidateIdentity, remote.candidateIdentity);
    const unhealthy = remote.states.some(s => !s.running || !['healthy', 'running'].includes(s.health) || s.oom);
    checks.push({ check: 'vps-services', status: unhealthy ? maintenanceActive ? 'degraded' : 'failed' : 'healthy', reason: unhealthy ? maintenanceActive ? 'recorded-test-maintenance' : 'service-unhealthy' : 'services-current' });
    checks.push({ check: 'vps-disk', status: remote.diskPercent >= TEST_POLICY.diskFailure ? 'failed' : remote.diskPercent >= TEST_POLICY.diskWarning ? 'degraded' : 'healthy',
      reason: remote.diskPercent >= TEST_POLICY.diskFailure ? 'disk-at-least-85-percent' : remote.diskPercent >= TEST_POLICY.diskWarning ? 'disk-75-to-84-percent' : 'disk-below-75-percent', value: remote.diskPercent });
    checks.push({ check: 'tunnel', status: remote.cloudflared === 'active' ? 'healthy' : 'failed', reason: remote.cloudflared === 'active' ? 'active' : 'inactive' });
    checks.push({ check: 'private-origins', status: remote.originMatch ? 'healthy' : 'failed', reason: remote.originMatch ? 'origins-current' : 'origin-drift-review-required' });
    checks.push({ check: 'synthetic-isolation', status: remote.syntheticOnly === null ? 'unknown' : remote.syntheticOnly === true && remote.outboundDisabled === true ? 'healthy' : 'failed', reason: remote.syntheticOnly === true && remote.outboundDisabled === true ? 'synthetic-and-outbound-verified' : 'isolation-not-verified' });
    const expiredWindow = remote.maintenance && now >= Date.parse(remote.maintenance.endsAt);
    checks.push({ check: 'maintenance-window', status: expiredWindow ? 'failed' : maintenanceActive ? 'degraded' : 'healthy', reason: expiredWindow ? 'maintenance-window-expired' : maintenanceActive ? 'recorded-test-maintenance' : 'no-active-maintenance' });
    checks.push({ check: 'operation-lock', status: remote.operationLock ? maintenanceActive ? 'degraded' : 'failed' : 'healthy', reason: remote.operationLock ? maintenanceActive ? 'recorded-test-maintenance' : 'operation-lock-needs-review' : 'no-operation-lock' });
    const days = (Date.parse(remote.serviceKeyExpiresAt) - now) / 86400000; assert.ok(Number.isFinite(days));
    checks.push({ check: 'supabase-service-key-expiry', status: days <= 7 ? 'failed' : days <= 14 ? 'degraded' : 'healthy', reason: days <= 7 ? 'expires-within-seven-days' : days <= 14 ? 'expires-within-fourteen-days' : 'key-current' });
    const security = remote.security;
    let validReview = false;
    if (security) {
      assert.deepEqual(Object.keys(security).sort(), ['candidateIdentity', 'dispositionsComplete', 'expiresAt', 'reviewedAt', 'scanSha256', 'schema']);
      assert.equal(security.schema, 'barber-test-security-review/v1'); assert.match(security.scanSha256, /^[a-f0-9]{64}$/);
      assert.equal(typeof security.dispositionsComplete, 'boolean');
      const reviewed = Date.parse(security.reviewedAt); const expires = Date.parse(security.expiresAt);
      assert.ok(Number.isFinite(reviewed) && reviewed <= now && Number.isFinite(expires) && expires <= Date.parse(TEST_POLICY.reviewBy));
      validReview = security.candidateIdentity === remote.candidateIdentity && security.dispositionsComplete && now - reviewed <= 7 * 86400000 && now < expires;
    }
    const daysLeft = (Date.parse(TEST_POLICY.reviewBy) - now) / 86400000;
    checks.push({ check: 'security-review', status: !validReview ? 'failed' : daysLeft <= 7 ? 'degraded' : 'healthy',
      reason: daysLeft <= 0 ? 'realtime-acceptance-expired' : !validReview ? 'security-dispositions-incomplete-or-stale' : daysLeft <= 7 ? 'realtime-review-due' : 'review-current' });
  } else checks.push({ check: 'vps-inventory', status: 'unknown', reason: 'ssh-or-configuration-observation-unavailable' });
  // Only availability checks are suppressible. Access/isolation/origin/security
  // failures remain visible even inside a recorded maintenance window.
  if (maintenanceActive) for (const check of checks) {
    if (check.check.startsWith('availability:') && check.status !== 'healthy') {
      check.status = 'degraded'; check.reason = 'recorded-test-maintenance';
    }
  }
  checks.push({ check: 'mac-notifications', status: notifications ? 'healthy' : 'unknown', reason: notifications ? 'pinned-helper-authorized' : 'notification-delivery-unavailable' });
  return { version: 1, policy: TEST_POLICY.schema, checkedAt: new Date(now).toISOString(), checks, ...summarizeTestHealth(checks) };
}
