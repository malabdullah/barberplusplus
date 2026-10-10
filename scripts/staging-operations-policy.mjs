import assert from 'node:assert/strict';

export const POLICY = Object.freeze({ intervalMs: 15 * 60 * 1000, warningHours: 26, failureHours: 30,
  reviewBy: '2026-10-18T00:00:00Z', diskWarning: 75, diskFailure: 85, keepDays: 7 });
export function maintenanceWindow(now) {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuwait', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(now);
  return time >= '04:00' && time < '04:15';
}
export function backupReadiness(receipts, now = Date.now()) {
  const verified = receipts.filter(item => item.kind === 'staging-backup' && item.status === 'encrypted-transfer-verified'
    && /^staging-\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(item.id)
    && /^[a-f0-9]{64}$/.test(item.sha256) && Number.isFinite(Date.parse(item.createdAt))
    && Number.isFinite(Date.parse(item.verifiedAt)) && Date.parse(item.createdAt) <= Date.parse(item.verifiedAt)
    && Date.parse(item.verifiedAt) <= now).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (!verified.length) return { status: 'failed', reason: 'no-verified-off-vps-backup', releaseAllowed: false };
  const ageHours = (now - Date.parse(verified[0].createdAt)) / 3600000;
  return { status: ageHours > POLICY.failureHours ? 'failed' : ageHours > POLICY.warningHours ? 'degraded' : 'healthy',
    reason: ageHours > POLICY.failureHours ? 'off-vps-backup-stale' : ageHours > POLICY.warningHours ? 'off-vps-backup-aging' : 'off-vps-backup-current',
    id: verified[0].id, ageHours, releaseAllowed: ageHours <= POLICY.failureHours };
}
// Selection only. Deletion also requires private filesystem and matching remote
// acknowledgement checks at the executor, and explicit prune invocation.
export function retentionCandidates(records, now = Date.now()) {
  const verified = records.filter(item => item.verified === true && item.remoteAcknowledged === true);
  const latest = [...verified].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const restored = verified.filter(item => item.restoreVerified === true).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 2);
  const protectedIds = new Set([latest?.id, ...restored.map(item => item.id)]);
  return records.filter(item => {
    assert.match(item.id, /^staging-\d{8}T\d{6}Z-[a-f0-9]{8}$/);
    return item.verified === true && item.remoteAcknowledged === true && !item.pinned && !protectedIds.has(item.id)
      && Number.isFinite(Date.parse(item.createdAt)) && now - Date.parse(item.createdAt) > POLICY.keepDays * 86400000;
  }).map(item => item.id);
}
export function changedProblems(previous, current) {
  return current.filter(item => item.status !== 'healthy' && !previous.some(old => old.check === item.check
    && old.status === item.status && old.reason === item.reason)).map(item => `${item.check}:${item.status}:${item.reason}`)
    .concat(previous.filter(old => old.status !== 'healthy' && current.some(item => item.check === old.check && item.status === 'healthy'))
      .map(item => `${item.check}:recovered`));
}
