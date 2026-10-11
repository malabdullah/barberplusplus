import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TEST_POLICY, validateTestCandidate, candidateIdentity, assertTestOperation, boundedMaintenance, testCheckpointRequirement, parseTestRuntime, assertTestCheckpointBinding } from './test-environment-policy.mjs';
import { makeTestState } from './test-environment-state.mjs';
import { evaluateTestObservations } from './test-monitor-observations.mjs';
import { changedProblems } from './staging-operations-policy.mjs';

const now = Date.parse('2026-10-11T08:00:00Z');
const candidate = { schema: 'barber-test-candidate/v1', host: 'srv1207055', environment: 'staging', commit: 'a'.repeat(40),
  images: Object.fromEntries(['api-gw', 'auth', 'db', 'frontend', 'functions', 'mailpit', 'realtime', 'rest', 'storage'].map(name => [name,
    name === 'frontend' ? `ghcr.io/malabdullah/barberplusplus@sha256:${'b'.repeat(64)}` : name === 'functions' ? `ghcr.io/malabdullah/barberplusplus-functions@sha256:${'c'.repeat(64)}` : `sha256:${'d'.repeat(64)}`])),
  configuration: Object.fromEntries(['backend', 'bootstrap', 'frontend', 'nginx', 'runtime'].map(k => [k, 'e'.repeat(64)])),
  migrations: [{ file: '20260901000000_baseline.sql', sha256: 'f'.repeat(64) }] };
function remote() {
  return { version: 1, host: 'srv1207055', inspectedAt: new Date(now).toISOString(), candidate, candidateIdentity: candidateIdentity(candidate),
    states: [{ running: true, health: 'healthy', oom: false }], maintenance: null, operationLock: null, originMatch: true, syntheticOnly: true,
    outboundDisabled: true, cloudflared: 'active', diskPercent: 44, serviceKeyExpiresAt: '2027-01-01T00:00:00Z',
    security: { schema: 'barber-test-security-review/v1', candidateIdentity: candidateIdentity(candidate), reviewedAt: new Date(now).toISOString(),
      expiresAt: TEST_POLICY.reviewBy, scanSha256: '1'.repeat(64), dispositionsComplete: true } };
}
function window() { return { schema: 'barber-test-maintenance/v1', owner: 'malabdullah', candidateIdentity: candidateIdentity(candidate),
  startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 1000).toISOString(), reason: 'supervised-test' }; }
test('Test profile has no recurring backups, transfers or pruning', () => {
  assert.equal(TEST_POLICY.scheduledBackups, false); assert.equal(TEST_POLICY.automaticTransfers, false); assert.equal(TEST_POLICY.automaticPruning, false);
  const status = evaluateTestObservations({ remote: remote(), notifications: true, now });
  assert.ok(!status.checks.some(c => c.check.startsWith('backup'))); assert.equal(status.productionApproved, false);
  assert.equal(Object.hasOwn(status, 'releaseAllowed'), false);
});
test('candidate rejects production, mutable images, alternate packages and migration path traversal', () => {
  for (const mutate of [c => { c.host = 'srv1073968'; }, c => { c.environment = 'production'; }, c => { c.images.frontend += ':latest'; },
    c => { c.images.frontend = c.images.frontend.replace('ghcr.io', 'ghcrXio'); }, c => { c.migrations[0].file = '../baseline.sql'; },
    c => { c.extraSecret = 'invalid'; }, c => { c.configuration.runtime = 'unknown'; }]) {
    const bad = structuredClone(candidate); mutate(bad); assert.throws(() => validateTestCandidate(bad));
  }
});
test('Test runtime rejects browser secrets, arbitrary code and cross-origin configuration', () => {
  const key = ['header', Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase', exp: 2000000000 })).toString('base64url'), 'signature'].join('.');
  const runtime = `window.__BARBER_CONFIG__ = Object.freeze({environment: 'staging', appUrl: '${TEST_POLICY.origins[0]}', supabaseUrl: '${TEST_POLICY.origins[0]}', supabasePublishableKey: '${key}', release: '${candidate.commit}'});`;
  assert.equal(parseTestRuntime(runtime).commit, candidate.commit);
  assert.throws(() => parseTestRuntime(runtime + 'fetch("https://untrusted.invalid");'));
  assert.throws(() => parseTestRuntime(runtime.replace(/supabaseUrl: '[^']+'/g, `supabaseUrl: '${TEST_POLICY.origins[1]}'`)));
  const secret = ['header', Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase', exp: 2000000000 })).toString('base64url'), 'signature'].join('.');
  assert.throws(() => parseTestRuntime(runtime.replace(key, secret)));
});
test('candidate identity binds images, migration bytes and every configuration hash', () => {
  for (const mutate of [c => { c.images.db = `sha256:${'2'.repeat(64)}`; }, c => { c.migrations[0].sha256 = '2'.repeat(64); }, c => { c.configuration.runtime = '2'.repeat(64); }]) {
    const other = structuredClone(candidate); mutate(other); assert.notEqual(candidateIdentity(other), candidateIdentity(candidate));
  }
});
test('frozen candidate permits matching acceptance and rejects every mutation or candidate drift', () => {
  const state = makeTestState(candidate, 'frozen', now);
  assert.equal(assertTestOperation({ state, candidate, operation: 'acceptance', now }).allowed, true);
  for (const operation of ['frontend', 'stateful', 'reset', 'maintenance', 'checkpoint', 'rebuild']) assert.throws(() => assertTestOperation({ state, candidate, operation, now }));
  const other = structuredClone(candidate); other.configuration.runtime = '2'.repeat(64);
  assert.throws(() => assertTestOperation({ state, candidate: other, operation: 'acceptance', now }));
});
test('open candidate allows manual frontend work; stateful work needs a fresh operation-specific checkpoint', () => {
  const state = makeTestState(candidate, 'open', now);
  assert.equal(assertTestOperation({ state, candidate, operation: 'frontend', now }).checkpointRequired, false);
  assert.equal(assertTestOperation({ state, candidate, operation: 'stateful', now }).checkpointRequired, true);
  assert.deepEqual(testCheckpointRequirement('frontend', null, now, now), { required: false });
  assert.throws(() => testCheckpointRequirement('stateful', null, now, now));
  const receipt = { kind: 'staging-backup', status: 'encrypted-transfer-verified', id: 'staging-20261011T075959Z-12345678',
    sha256: 'a'.repeat(64), createdAt: new Date(now - 1000).toISOString(), verifiedAt: new Date(now).toISOString() };
  assert.equal(testCheckpointRequirement('stateful', receipt, now - 2000, now).required, true);
  assert.throws(() => testCheckpointRequirement('stateful', receipt, now, now));
});
test('missing SSH observations are unknown and a resume gap is reported', () => {
  const status = evaluateTestObservations({ notifications: true, previousAt: new Date(now - 3600000).toISOString(), now });
  assert.equal(status.overall, 'unknown'); assert.ok(status.checks.some(c => c.check === 'monitor-gap' && c.status === 'degraded'));
});
test('maintenance suppresses availability only; isolation, Access, origin and disk failures remain', () => {
  const observed = remote(); observed.maintenance = window(); observed.states[0].running = false; observed.originMatch = false; observed.syntheticOnly = false; observed.diskPercent = 85;
  const result = evaluateTestObservations({ remote: observed, notifications: true, now, network: [
    { check: 'availability:app', status: 'unknown', reason: 'unavailable' }, { check: 'access:app', status: 'failed', reason: 'unprotected' }] });
  assert.equal(result.checks.find(c => c.check === 'availability:app').status, 'degraded');
  for (const name of ['access:app', 'private-origins', 'synthetic-isolation', 'vps-disk']) assert.equal(result.checks.find(c => c.check === name).status, 'failed');
});
test('expired and oversized maintenance windows cannot hide outages', () => {
  const observed = remote(); observed.maintenance = window(); observed.maintenance.endsAt = new Date(now).toISOString(); observed.states[0].running = false;
  const result = evaluateTestObservations({ remote: observed, notifications: true, now });
  assert.equal(result.checks.find(c => c.check === 'vps-services').status, 'failed');
  assert.equal(result.checks.find(c => c.check === 'maintenance-window').status, 'failed');
  const oversized = window(); oversized.endsAt = new Date(now + 900000).toISOString(); assert.throws(() => boundedMaintenance(oversized, now));
});
test('new/unresolved findings and expired exceptions fail security even inside maintenance', () => {
  const observed = remote(); observed.maintenance = window(); observed.security.dispositionsComplete = false;
  const result = evaluateTestObservations({ remote: observed, notifications: true, now });
  assert.equal(result.checks.find(c => c.check === 'security-review').status, 'failed');
  observed.maintenance = null; observed.inspectedAt = TEST_POLICY.reviewBy;
  assert.equal(evaluateTestObservations({ remote: observed, notifications: true, now: Date.parse(TEST_POLICY.reviewBy) }).checks.find(c => c.check === 'security-review').reason, 'realtime-acceptance-expired');
});
test('disk thresholds, expired keys and missing notifications produce explicit failures/unknown', () => {
  const observed = remote(); observed.diskPercent = 75; observed.serviceKeyExpiresAt = new Date(now).toISOString();
  const result = evaluateTestObservations({ remote: observed, now });
  assert.equal(result.checks.find(c => c.check === 'vps-disk').status, 'degraded');
  assert.equal(result.checks.find(c => c.check === 'supabase-service-key-expiry').status, 'failed');
  assert.equal(result.checks.find(c => c.check === 'mac-notifications').status, 'unknown');
});
test('notification changes include new failure and recovery but exclude unchanged failures', () => {
  const old = [{ check: 'tunnel', status: 'healthy', reason: 'active' }];
  const failed = [{ check: 'tunnel', status: 'failed', reason: 'inactive' }];
  assert.deepEqual(changedProblems(old, failed), ['tunnel:failed:inactive']);
  assert.deepEqual(changedProblems(failed, failed), []);
  assert.deepEqual(changedProblems(failed, old), ['tunnel:recovered']);
});
test('checkpoint approval rejects another configuration even when its commit is unchanged', () => {
  const manifest = { id: 'staging-20261011T080000Z-12345678' };
  const capture = { id: manifest.id, commit: candidate.commit, version: 3, servicesResumed: true, candidateIdentity: candidateIdentity(candidate) };
  assert.equal(assertTestCheckpointBinding(capture, manifest, candidate).historicalLiveValidationRequired, false);
  const changed = structuredClone(candidate); changed.configuration.backend = '2'.repeat(64);
  assert.throws(() => assertTestCheckpointBinding(capture, manifest, changed));
  assert.throws(() => assertTestCheckpointBinding({ ...capture, servicesResumed: false }, manifest, candidate));
  assert.throws(() => assertTestCheckpointBinding({ ...capture, version: 2 }, manifest, candidate));
});
