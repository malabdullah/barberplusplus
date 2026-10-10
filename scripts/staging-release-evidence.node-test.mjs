import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { parseStagingReleaseEnvelope } from './staging-release-envelope.mjs';
import { bindStagingReleaseEvidence } from './staging-release-evidence.mjs';

const now = new Date('2026-10-04T12:00:00.000Z');
const commit = 'a'.repeat(40);
const digest = (character) => `sha256:${character.repeat(64)}`;

function evidence() {
  const nonce = '12'.repeat(16);
  const envelope = {
    schema: 'barber-staging-release-request/v1',
    action: 'deploy-staging',
    repository: { id: 1123713308, full_name: 'malabdullah/barberplusplus' },
    workflow: { path: '.github/workflows/deploy-staging.yml', blob_sha: 'b'.repeat(40) },
    runs: { ci: { id: '37180000001', attempt: 1 }, release: { id: '37180000002', attempt: 1 } },
    commit,
    branch: 'main',
    images: {
      frontend: { repository: 'ghcr.io/malabdullah/barberplusplus', digest: digest('c') },
      functions: { repository: 'ghcr.io/malabdullah/barberplusplus-functions', digest: digest('d') },
    },
    migrations: { tree_sha256: digest('e'), latest: '20260903111635_secure_staging_boundary' },
    environment: 'staging',
    origins: {
      app: 'https://staging-barber.malabdullah.cloud',
      supabase: 'https://supabase-staging.malabdullah.cloud',
    },
    issued_at: '2026-10-04T11:59:00.000Z',
    expires_at: '2026-10-04T12:14:00.000Z',
    nonce,
    request_id: `1123713308:37180000002:1:${nonce}`,
  };
  const envelopeJson = JSON.stringify(envelope);
  const envelopeSha = createHash('sha256').update(envelopeJson).digest('hex');
  const archiveDigest = digest('f');
  return {
    envelopeJson,
    envelopeResults: [parseStagingReleaseEnvelope(envelopeJson, { now })],
    attestationResults: [{
      status: 'cryptography-and-certificate-policy-valid',
      cryptographyVerified: true,
      authorizing: false,
      artifactDigest: envelopeSha,
      commit,
      releaseRunId: envelope.runs.release.id,
      releaseRunAttempt: 1,
    }],
    approvalResults: [{
      status: 'approval-evidence-policy-valid-first-attempt',
      authorizing: false,
      attemptBound: true,
      commit,
      releaseRunId: envelope.runs.release.id,
      releaseRunAttempt: 1,
      workflowBlobSha: envelope.workflow.blob_sha,
      reviewedWorkflowSha256: '9'.repeat(64),
      environmentId: 21158713380,
      reviewerId: 19295903,
    }],
    ciRunRecords: [{
      id: Number(envelope.runs.ci.id), run_attempt: envelope.runs.ci.attempt,
      status: 'completed', conclusion: 'success', event: 'push', path: '.github/workflows/ci.yml',
      head_branch: 'main', head_sha: commit,
      repository: { id: envelope.repository.id, full_name: envelope.repository.full_name },
      head_repository: { id: envelope.repository.id, full_name: envelope.repository.full_name },
    }],
    artifactRecords: [{
      id: 99,
      name: `staging-release-request-${commit}-${envelope.runs.release.id}-1`,
      size_in_bytes: 1000,
      expired: false,
      digest: archiveDigest,
      created_at: '2026-10-04T11:59:30.000Z',
      workflow_run: {
        id: Number(envelope.runs.release.id),
        repository_id: envelope.repository.id,
        head_repository_id: envelope.repository.id,
        head_branch: envelope.branch,
        head_sha: commit,
      },
    }],
    downloadedArtifacts: [{
      artifactId: 99,
      archiveDigest,
      archiveSizeInBytes: 1000,
      entries: [{
        name: 'staging-release-request.json',
        regularFile: true,
        sizeInBytes: Buffer.byteLength(envelopeJson),
        digest: `sha256:${envelopeSha}`,
      }],
    }],
    imageRecords: [
      {
        status: 'image-manifest-and-attestation-valid', attestationVerified: true, authorizing: false,
        role: 'frontend', repository: envelope.images.frontend.repository,
        digest: envelope.images.frontend.digest, commit,
        releaseRunId: envelope.runs.release.id, releaseRunAttempt: envelope.runs.release.attempt,
      },
      {
        status: 'image-manifest-and-attestation-valid', attestationVerified: true, authorizing: false,
        role: 'functions', repository: envelope.images.functions.repository,
        digest: envelope.images.functions.digest, commit,
        releaseRunId: envelope.runs.release.id, releaseRunAttempt: envelope.runs.release.attempt,
      },
    ],
    migrationRecords: [{
      commit,
      treeSha256: envelope.migrations.tree_sha256,
      latest: envelope.migrations.latest,
      migrations: [
        { name: '20260901000000_baseline.sql', sha256: '1'.repeat(64) },
        { name: '20260902095726_trusted_authorization_and_cron.sql', sha256: '2'.repeat(64) },
        { name: '20260903111500_restore_remaining_baseline.sql', sha256: '3'.repeat(64) },
        { name: '20260903111635_secure_staging_boundary.sql', sha256: '4'.repeat(64) },
      ],
    }],
    replayRecords: [],
    now,
  };
}

test('binds the exact release tuple but never authorizes deployment', () => {
  const result = bindStagingReleaseEvidence(evidence());
  assert.equal(result.status, 'release-artifact-binding-valid');
  assert.equal(result.authorizing, false);
  assert.deepEqual(
    {
      repository: result.binding.repository,
      commit: result.binding.commit,
      workflowSha256: result.binding.workflowSha256,
      frontend: result.binding.frontendDigest,
      functions: result.binding.functionsDigest,
      migration: result.binding.migrationTreeSha256,
    },
    {
      repository: 'malabdullah/barberplusplus',
      commit,
      workflowSha256: '9'.repeat(64),
      frontend: digest('c'),
      functions: digest('d'),
      migration: digest('e'),
    },
  );
  assert.ok(result.remainingAuthorizationChecks.includes('persistent-append-only-replay-ledger'));
});

test('rejects commit, workflow run and attested envelope substitutions', () => {
  for (const mutate of [
    (value) => { value.attestationResults[0].artifactDigest = '1'.repeat(64); },
    (value) => { value.attestationResults[0].commit = '2'.repeat(40); },
    (value) => { value.attestationResults[0].releaseRunId = '1'; },
    (value) => { value.approvalResults[0].commit = '3'.repeat(40); },
    (value) => { value.approvalResults[0].releaseRunAttempt = 2; },
    (value) => { value.artifactRecords[0].workflow_run.head_sha = '4'.repeat(40); },
    (value) => { value.artifactRecords[0].workflow_run.repository_id = 1; },
    (value) => { value.ciRunRecords[0].head_sha = '5'.repeat(40); },
  ]) {
    const value = evidence();
    mutate(value);
    assert.throws(() => bindStagingReleaseEvidence(value), /Invalid staging release binding/);
  }
});

test('rejects frontend, Functions and migration identity substitutions', () => {
  for (const mutate of [
    (value) => { value.imageRecords[0].repository = 'ghcr.io/attacker/app'; },
    (value) => { value.imageRecords[0].digest = digest('1'); },
    (value) => { value.imageRecords[1].commit = '2'.repeat(40); },
    (value) => { value.imageRecords[1].releaseRunId = '1'; },
    (value) => { value.imageRecords[0].attestationVerified = false; },
    (value) => { value.migrationRecords[0].treeSha256 = digest('3'); },
    (value) => { value.migrationRecords[0].latest = '20260903111636_other'; },
    (value) => { value.migrationRecords[0].migrations.pop(); },
  ]) {
    const value = evidence();
    mutate(value);
    assert.throws(() => bindStagingReleaseEvidence(value), /Invalid staging release binding/);
  }
});

test('rejects expired or altered GitHub artifact and downloaded archive evidence', () => {
  for (const mutate of [
    (value) => { value.artifactRecords[0].expired = true; },
    (value) => { value.artifactRecords[0].name = 'other'; },
    (value) => { value.downloadedArtifacts[0].archiveDigest = digest('1'); },
    (value) => { value.downloadedArtifacts[0].entries[0].digest = digest('2'); },
    (value) => { value.downloadedArtifacts[0].entries.push({ ...value.downloadedArtifacts[0].entries[0] }); },
    (value) => { value.artifactRecords[0].created_at = '2026-10-04T12:15:00.000Z'; },
  ]) {
    const value = evidence();
    mutate(value);
    assert.throws(() => bindStagingReleaseEvidence(value), /Invalid staging release binding/);
  }
});

test('blocks stale evidence even when every identity still matches', () => {
  const value = evidence();
  value.now = new Date('2026-10-04T12:14:00.000Z');
  const result = bindStagingReleaseEvidence(value);
  assert.equal(result.status, 'blocked-stale-release-evidence');
  assert.equal(result.authorizing, false);
});

test('blocks replay by any unique identity or exact release tuple', () => {
  const baseline = bindStagingReleaseEvidence(evidence());
  for (const replay of [
    { bindingSha256: baseline.bindingSha256 },
    { requestId: baseline.binding.requestId },
    { artifactId: baseline.binding.artifactId },
    { envelopeSha256: baseline.binding.envelopeSha256 },
    { requestId: `1123713308:${baseline.binding.releaseRunId}:1:${'a'.repeat(32)}` },
    { requestId: `1123713308:999:1:${baseline.binding.nonce}` },
    {
      commit: baseline.binding.commit,
      frontendDigest: baseline.binding.frontendDigest,
      functionsDigest: baseline.binding.functionsDigest,
      migrationTreeSha256: baseline.binding.migrationTreeSha256,
    },
  ]) {
    const value = evidence();
    value.replayRecords = [replay];
    const result = bindStagingReleaseEvidence(value);
    assert.equal(result.status, 'blocked-replayed-release-evidence');
    assert.equal(result.authorizing, false);
  }
});

test('blocks missing, duplicate or role-ambiguous evidence', () => {
  for (const mutate of [
    (value) => { value.attestationResults = []; },
    (value) => { value.ciRunRecords = []; },
    (value) => { value.artifactRecords.push({ ...value.artifactRecords[0] }); },
    (value) => { value.migrationRecords = []; },
    (value) => { value.imageRecords[1].role = 'frontend'; },
  ]) {
    const value = evidence();
    mutate(value);
    const result = bindStagingReleaseEvidence(value);
    assert.equal(result.status, 'blocked-ambiguous-release-evidence');
    assert.equal(result.authorizing, false);
  }
});

test('fixture aggregation is never authenticated transport or deployment authorization', () => {
  const result = bindStagingReleaseEvidence(evidence());
  assert.equal(result.authorizing, false);
  assert.ok(result.remainingAuthorizationChecks.includes('authenticated-github-api-evidence'));
  assert.ok(result.remainingAuthorizationChecks.includes('authenticated-ghcr-image-evidence'));
  assert.ok(result.remainingAuthorizationChecks.includes('broker-authorization'));
});

test('GitHub whole-second artifact timestamps work without weakening signed-envelope timestamps', () => {
  const value = evidence();
  value.artifactRecords[0].created_at = '2026-10-04T11:59:30Z';
  assert.equal(bindStagingReleaseEvidence(value).status, 'release-artifact-binding-valid');
  for (const invalid of ['2026-10-04T11:59:30+00:00', '2026-02-30T11:59:30Z', '2026-10-04T11:59:30.00Z', '2026-10-04T12:15:00Z']) {
    value.artifactRecords[0].created_at = invalid;
    assert.throws(() => bindStagingReleaseEvidence(value), /Invalid staging release binding/);
  }
  const envelope = JSON.parse(value.envelopeJson); envelope.issued_at = '2026-10-04T11:59:00Z';
  assert.throws(() => parseStagingReleaseEnvelope(JSON.stringify(envelope), { now }));
});
