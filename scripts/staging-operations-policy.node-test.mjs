import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupReadiness, maintenanceWindow, retentionCandidates, changedProblems } from './staging-operations-policy.mjs';

const now = Date.parse('2026-10-10T12:00:00Z');
const receipt = hours => ({ id: 'staging-20261008T091500Z-abcdef01', kind: 'staging-backup', status: 'encrypted-transfer-verified',
  sha256: 'a'.repeat(64), createdAt: new Date(now - hours * 3600000).toISOString(), verifiedAt: new Date(now).toISOString() });
test('readiness uses capture time, excludes fixtures and rejects future verification', () => {
  assert.equal(backupReadiness([receipt(25)], now).status, 'healthy');
  assert.equal(backupReadiness([receipt(27)], now).status, 'degraded');
  assert.equal(backupReadiness([receipt(31)], now).releaseAllowed, false);
  assert.equal(backupReadiness([{ ...receipt(1), kind: 'synthetic-probe' }], now).status, 'failed');
  assert.equal(backupReadiness([{ ...receipt(1), verifiedAt: new Date(now + 1).toISOString() }], now).status, 'failed');
});
test('maintenance suppression is bounded to Kuwait 04:00 inclusive to 04:15 exclusive', () => {
  assert.equal(maintenanceWindow(new Date('2026-10-10T00:59:59Z')), false);
  assert.equal(maintenanceWindow(new Date('2026-10-10T01:00:00Z')), true);
  assert.equal(maintenanceWindow(new Date('2026-10-10T01:14:59Z')), true);
  assert.equal(maintenanceWindow(new Date('2026-10-10T01:15:00Z')), false);
});
test('retention preserves last good, latest two restores, pins and unacknowledged exports', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ id: `staging-20260901T000000Z-abcdef0${i}`,
    createdAt: new Date(now - (20 - i) * 86400000).toISOString(), verified: true, remoteAcknowledged: true }));
  items[0].pinned = true; items[1].remoteAcknowledged = false; items[2].verified = false;
  items[3].restoreVerified = true; items[4].restoreVerified = true;
  assert.deepEqual(retentionCandidates(items, now), [items[5].id, items[6].id]);
  assert.throws(() => retentionCandidates([{ ...items[5], id: '../escape' }], now));
});
test('notifications deduplicate unchanged problems and report recovery', () => {
  const failed = { check: 'backup', status: 'failed', reason: 'stale' };
  assert.deepEqual(changedProblems([failed], [failed]), []);
  assert.deepEqual(changedProblems([], [failed]), ['backup:failed:stale']);
  assert.deepEqual(changedProblems([failed], [{ check: 'backup', status: 'healthy', reason: 'current' }]), ['backup:recovered']);
});
