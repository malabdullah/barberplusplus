import { createHash } from 'node:crypto';

const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const migrationPattern = /^\d{14}_[a-z0-9_]+$/;

function fail(message) {
  throw new Error(`Invalid staging release binding: ${message}`);
}

function one(values, name) {
  if (!Array.isArray(values) || values.length !== 1) return null;
  if (!values[0] || typeof values[0] !== 'object' || Array.isArray(values[0])) fail(`${name} entry must be an object`);
  return values[0];
}

function exact(actual, expected, name) {
  if (actual !== expected) fail(`${name} does not match the release envelope`);
}

function positiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${name} must be a positive safe integer`);
}

function canonicalTime(value, name) {
  if (typeof value !== 'string') fail(`${name} must be a string`);
  const date = new Date(value);
  try {
    if (date.toISOString() !== value) fail(`${name} must be canonical UTC ISO-8601`);
  } catch {
    fail(`${name} must be canonical UTC ISO-8601`);
  }
  return date.getTime();
}

function blocked(status, missingProof = []) {
  return Object.freeze({ status, authorizing: false, missingProof: Object.freeze(missingProof) });
}

export function bindStagingReleaseEvidence({
  envelopeJson,
  envelopeResults,
  attestationResults,
  approvalResults,
  ciRunRecords,
  artifactRecords,
  downloadedArtifacts,
  imageRecords,
  migrationRecords,
  replayRecords,
  now = new Date(),
}) {
  const envelopeResult = one(envelopeResults, 'envelopeResults');
  const attestation = one(attestationResults, 'attestationResults');
  const approval = one(approvalResults, 'approvalResults');
  const ciRun = one(ciRunRecords, 'ciRunRecords');
  const artifact = one(artifactRecords, 'artifactRecords');
  const downloaded = one(downloadedArtifacts, 'downloadedArtifacts');
  const migration = one(migrationRecords, 'migrationRecords');
  if (!envelopeResult || !attestation || !approval || !ciRun || !artifact || !downloaded || !migration
      || !Array.isArray(imageRecords) || imageRecords.length !== 2) {
    return blocked('blocked-ambiguous-release-evidence', ['exactly one record per evidence class and two image records']);
  }
  if (!Array.isArray(replayRecords)) fail('replayRecords must be an array');
  if (typeof envelopeJson !== 'string' || envelopeJson !== JSON.stringify(envelopeResult.envelope)) {
    fail('envelopeJson is not the exact canonical parsed envelope');
  }
  exact(envelopeResult.status, 'syntax-valid', 'envelope status');
  exact(envelopeResult.authorizing, false, 'envelope authorizing flag');
  const envelope = envelopeResult.envelope;

  exact(attestation.status, 'cryptography-and-certificate-policy-valid', 'attestation status');
  exact(attestation.cryptographyVerified, true, 'attestation cryptography flag');
  exact(attestation.authorizing, false, 'attestation authorizing flag');
  exact(approval.status, 'approval-evidence-policy-valid-first-attempt', 'approval status');
  exact(approval.attemptBound, true, 'approval attempt binding');
  exact(approval.authorizing, false, 'approval authorizing flag');

  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowTime)) fail('trusted-time input is invalid');
  const issuedAt = canonicalTime(envelope.issued_at, 'envelope.issued_at');
  const expiresAt = canonicalTime(envelope.expires_at, 'envelope.expires_at');
  if (expiresAt <= nowTime || issuedAt > nowTime + 60_000) {
    return blocked('blocked-stale-release-evidence', ['fresh envelope under a trusted server clock']);
  }

  const envelopeSha256 = createHash('sha256').update(envelopeJson, 'utf8').digest('hex');
  exact(attestation.artifactDigest, envelopeSha256, 'attested envelope digest');
  exact(attestation.commit, envelope.commit, 'attested commit');
  exact(attestation.releaseRunId, envelope.runs.release.id, 'attested release run ID');
  exact(attestation.releaseRunAttempt, envelope.runs.release.attempt, 'attested release run attempt');
  exact(approval.commit, envelope.commit, 'approved commit');
  exact(approval.releaseRunId, envelope.runs.release.id, 'approved release run ID');
  exact(approval.releaseRunAttempt, envelope.runs.release.attempt, 'approved release run attempt');
  exact(approval.workflowBlobSha, envelope.workflow.blob_sha, 'approved workflow blob SHA');
  exact(approval.environmentId, 21158713380, 'approved environment ID');
  exact(approval.reviewerId, 19295903, 'approved reviewer ID');

  exact(ciRun.id, Number(envelope.runs.ci.id), 'CI run ID');
  exact(ciRun.run_attempt, envelope.runs.ci.attempt, 'CI run attempt');
  exact(ciRun.status, 'completed', 'CI run status');
  exact(ciRun.conclusion, 'success', 'CI run conclusion');
  exact(ciRun.event, 'push', 'CI run event');
  exact(ciRun.head_branch, envelope.branch, 'CI run branch');
  exact(ciRun.head_sha, envelope.commit, 'CI run commit');
  if (!['.github/workflows/ci.yml', '.github/workflows/ci.yml@main'].includes(ciRun.path)) fail('CI workflow path is invalid');
  exact(ciRun.repository?.id, envelope.repository.id, 'CI repository ID');
  exact(ciRun.repository?.full_name, envelope.repository.full_name, 'CI repository name');
  exact(ciRun.head_repository?.id, envelope.repository.id, 'CI head repository ID');
  exact(ciRun.head_repository?.full_name, envelope.repository.full_name, 'CI head repository name');

  positiveSafeInteger(artifact.id, 'artifact.id');
  const artifactName = `staging-release-request-${envelope.commit}-${envelope.runs.release.id}-${envelope.runs.release.attempt}`;
  exact(artifact.name, artifactName, 'artifact.name');
  exact(artifact.expired, false, 'artifact.expired');
  if (!sha256Pattern.test(artifact.digest)) fail('artifact.digest is invalid');
  positiveSafeInteger(artifact.size_in_bytes, 'artifact.size_in_bytes');
  exact(String(artifact.workflow_run?.id), envelope.runs.release.id, 'artifact workflow run ID');
  exact(artifact.workflow_run?.repository_id, envelope.repository.id, 'artifact repository ID');
  exact(artifact.workflow_run?.head_repository_id, envelope.repository.id, 'artifact head repository ID');
  exact(artifact.workflow_run?.head_branch, envelope.branch, 'artifact branch');
  exact(artifact.workflow_run?.head_sha, envelope.commit, 'artifact commit');
  // GitHub REST uses whole-second UTC timestamps. Do not normalize or change
  // the signed envelope's stricter millisecond representation.
  if (typeof artifact.created_at !== 'string'
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(artifact.created_at)) fail('artifact.created_at is invalid');
  const artifactCreated = canonicalTime(artifact.created_at.length === 20
    ? artifact.created_at.replace(/Z$/, '.000Z') : artifact.created_at, 'artifact.created_at');
  if (artifactCreated < issuedAt || artifactCreated >= expiresAt) fail('artifact creation is outside the envelope window');

  exact(downloaded.artifactId, artifact.id, 'downloaded artifact ID');
  exact(downloaded.archiveDigest, artifact.digest, 'downloaded archive digest');
  exact(downloaded.archiveSizeInBytes, artifact.size_in_bytes, 'downloaded archive size');
  if (!Array.isArray(downloaded.entries) || downloaded.entries.length !== 1) fail('downloaded artifact must contain exactly one regular entry');
  const entry = downloaded.entries[0];
  exact(entry.name, 'staging-release-request.json', 'downloaded entry name');
  exact(entry.regularFile, true, 'downloaded entry type');
  exact(entry.sizeInBytes, Buffer.byteLength(envelopeJson, 'utf8'), 'downloaded envelope size');
  exact(entry.digest, `sha256:${envelopeSha256}`, 'downloaded envelope digest');

  const byRole = new Map();
  for (const image of imageRecords) {
    if (!image || typeof image !== 'object' || !['frontend', 'functions'].includes(image.role) || byRole.has(image.role)) {
      return blocked('blocked-ambiguous-release-evidence', ['one frontend and one Functions image record']);
    }
    byRole.set(image.role, image);
  }
  for (const role of ['frontend', 'functions']) {
    const image = byRole.get(role);
    if (!image) return blocked('blocked-ambiguous-release-evidence', ['one frontend and one Functions image record']);
    exact(image.repository, envelope.images[role].repository, `${role} repository`);
    exact(image.digest, envelope.images[role].digest, `${role} digest`);
    exact(image.status, 'image-manifest-and-attestation-valid', `${role} evidence status`);
    exact(image.attestationVerified, true, `${role} attestation verification`);
    exact(image.authorizing, false, `${role} authorizing flag`);
    exact(image.commit, envelope.commit, `${role} commit`);
    exact(image.releaseRunId, envelope.runs.release.id, `${role} release run ID`);
    exact(image.releaseRunAttempt, envelope.runs.release.attempt, `${role} release run attempt`);
  }

  if (!commitPattern.test(migration.commit)) fail('migration.commit is invalid');
  if (!sha256Pattern.test(migration.treeSha256)) fail('migration.treeSha256 is invalid');
  if (!migrationPattern.test(migration.latest)) fail('migration.latest is invalid');
  if (!Array.isArray(migration.migrations) || migration.migrations.length !== 4) fail('migration inventory must contain the four bootstrapped migrations');
  if (migration.migrations.at(-1)?.name !== `${migration.latest}.sql`) fail('migration inventory latest entry does not match');
  exact(migration.commit, envelope.commit, 'migration commit');
  exact(migration.treeSha256, envelope.migrations.tree_sha256, 'migration tree');
  exact(migration.latest, envelope.migrations.latest, 'latest migration');

  const binding = Object.freeze({
    repositoryId: envelope.repository.id,
    repository: envelope.repository.full_name,
    commit: envelope.commit,
    workflowBlobSha: envelope.workflow.blob_sha,
    workflowSha256: approval.reviewedWorkflowSha256,
    ciRunId: envelope.runs.ci.id,
    ciRunAttempt: envelope.runs.ci.attempt,
    releaseRunId: envelope.runs.release.id,
    releaseRunAttempt: envelope.runs.release.attempt,
    artifactId: String(artifact.id),
    artifactArchiveDigest: artifact.digest,
    envelopeSha256: `sha256:${envelopeSha256}`,
    requestId: envelope.request_id,
    nonce: envelope.nonce,
    frontendDigest: envelope.images.frontend.digest,
    functionsDigest: envelope.images.functions.digest,
    migrationTreeSha256: envelope.migrations.tree_sha256,
    latestMigration: envelope.migrations.latest,
  });
  const bindingSha256 = createHash('sha256').update(JSON.stringify(binding), 'utf8').digest('hex');
  const replayed = replayRecords.some((record) => record && typeof record === 'object' && (
    record.bindingSha256 === bindingSha256
    || record.requestId === binding.requestId
    || record.artifactId === binding.artifactId
    || record.envelopeSha256 === binding.envelopeSha256
    || (typeof record.requestId === 'string' && /^1123713308:[1-9]\d*:1:[0-9a-f]{32}$/.test(record.requestId)
      && (record.requestId.split(':')[1] === binding.releaseRunId || record.requestId.split(':')[3] === binding.nonce))
    || (record.commit === binding.commit
      && record.frontendDigest === binding.frontendDigest
      && record.functionsDigest === binding.functionsDigest
      && record.migrationTreeSha256 === binding.migrationTreeSha256)
  ));
  if (replayed) return blocked('blocked-replayed-release-evidence', ['fresh append-only replay-ledger entry']);

  return Object.freeze({
    status: 'release-artifact-binding-valid',
    authorizing: false,
    binding,
    bindingSha256,
    remainingAuthorizationChecks: Object.freeze([
      'authenticated-github-api-evidence',
      'authenticated-ghcr-image-evidence',
      'authenticated-migration-evidence',
      'trusted-server-clock',
      'persistent-append-only-replay-ledger',
      'broker-authorization',
    ]),
  });
}
