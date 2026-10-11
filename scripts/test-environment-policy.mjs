import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const TEST_POLICY = Object.freeze({
  schema: 'barber-test-policy/v1', host: 'srv1207055', environment: 'staging',
  displayName: 'Test', intervalMs: 900000, diskWarning: 75, diskFailure: 85,
  scheduledBackups: false, automaticTransfers: false, automaticPruning: false,
  reviewBy: '2026-10-18T00:00:00Z',
  origins: ['https://staging-barber.malabdullah.cloud', 'https://supabase-staging.malabdullah.cloud'],
});
const services = ['api-gw', 'auth', 'db', 'frontend', 'functions', 'mailpit', 'realtime', 'rest', 'storage'];
const hashes = ['backend', 'bootstrap', 'frontend', 'nginx', 'runtime'];
export function parseTestRuntime(text) {
  assert.equal(typeof text, 'string'); assert.ok(text.length < 16384);
  const match = text.match(/^\s*window\.__BARBER_CONFIG__\s*=\s*Object\.freeze\(\{\s*environment:\s*'staging',\s*appUrl:\s*'https:\/\/staging-barber\.malabdullah\.cloud',\s*supabaseUrl:\s*'https:\/\/staging-barber\.malabdullah\.cloud',\s*supabasePublishableKey:\s*'([A-Za-z0-9_.-]+)',\s*release:\s*'([a-f0-9]{40})'\s*\}\);?\s*$/);
  assert.ok(match, 'Unexpected Test browser configuration');
  const key = match[1]; const claims = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url'));
  assert.equal(claims.role, 'anon'); assert.equal(claims.iss, 'supabase');
  assert.ok(Number.isSafeInteger(claims.exp));
  return { commit: match[2], anon: key };
}
export function validateTestCandidate(candidate) {
  assert.deepEqual(Object.keys(candidate).sort(), ['commit', 'configuration', 'environment', 'host', 'images', 'migrations', 'schema']);
  assert.equal(candidate.schema, 'barber-test-candidate/v1');
  assert.equal(candidate.host, TEST_POLICY.host); assert.equal(candidate.environment, 'staging');
  assert.match(candidate.commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(Object.keys(candidate.images).sort(), services);
  for (const [name, image] of Object.entries(candidate.images)) {
    assert.equal(typeof image, 'string');
    const repository = name === 'frontend' ? 'ghcr.io/malabdullah/barberplusplus'
      : name === 'functions' ? 'ghcr.io/malabdullah/barberplusplus-functions' : null;
    if (repository) { assert.ok(image.startsWith(`${repository}@sha256:`)); assert.match(image.slice(repository.length + 8), /^[a-f0-9]{64}$/); }
    else assert.match(image, /^(sha256:[a-f0-9]{64}|[a-z0-9./_-]+@sha256:[a-f0-9]{64})$/);
  }
  assert.deepEqual(Object.keys(candidate.configuration).sort(), hashes);
  for (const hash of Object.values(candidate.configuration)) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(candidate.migrations) && candidate.migrations.length > 0 && candidate.migrations.length < 1024);
  let previous = '';
  for (const migration of candidate.migrations) {
    assert.deepEqual(Object.keys(migration).sort(), ['file', 'sha256']);
    assert.match(migration.file, /^\d{14}_[a-z0-9_]+\.sql$/); assert.ok(migration.file > previous);
    assert.notEqual(migration.file.slice(0, 14), previous.slice(0, 14)); previous = migration.file;
    assert.match(migration.sha256, /^[a-f0-9]{64}$/);
  }
  return candidate;
}
export function candidateIdentity(candidate) {
  validateTestCandidate(candidate);
  const canonical = { commit: candidate.commit, configuration: Object.fromEntries(hashes.map(k => [k, candidate.configuration[k]])),
    images: Object.fromEntries(services.map(k => [k, candidate.images[k]])), migrations: candidate.migrations,
    host: candidate.host, environment: candidate.environment, schema: candidate.schema };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
export function validateTestState(state, now = Date.now()) {
  assert.deepEqual(Object.keys(state).sort(), ['candidate', 'candidateIdentity', 'createdAt', 'mode', 'owner', 'schema']);
  assert.equal(state.schema, 'barber-test-state/v1'); assert.equal(state.owner, 'malabdullah');
  assert.ok(['open', 'frozen'].includes(state.mode));
  assert.ok(Number.isFinite(Date.parse(state.createdAt)) && Date.parse(state.createdAt) <= now);
  assert.equal(state.candidateIdentity, candidateIdentity(state.candidate));
  return state;
}
export function assertTestOperation({ state, candidate, operation, now = Date.now() }) {
  validateTestState(state, now); validateTestCandidate(candidate);
  assert.ok(['acceptance', 'frontend', 'stateful', 'reset', 'maintenance', 'checkpoint', 'rebuild'].includes(operation));
  if (state.mode === 'frozen') {
    assert.equal(operation, 'acceptance', 'End the acceptance freeze before mutation');
    assert.equal(candidateIdentity(candidate), state.candidateIdentity, 'Frozen candidate drift');
  }
  if (['checkpoint', 'maintenance', 'rebuild'].includes(operation)) assert.equal(candidateIdentity(candidate), state.candidateIdentity);
  return { allowed: true, checkpointRequired: ['stateful', 'reset', 'maintenance'].includes(operation), productionApproved: false };
}
export function summarizeTestHealth(checks) {
  const overall = checks.some(c => c.status === 'failed') ? 'failed'
    : checks.some(c => c.status === 'unknown') ? 'unknown'
      : checks.some(c => c.status === 'degraded') ? 'degraded' : 'healthy';
  return { overall, productionApproved: false, releaseAcceptance: 'requires-recorded-qa-security-and-owner-approval' };
}
export function boundedMaintenance(value, now) {
  if (value === null) return false;
  assert.deepEqual(Object.keys(value).sort(), ['candidateIdentity', 'endsAt', 'owner', 'reason', 'schema', 'startsAt']);
  assert.equal(value.schema, 'barber-test-maintenance/v1'); assert.equal(value.owner, 'malabdullah');
  assert.match(value.candidateIdentity, /^[a-f0-9]{64}$/);
  assert.match(value.reason, /^[a-z][a-z0-9-]{0,63}$/);
  const starts = Date.parse(value.startsAt); const ends = Date.parse(value.endsAt);
  assert.ok(Number.isFinite(starts) && Number.isFinite(ends) && ends > starts && ends - starts <= 900000);
  return now >= starts && now < ends;
}
export function testCheckpointRequirement(operation, receipt, startedAt, now = Date.now()) {
  assert.ok(['frontend', 'stateful', 'reset', 'maintenance'].includes(operation));
  if (operation === 'frontend') return { required: false };
  assert.ok(receipt && receipt.kind === 'staging-backup' && receipt.status === 'encrypted-transfer-verified');
  assert.match(receipt.id, /^staging-\d{8}T\d{6}Z-[a-f0-9]{8}$/); assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  const captured = Date.parse(receipt.createdAt); const verified = Date.parse(receipt.verifiedAt);
  assert.ok(Number.isFinite(startedAt) && startedAt <= captured && captured <= verified && verified <= now);
  return { required: true, id: receipt.id };
}
