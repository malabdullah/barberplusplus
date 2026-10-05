import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  evaluateStagingVpsAuthorization,
  parseChronycTracking,
  readTrustedClock,
  stagingVpsVerifierInternals,
  validateReplayLedger,
  validateStagingReleasePolicy,
  validateTrustedClock,
} from './staging-vps-verifier.mjs';
import { buildStagingAdapterRequest, validateStagingAdapterReply } from './staging-vps-adapters.mjs';

const checkedInPolicy = JSON.parse(readFileSync('ops/staging-vps/release-policy.json', 'utf8'));
const hash = (character) => character.repeat(64);
const imageDigest = (character) => `sha256:${hash(character)}`;
const workflowBlobSha = 'a'.repeat(40);
const workflowSha256 = hash('b');

function enabledPolicy() {
  return {
    ...structuredClone(checkedInPolicy),
    automationReady: true,
    workflow: { ...checkedInPolicy.workflow, allowedSources: [{ gitBlobSha: workflowBlobSha, sha256: workflowSha256 }] },
  };
}

function clockEvidence(overrides = {}) {
  return {
    source: 'chronyc-tracking',
    referenceId: 'CB00710F (time.example)',
    leapStatus: 'Normal',
    referenceTime: '2026-10-05T05:00:00.000Z',
    systemOffsetSeconds: 0.01,
    rootDelaySeconds: 0.1,
    rootDispersionSeconds: 0.02,
    observedAt: '2026-10-05T05:01:00.000Z',
    ...overrides,
  };
}

function binding() {
  return {
    status: 'release-artifact-binding-valid',
    authorizing: false,
    bindingSha256: hash('c'),
    binding: {
      workflowBlobSha,
      workflowSha256,
      requestId: '1123713308:123:1:0123456789abcdef0123456789abcdef',
      artifactId: '99',
      commit: 'd'.repeat(40),
      frontendDigest: imageDigest('e'),
      functionsDigest: imageDigest('f'),
      migrationTreeSha256: imageDigest('1'),
      latestMigration: '20260903111500_restore_remaining_baseline',
    },
  };
}

function broker() {
  return { version: 1, code: 'OK', automationReady: true, liveStackVerified: true,
    capabilities: ['status.inspect', 'backup.capture', 'migration.apply', 'images.rollback'] };
}

function bootstrap() {
  return { source: checkedInPolicy.bootstrapSource, host: 'srv1207055', project: 'barber-staging-private',
    services: 8, migrations: 4, restoreVerified: true, publicRoutingChanged: false, releaseAccepted: false };
}

test('checked-in policy validates but keeps automation disabled and workflow allowlist empty', () => {
  const result = validateStagingReleasePolicy(checkedInPolicy);
  assert.equal(result.automationReady, false);
  assert.deepEqual(result.workflow.allowedSources, []);
});

test('policy rejects changed host, inventory, repositories and unreviewed digests', () => {
  for (const mutate of [
    (value) => { value.host = 'production'; },
    (value) => { value.services.pop(); },
    (value) => { value.imageRepositories.frontend = 'ghcr.io/attacker/app'; },
    (value) => { value.workflow.allowedSources = [{ gitBlobSha: 'bad', sha256: workflowSha256 }]; },
    (value) => { value.extra = true; },
  ]) {
    const value = structuredClone(checkedInPolicy); mutate(value);
    assert.throws(() => validateStagingReleasePolicy(value), /Invalid staging VPS release verification/);
  }
});

test('trusted clock accepts a fresh bounded chrony result', () => {
  const result = validateTrustedClock(clockEvidence(), new Date('2026-10-05T05:01:30.000Z'));
  assert.equal(result.status, 'trusted-clock-valid');
  assert.equal(result.errorBoundSeconds, 0.08);
  assert.equal(result.authorizing, false);
});

test('trusted clock rejects stale, unsynchronized, future and excessive-error evidence', () => {
  for (const [evidence, now] of [
    [clockEvidence({ leapStatus: 'Not synchronised' }), '2026-10-05T05:01:30.000Z'],
    [clockEvidence({ referenceTime: '2026-10-05T04:50:00.000Z' }), '2026-10-05T05:01:30.000Z'],
    [clockEvidence({ observedAt: '2026-10-05T05:03:00.000Z' }), '2026-10-05T05:01:30.000Z'],
    [clockEvidence({ rootDispersionSeconds: 2 }), '2026-10-05T05:01:30.000Z'],
  ]) assert.throws(() => validateTrustedClock(evidence, new Date(now)), /Invalid staging VPS release verification/);
});

test('chronyc collector parses only bounded tracking output from an allowlisted binary', async () => {
  const raw = `Reference ID    : CB00710F (time.example)\nStratum         : 3\nRef time (UTC)  : Sun Oct 05 05:00:00 2026\nSystem time     : 0.010 seconds slow of NTP time\nRoot delay      : 0.100 seconds\nRoot dispersion : 0.020 seconds\nLeap status     : Normal\n`;
  const parsed = parseChronycTracking(raw, new Date('2026-10-05T05:01:00.000Z'));
  assert.equal(parsed.referenceTime, '2026-10-05T05:00:00.000Z');
  const result = await readTrustedClock({ now: new Date('2026-10-05T05:01:30.000Z'), execute: async (binary, args, options) => {
    assert.equal(binary, '/usr/bin/chronyc'); assert.deepEqual(args, ['tracking']); assert.equal(options.timeout, 5000);
    return { stdout: raw };
  } });
  assert.equal(result.status, 'trusted-clock-valid');
  await assert.rejects(() => readTrustedClock({ chronycPath: '/tmp/chronyc', execute: async () => ({ stdout: raw }) }), /path/);
});

test('replay ledger verifies a canonical hash chain and exposes binding records', () => {
  const first = { sequence: 1, previousHash: hash('0'), event: 'observed', bindingSha256: hash('c'),
    requestId: 'request-1', artifactId: '99', envelopeSha256: imageDigest('2'), commit: 'd'.repeat(40),
    frontendDigest: imageDigest('e'), functionsDigest: imageDigest('f'), migrationTreeSha256: imageDigest('1'),
    recordedAt: '2026-10-05T05:02:00.000Z' };
  const second = { ...first, sequence: 2, previousHash: stagingVpsVerifierInternals.recordHash(first), event: 'failed', requestId: 'request-2', artifactId: '100' };
  const result = validateReplayLedger(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
  assert.equal(result.records.length, 2);
  assert.equal(result.headSha256, stagingVpsVerifierInternals.recordHash(second));
  assert.equal(validateReplayLedger('').records.length, 0);
});

test('replay ledger rejects broken chains, duplicate fields and malformed frames', () => {
  const record = { sequence: 1, previousHash: hash('9'), event: 'observed', bindingSha256: hash('c'),
    requestId: 'request-1', artifactId: '99', envelopeSha256: imageDigest('2'), commit: 'd'.repeat(40),
    frontendDigest: imageDigest('e'), functionsDigest: imageDigest('f'), migrationTreeSha256: imageDigest('1'),
    recordedAt: '2026-10-05T05:02:00.000Z' };
  assert.throws(() => validateReplayLedger(`${JSON.stringify(record)}\n`), /previous hash/);
  assert.throws(() => validateReplayLedger('{}'), /newline/);
  assert.throws(() => validateReplayLedger('{\"sequence\":1,\"sequence\":1}\n'), /(fields|canonical)/);
});

test('checked-in policy and inspect-only broker keep authorization blocked', () => {
  const result = evaluateStagingVpsAuthorization({
    policy: checkedInPolicy,
    bindingResult: binding(),
    clockResult: validateTrustedClock(clockEvidence(), new Date('2026-10-05T05:01:30.000Z')),
    ledgerResult: validateReplayLedger(''),
    bootstrapEvidence: bootstrap(),
    brokerStatus: { version: 1, code: 'OK', automationReady: false, liveStackVerified: false, capabilities: ['status.inspect'] },
  });
  assert.equal(result.authorizing, false);
  assert.ok(result.missingProof.includes('root-owned release policy automationReady=true after separate activation approval'));
  assert.ok(result.missingProof.includes('reviewed workflow blob and SHA-256 allowlist entry'));
  assert.ok(result.missingProof.includes('separately activated constrained broker with exact capabilities'));
});

test('workflow authorization requires both reviewed Git blob and independent SHA-256', () => {
  const altered = binding();
  altered.binding.workflowSha256 = hash('9');
  const result = evaluateStagingVpsAuthorization({
    policy: enabledPolicy(), bindingResult: altered,
    clockResult: validateTrustedClock(clockEvidence(), new Date('2026-10-05T05:01:30.000Z')),
    ledgerResult: validateReplayLedger(''), brokerStatus: broker(), bootstrapEvidence: bootstrap(),
  });
  assert.equal(result.authorizing, false);
  assert.ok(result.missingProof.includes('reviewed workflow blob and SHA-256 allowlist entry'));
});

test('complete fixture demonstrates composition without changing checked-in activation', () => {
  const result = evaluateStagingVpsAuthorization({
    policy: enabledPolicy(), bindingResult: binding(),
    clockResult: validateTrustedClock(clockEvidence(), new Date('2026-10-05T05:01:30.000Z')),
    ledgerResult: validateReplayLedger(''), brokerStatus: broker(), bootstrapEvidence: bootstrap(),
  });
  assert.equal(result.status, 'staging-vps-authorization-valid');
  assert.equal(result.authorizing, true);
});

function adapterBinding() {
  const value = binding();
  return { bindingSha256: value.bindingSha256, requestId: value.binding.requestId, artifactId: value.binding.artifactId,
    commit: value.binding.commit, workflowSha256: value.binding.workflowSha256,
    frontendDigest: value.binding.frontendDigest, functionsDigest: value.binding.functionsDigest,
    migrationTreeSha256: value.binding.migrationTreeSha256, latestMigration: value.binding.latestMigration };
}

test('adapters refuse every mutation while checked-in automation is disabled', () => {
  for (const operation of ['backup.capture', 'migration.apply', 'images.rollback']) {
    assert.throws(() => buildStagingAdapterRequest(operation, { binding: adapterBinding() }, checkedInPolicy), /automation is disabled/);
  }
});

test('adapter requests contain only fixed project and release identities', () => {
  const request = buildStagingAdapterRequest('backup.capture', { binding: adapterBinding() }, enabledPolicy());
  assert.deepEqual(Object.keys(request.request), ['version', 'operation', 'project', 'bootstrapSource',
    'bindingSha256', 'requestId', 'artifactId', 'commit', 'workflowSha256', 'frontendDigest', 'functionsDigest', 'migrationTreeSha256', 'latestMigration']);
  assert.equal(request.request.project, 'barber-staging-private');
  assert.ok(request.encoded.endsWith('\n'));
  const migration = buildStagingAdapterRequest('migration.apply', { binding: adapterBinding(), backupEvidenceId: `backup-${hash('3')}` }, enabledPolicy());
  assert.equal(migration.request.backupEvidenceId, `backup-${hash('3')}`);
});

test('adapters reject paths, commands, mutable images and ineffective rollback', () => {
  assert.throws(() => buildStagingAdapterRequest('backup.capture', { binding: adapterBinding(), command: 'sh' }, enabledPolicy()), /fields/);
  const mutable = adapterBinding(); mutable.frontendDigest = 'latest';
  assert.throws(() => buildStagingAdapterRequest('backup.capture', { binding: mutable }, enabledPolicy()), /identity/);
  const same = imageDigest('4');
  assert.throws(() => buildStagingAdapterRequest('images.rollback', { binding: adapterBinding(),
    rejectedFrontendDigest: same, rejectedFunctionsDigest: same, restoreFrontendDigest: same, restoreFunctionsDigest: same }, enabledPolicy()), /different/);
});

test('adapter replies require exact operation-bound evidence', () => {
  const good = `${JSON.stringify({ version: 1, code: 'OK', operation: 'backup.capture', evidenceId: `backup-${hash('5')}`, evidenceSha256: hash('6') })}\n`;
  const result = validateStagingAdapterReply(good, 'backup.capture');
  assert.equal(result.status, 'backup.capture-evidence-recorded');
  assert.equal(result.authorizing, false);
  assert.throws(() => validateStagingAdapterReply(good.replace('backup.capture', 'migration.apply'), 'backup.capture'), /success evidence/);
  assert.throws(() => validateStagingAdapterReply(`${JSON.stringify({ version: 1, code: 'OPERATION_DISABLED' })}\n`, 'backup.capture'), /refused/);
});
