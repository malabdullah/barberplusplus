import assert from 'node:assert/strict';
import { createHash, sign } from 'node:crypto';
import { readGitHubReleaseEvidence, readGitHubCiRunEvidence, readGitHubMigrationEvidence, readPublicGhcrManifest } from './staging-evidence-transport.mjs';
import { parseStagingReleaseEnvelope } from './staging-release-envelope.mjs';
import { validateStagingApprovalEvidence } from './staging-approval-evidence.mjs';
import { verifyStagingEnvelopeAttestationOnline, verifyStagingImageAttestationOnline } from './staging-attestation-verifier.mjs';
import { readTrustedClock } from './staging-vps-verifier.mjs';

const permissions = Object.freeze({ actions: 'read', attestations: 'read', contents: 'read', metadata: 'read' });
const exactPermissions = (value) => assert.deepEqual(Object.entries(value).sort(), Object.entries(permissions).sort());
const hash = (value) => createHash('sha256').update(value).digest('hex');
const apiPaths = new Set(['GET /app/installations/167815503', 'POST /app/installations/167815503/access_tokens', 'GET /installation/repositories?per_page=100', 'DELETE /installation/token']);

export function validateObserverCredentialMetadata(stat) {
  // systemd 255 uses root-owned 0440 credential files with a per-service-user
  // ACL in its protected, read-only credential mount. Root's group is not a
  // newly granted service membership. Never accept a service-writable file.
  assert.ok(stat.isFile() && stat.uid === 0 && stat.gid === 0 && stat.nlink === 1
    && stat.size > 0 && stat.size <= 16384 && (stat.mode & 0o777) === 0o440);
}

export function parseObserverSelection(raw) {
  assert.equal(typeof raw, 'string');
  assert.ok(Buffer.byteLength(raw) <= 4096);
  const value = JSON.parse(raw);
  assert.deepEqual(Object.keys(value).sort(), ['artifactId', 'ciRunId', 'commit', 'releaseRunId', 'reviewedWorkflowSha256', 'workflowBlobSha'].sort());
  for (const field of ['artifactId', 'ciRunId', 'releaseRunId']) {
    assert.equal(typeof value[field], 'string');
    assert.match(value[field], /^[1-9]\d*$/);
    assert.ok(Number.isSafeInteger(Number(value[field])));
  }
  for (const field of ['commit', 'workflowBlobSha']) assert.match(value[field], /^[0-9a-f]{40}$/);
  assert.match(value.reviewedWorkflowSha256, /^[0-9a-f]{64}$/);
  return Object.freeze(value);
}

export async function githubAppApi(method, path, credential, payload, fetchImpl = fetch) {
  assert.ok(apiPaths.has(`${method} ${path}`));
  const response = await fetchImpl(`https://api.github.com${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${credential}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  assert.equal(response.status, method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200);
  if (response.status === 204) return null;
  const parts = []; let size = 0;
  for await (const part of response.body) {
    size += part.length; assert.ok(size <= 1024 * 1024); parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts));
}

// An App token is never returned to the caller or written to a file. Revocation
// is attempted even when scope validation or an observation fails.
export async function withObserverToken(privateKey, observe, { api = githubAppApi, now = Date.now() } = {}) {
  let token;
  let result;
  let phase = 'installation-scope';
  try {
    const seconds = Math.floor(now / 1000);
    const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: seconds - 60, exp: seconds + 300, iss: '5185797' })}`;
    const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
    const installation = await api('GET', '/app/installations/167815503', jwt);
    assert.equal(installation.app_id, 5185797); assert.equal(installation.id, 167815503);
    assert.equal(installation.account.id, 19295903); assert.equal(installation.account.login, 'malabdullah');
    assert.equal(installation.repository_selection, 'selected'); assert.equal(installation.suspended_at, null);
    exactPermissions(installation.permissions);
    const issued = await api('POST', '/app/installations/167815503/access_tokens', jwt, { repository_ids: [1123713308], permissions });
    assert.equal(typeof issued.token, 'string'); token = issued.token;
    assert.ok(token.length > 0 && token.length <= 16384);
    exactPermissions(issued.permissions);
    const expiry = Date.parse(issued.expires_at);
    assert.ok(expiry > now && expiry <= now + 65 * 60 * 1000);
    const repositories = await api('GET', '/installation/repositories?per_page=100', token);
    assert.equal(repositories.total_count, 1);
    assert.deepEqual(repositories.repositories.map(({ id, full_name }) => [id, full_name]), [[1123713308, 'malabdullah/barberplusplus']]);
    phase = 'observation';
    result = await observe(token);
  } catch {
    result = { status: 'observation-failed', phase, authorizing: false, deployed: false };
  } finally {
    let revoked = null;
    if (token) {
      try { await api('DELETE', '/installation/token', token); revoked = true; }
      catch { revoked = false; }
    }
    token = undefined;
    result = { ...result, ephemeralTokenRevoked: revoked };
    if (revoked === false) result = { ...result, status: 'observation-failed', phase: 'token-revocation' };
  }
  return { ...result, authorizing: false, deployed: false };
}

const defaults = {
  readGitHubReleaseEvidence, readGitHubCiRunEvidence, readGitHubMigrationEvidence,
  readPublicGhcrManifest, readTrustedClock, validateStagingApprovalEvidence,
  verifyStagingEnvelopeAttestationOnline, verifyStagingImageAttestationOnline,
};

// Observes individual proofs only. It deliberately does not call the aggregate
// authorization/binding helper with a fabricated empty replay ledger.
export async function observeSelectedRelease(selection, { execute, saveEnvelope, dependencies = defaults }) {
  let phase = 'clock';
  let envelopeSha256;
  try {
    const clock = await dependencies.readTrustedClock({ execute });
    phase = 'github-evidence';
    const options = { ...selection, ghPath: '/usr/local/bin/gh', execute };
    const release = await dependencies.readGitHubReleaseEvidence(options);
    const raw = release.downloadedArtifact.envelopeJson;
    envelopeSha256 = hash(raw);
    phase = 'envelope-freshness';
    const { envelope } = parseStagingReleaseEnvelope(raw, { now: new Date(clock.observedAt) });
    phase = 'release-identity';
    assert.equal(envelope.commit, selection.commit);
    assert.equal(envelope.workflow.blob_sha, selection.workflowBlobSha);
    assert.deepEqual(envelope.runs, { ci: { id: selection.ciRunId, attempt: 1 }, release: { id: selection.releaseRunId, attempt: 1 } });
    const artifact = release.artifactRecord;
    assert.equal(artifact.id, Number(selection.artifactId));
    assert.equal(artifact.expired, false);
    assert.deepEqual([
      artifact.workflow_run.id, artifact.workflow_run.repository_id, artifact.workflow_run.head_repository_id,
      artifact.workflow_run.head_sha, artifact.workflow_run.head_branch,
    ], [Number(selection.releaseRunId), 1123713308, 1123713308, selection.commit, 'main']);
    assert.equal(release.downloadedArtifact.archiveDigest, artifact.digest);
    assert.equal(release.downloadedArtifact.archiveSizeInBytes, artifact.size_in_bytes);
    assert.equal(release.downloadedArtifact.artifactId, artifact.id);
    // GitHub REST timestamps permit whole seconds; envelope timestamps remain
    // canonical millisecond UTC. Do not normalize the signed envelope.
    assert.match(artifact.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/);
    const created = Date.parse(artifact.created_at);
    assert.ok(created >= Date.parse(envelope.issued_at) && created < Date.parse(envelope.expires_at));
    phase = 'approval';
    const approval = dependencies.validateStagingApprovalEvidence({
      environmentPolicy: release.environmentPolicy, workflowRun: release.workflowRun,
      approvalHistory: release.approvalHistory, workflowSource: release.workflowFile.source,
      expected: { ...selection, releaseRunAttempt: 1 },
    });
    assert.equal(approval.status, 'approval-evidence-policy-valid-first-attempt');
    phase = 'ci-and-migrations';
    const ci = await dependencies.readGitHubCiRunEvidence(options);
    assert.equal(ci.workflowRun.run_attempt, 1);
    const migrations = await dependencies.readGitHubMigrationEvidence(options);
    assert.equal(migrations.commit, envelope.commit);
    assert.equal(migrations.treeSha256, envelope.migrations.tree_sha256);
    assert.equal(migrations.latest, envelope.migrations.latest);
    assert.equal(migrations.migrations.length, 4);
    phase = 'envelope-signature';
    const artifactPath = saveEnvelope(raw);
    const signature = await dependencies.verifyStagingEnvelopeAttestationOnline({ ...options, artifactPath, artifactDigest: envelopeSha256, releaseRunAttempt: 1 });
    assert.equal(signature.cryptographyVerified, true);
    const images = [];
    for (const role of ['frontend', 'functions']) {
      phase = `${role}-signature`;
      const { repository, digest } = envelope.images[role];
      const manifestEvidence = await dependencies.readPublicGhcrManifest({ repository: repository.slice(8), digest });
      const image = await dependencies.verifyStagingImageAttestationOnline({ ...options, role, repository, digest, manifestEvidence, releaseRunAttempt: 1 });
      assert.equal(image.attestationVerified, true);
      images.push({ role, digest });
    }
    phase = 'final-freshness';
    const finalClock = await dependencies.readTrustedClock({ execute });
    parseStagingReleaseEnvelope(raw, { now: new Date(finalClock.observedAt) });
    return { status: 'individual-evidence-checks-passed', commit: selection.commit, releaseRunId: selection.releaseRunId,
      artifactId: selection.artifactId, envelopeSha256, images, clock: finalClock,
      authorizing: false, replayLedgerVerified: false, deployed: false };
  } catch {
    // Never echo API responses, subprocess errors, URLs, or credential values.
    return { status: 'observation-rejected', phase, envelopeSha256,
      authorizing: false, replayLedgerVerified: false, deployed: false };
  }
}
