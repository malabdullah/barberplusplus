import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const sha1 = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const canonicalTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const expectedPolicyKeys = ['schema', 'automationReady', 'host', 'project', 'installRoot', 'bootstrapSource',
  'repository', 'environment', 'workflow', 'services', 'imageRepositories', 'migrationCount', 'brokerProtocol'];
const expectedServices = ['db', 'auth', 'rest', 'storage', 'mailpit', 'realtime', 'functions', 'api-gw'];

function fail(message) {
  throw new Error(`Invalid staging VPS release verification: ${message}`);
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    fail(`${name} fields do not match policy`);
  }
}

function exact(actual, expected, name) {
  if (actual !== expected) fail(`${name} does not match policy`);
}

export function validateStagingReleasePolicy(policy) {
  exactKeys(policy, expectedPolicyKeys, 'policy');
  exact(policy.schema, 'barber-staging-release-policy/v1', 'policy.schema');
  if (typeof policy.automationReady !== 'boolean') fail('policy.automationReady must be boolean');
  exact(policy.host, 'srv1207055', 'policy.host');
  exact(policy.project, 'barber-staging-private', 'policy.project');
  exact(policy.installRoot, '/opt/barber-staging/supabase', 'policy.installRoot');
  exact(policy.bootstrapSource, 'c24f8ecadbe49d353965a0e9b457ebcd3cfca287', 'policy.bootstrapSource');
  exactKeys(policy.repository, ['id', 'fullName'], 'policy.repository');
  exact(policy.repository.id, 1123713308, 'policy.repository.id');
  exact(policy.repository.fullName, 'malabdullah/barberplusplus', 'policy.repository.fullName');
  exactKeys(policy.environment, ['id', 'name', 'reviewerId'], 'policy.environment');
  exact(policy.environment.id, 21158713380, 'policy.environment.id');
  exact(policy.environment.name, 'staging', 'policy.environment.name');
  exact(policy.environment.reviewerId, 19295903, 'policy.environment.reviewerId');
  exactKeys(policy.workflow, ['path', 'allowedSources'], 'policy.workflow');
  exact(policy.workflow.path, '.github/workflows/deploy-staging.yml', 'policy.workflow.path');
  if (!Array.isArray(policy.workflow.allowedSources) || policy.workflow.allowedSources.length > 4) fail('workflow allowlist is invalid');
  for (const entry of policy.workflow.allowedSources) {
    exactKeys(entry, ['gitBlobSha', 'sha256'], 'workflow allowlist entry');
    if (!sha1.test(entry.gitBlobSha) || !sha256.test(entry.sha256)) fail('workflow allowlist digest is invalid');
  }
  if (new Set(policy.workflow.allowedSources.map((entry) => `${entry.gitBlobSha}:${entry.sha256}`)).size !== policy.workflow.allowedSources.length) {
    fail('workflow allowlist contains duplicates');
  }
  if (JSON.stringify(policy.services) !== JSON.stringify(expectedServices)) fail('service inventory does not match the private bootstrap');
  exactKeys(policy.imageRepositories, ['frontend', 'functions'], 'policy.imageRepositories');
  exact(policy.imageRepositories.frontend, 'ghcr.io/malabdullah/barberplusplus', 'frontend repository');
  exact(policy.imageRepositories.functions, 'ghcr.io/malabdullah/barberplusplus-functions', 'functions repository');
  exact(policy.migrationCount, 4, 'policy.migrationCount');
  exact(policy.brokerProtocol, 1, 'policy.brokerProtocol');
  return Object.freeze(structuredClone(policy));
}

export function validateTrustedClock(evidence, now = new Date()) {
  exactKeys(evidence, ['source', 'referenceId', 'leapStatus', 'referenceTime', 'systemOffsetSeconds', 'rootDelaySeconds',
    'rootDispersionSeconds', 'observedAt'], 'clock evidence');
  exact(evidence.source, 'chronyc-tracking', 'clock source');
  if (typeof evidence.referenceId !== 'string' || evidence.referenceId.length === 0
      || /^(0+|not synchronised)$/i.test(evidence.referenceId)) fail('clock reference is absent');
  exact(evidence.leapStatus, 'Normal', 'clock leap status');
  for (const key of ['systemOffsetSeconds', 'rootDelaySeconds', 'rootDispersionSeconds']) {
    if (!Number.isFinite(evidence[key]) || evidence[key] < 0) fail(`${key} is invalid`);
  }
  const reference = Date.parse(evidence.referenceTime);
  const observed = Date.parse(evidence.observedAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!canonicalTime.test(evidence.referenceTime) || !canonicalTime.test(evidence.observedAt)
      || !Number.isFinite(reference) || !Number.isFinite(observed) || !Number.isFinite(current)) fail('clock timestamps are invalid');
  if (Math.abs(current - observed) > 60_000 || observed - reference > 300_000 || reference > observed) fail('clock evidence is stale or future-dated');
  const errorBoundSeconds = evidence.systemOffsetSeconds + evidence.rootDispersionSeconds + (0.5 * evidence.rootDelaySeconds);
  if (errorBoundSeconds > 1) fail('clock error bound exceeds one second');
  return Object.freeze({ status: 'trusted-clock-valid', authorizing: false, observedAt: evidence.observedAt, errorBoundSeconds });
}

function trackingField(raw, label) {
  const match = raw.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, 'mi'));
  if (!match) fail(`chronyc ${label} is absent`);
  return match[1].trim();
}

export function parseChronycTracking(raw, observedAt = new Date()) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') === 0 || Buffer.byteLength(raw, 'utf8') > 16 * 1024) fail('chronyc output is absent or oversized');
  const offset = trackingField(raw, 'System time').match(/^([0-9]+(?:\.[0-9]+)?) seconds (?:fast|slow) of NTP time$/);
  const decimalField = (label) => {
    const match = trackingField(raw, label).match(/^([0-9]+(?:\.[0-9]+)?) seconds$/);
    if (!match) fail(`chronyc ${label} is invalid`);
    return Number(match[1]);
  };
  if (!offset) fail('chronyc System time is invalid');
  const referenceText = trackingField(raw, '(?:Ref|Reference) time \\(UTC\\)');
  const reference = new Date(`${referenceText} UTC`);
  if (Number.isNaN(reference.getTime())) fail('chronyc reference time is invalid');
  const observed = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(observed.getTime())) fail('clock observation time is invalid');
  return Object.freeze({
    source: 'chronyc-tracking',
    referenceId: trackingField(raw, 'Reference ID'),
    leapStatus: trackingField(raw, 'Leap status'),
    referenceTime: reference.toISOString(),
    systemOffsetSeconds: Number(offset[1]),
    rootDelaySeconds: decimalField('Root delay'),
    rootDispersionSeconds: decimalField('Root dispersion'),
    observedAt: observed.toISOString(),
  });
}

export async function readTrustedClock({ chronycPath = '/usr/bin/chronyc', execute = execFileAsync, now = new Date() } = {}) {
  if (!['/usr/bin/chronyc', '/usr/local/bin/chronyc'].includes(chronycPath)) fail('chronyc path is not allowlisted');
  const { stdout } = await execute(chronycPath, ['tracking'], {
    encoding: 'utf8', maxBuffer: 16 * 1024, timeout: 5000, windowsHide: true,
  });
  return validateTrustedClock(parseChronycTracking(stdout, now), now);
}

function recordHash(record) {
  return createHash('sha256').update(JSON.stringify(record), 'utf8').digest('hex');
}

export function validateReplayLedger(jsonl) {
  if (typeof jsonl !== 'string' || Buffer.byteLength(jsonl, 'utf8') > 1024 * 1024) fail('replay ledger is absent or oversized');
  if (jsonl !== '' && !jsonl.endsWith('\n')) fail('replay ledger must end with a newline');
  const lines = jsonl === '' ? [] : jsonl.slice(0, -1).split('\n');
  const records = [];
  let previousHash = '0'.repeat(64);
  for (let index = 0; index < lines.length; index += 1) {
    let record;
    try { record = JSON.parse(lines[index]); } catch { fail('replay ledger contains invalid JSON'); }
    if (lines[index] !== JSON.stringify(record)) fail('replay ledger record is not canonical JSON');
    exactKeys(record, ['sequence', 'previousHash', 'event', 'bindingSha256', 'requestId', 'artifactId',
      'envelopeSha256', 'commit', 'frontendDigest', 'functionsDigest', 'migrationTreeSha256', 'recordedAt'], `ledger record ${index + 1}`);
    exact(record.sequence, index + 1, 'ledger sequence');
    exact(record.previousHash, previousHash, 'ledger previous hash');
    if (!['observed', 'verified', 'authorized', 'executing', 'consumed', 'failed'].includes(record.event)) fail('ledger event is invalid');
    for (const [key, pattern] of [['bindingSha256', sha256], ['commit', sha1]]) if (!pattern.test(record[key])) fail(`ledger ${key} is invalid`);
    for (const key of ['envelopeSha256', 'frontendDigest', 'functionsDigest', 'migrationTreeSha256']) if (!digest.test(record[key])) fail(`ledger ${key} is invalid`);
    if (!/^[1-9]\d*$/.test(record.artifactId) || typeof record.requestId !== 'string' || record.requestId.length > 256) fail('ledger identity is invalid');
    if (!canonicalTime.test(record.recordedAt) || Number.isNaN(Date.parse(record.recordedAt))) fail('ledger timestamp is invalid');
    previousHash = recordHash(record);
    records.push(Object.freeze(record));
  }
  return Object.freeze({ status: 'replay-ledger-valid', authorizing: false, records: Object.freeze(records), headSha256: previousHash });
}

function blocked(missingProof) {
  return Object.freeze({ status: 'blocked-staging-vps-authorization', authorizing: false, missingProof: Object.freeze(missingProof) });
}

export function evaluateStagingVpsAuthorization({ policy, bindingResult, clockResult, ledgerResult, brokerStatus, bootstrapEvidence }) {
  const checked = validateStagingReleasePolicy(policy);
  const missing = [];
  if (checked.automationReady !== true) missing.push('root-owned release policy automationReady=true after separate activation approval');
  if (!bindingResult || bindingResult.status !== 'release-artifact-binding-valid' || bindingResult.authorizing !== false) missing.push('complete non-authorizing release evidence binding');
  const binding = bindingResult?.binding;
  if (binding && !checked.workflow.allowedSources.some((entry) => entry.gitBlobSha === binding.workflowBlobSha
      && entry.sha256 === binding.workflowSha256)) missing.push('reviewed workflow blob and SHA-256 allowlist entry');
  if (!clockResult || clockResult.status !== 'trusted-clock-valid' || clockResult.authorizing !== false) missing.push('fresh trusted chrony evidence');
  if (!ledgerResult || ledgerResult.status !== 'replay-ledger-valid' || ledgerResult.authorizing !== false) missing.push('valid persistent append-only replay ledger');
  if (binding && ledgerResult?.records?.some((record) => record.bindingSha256 === bindingResult.bindingSha256
      || record.requestId === binding.requestId || record.artifactId === binding.artifactId)) missing.push('release evidence not previously observed or consumed');
  if (!bootstrapEvidence || bootstrapEvidence.source !== checked.bootstrapSource || bootstrapEvidence.host !== checked.host
      || bootstrapEvidence.project !== checked.project || bootstrapEvidence.services !== 8
      || bootstrapEvidence.migrations !== checked.migrationCount || bootstrapEvidence.restoreVerified !== true
      || bootstrapEvidence.publicRoutingChanged !== false || bootstrapEvidence.releaseAccepted !== false) {
    missing.push('exact private-bootstrap and eight-service restore evidence');
  }
  if (!brokerStatus || brokerStatus.version !== checked.brokerProtocol || brokerStatus.code !== 'OK'
      || brokerStatus.automationReady !== true || brokerStatus.liveStackVerified !== true
      || !Array.isArray(brokerStatus.capabilities)
      || JSON.stringify(brokerStatus.capabilities) !== JSON.stringify(['status.inspect', 'backup.capture', 'migration.apply', 'images.rollback'])) {
    missing.push('separately activated constrained broker with exact capabilities');
  }
  if (missing.length) return blocked([...new Set(missing)]);
  return Object.freeze({ status: 'staging-vps-authorization-valid', authorizing: true,
    binding: bindingResult.binding, bindingSha256: bindingResult.bindingSha256,
    clockObservedAt: clockResult.observedAt, replayLedgerHead: ledgerResult.headSha256 });
}

export const stagingVpsVerifierInternals = Object.freeze({ recordHash });
