import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseObserverSelection, validateObserverCredentialMetadata, withObserverToken, githubAppApi, observeSelectedRelease } from './staging-observer.mjs';

const selection = parseObserverSelection(readFileSync(new URL('../ops/staging-vps/observer/selection.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-10-08T10:00:00.000Z');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const permissions = { actions: 'read', attestations: 'read', contents: 'read', metadata: 'read' };
test('credential metadata matches protected systemd 255 mount, never writable or world-readable', () => {
  const stat = { uid: 0, gid: 0, nlink: 1, size: 1700, mode: 0o440, isFile: () => true };
  validateObserverCredentialMetadata(stat);
  for (const patch of [{ uid: 997 }, { gid: 985 }, { mode: 0o444 }, { mode: 0o640 }, { nlink: 2 }, { size: 0 }, { size: 17000 }, { isFile: () => false }]) {
    assert.throws(() => validateObserverCredentialMetadata({ ...stat, ...patch }));
  }
});
function fakeApi(mutator = () => {}, revokeFailure = false) {
  const calls = [];
  const api = async (method, path, credential, payload) => {
    calls.push({ method, path, payload });
    if (method === 'DELETE') { if (revokeFailure) throw Error('sensitive server output'); return null; }
    let value;
    if (method === 'POST') value = { token: 'synthetic-test-token', permissions: { ...permissions }, expires_at: '2026-10-08T11:00:00Z' };
    else if (path.startsWith('/installation/')) value = { total_count: 1, repositories: [{ id: 1123713308, full_name: 'malabdullah/barberplusplus' }] };
    else value = { app_id: 5185797, id: 167815503, account: { id: 19295903, login: 'malabdullah' }, repository_selection: 'selected', suspended_at: null, permissions: { ...permissions } };
    mutator(value, method, path); return value;
  };
  return { api, calls, now };
}
test('selection rejects extra fields, commands, unsafe IDs and non-digests', () => {
  for (const patch of [{ command: 'deploy' }, { artifactId: '../99' }, { ciRunId: 123 }, { releaseRunId: '9007199254740992' }, { commit: 'main' }, { reviewedWorkflowSha256: 'latest' }]) {
    assert.throws(() => parseObserverSelection(JSON.stringify({ ...selection, ...patch })));
  }
});
test('token is single-repository, read-only, revoked and not returned', async () => {
  const fixture = fakeApi();
  const result = await withObserverToken(privateKey, async (token) => {
    assert.equal(token, 'synthetic-test-token'); return { status: 'observed', authorizing: false };
  }, fixture);
  assert.equal(result.ephemeralTokenRevoked, true);
  assert.equal(JSON.stringify(result).includes('synthetic-test-token'), false);
  assert.deepEqual(fixture.calls.find((call) => call.method === 'POST').payload, { repository_ids: [1123713308], permissions });
});
test('wrong installation or widened initial permissions refuses token creation', async () => {
  for (const field of ['app_id', 'id', 'suspended_at', 'repository_selection', 'permissions']) {
    const fixture = fakeApi((value, method, path) => { if (path === '/app/installations/167815503') value[field] = field === 'permissions' ? { ...permissions, issues: 'write' } : 'wrong'; });
    const result = await withObserverToken(privateKey, async () => assert.fail(), fixture);
    assert.equal(result.status, 'observation-failed'); assert.equal(fixture.calls.length, 1);
  }
});
test('issued token is revoked on permission, repository, expiry or observation failure', async () => {
  const mutations = [
    (value, method) => { if (method === 'POST') value.permissions.contents = 'write'; },
    (value) => { if (value.repositories) value.repositories.push({ id: 99, full_name: 'wrong/repo' }); },
    (value, method) => { if (method === 'POST') value.expires_at = '2026-10-08T09:00:00Z'; },
    () => {},
  ];
  for (const mutation of mutations) {
    const fixture = fakeApi(mutation);
    const result = await withObserverToken(privateKey, async () => { throw Error('secret-text'); }, fixture);
    assert.equal(result.status, 'observation-failed'); assert.equal(result.ephemeralTokenRevoked, true);
    assert.equal(fixture.calls.at(-1).method, 'DELETE'); assert.ok(!JSON.stringify(result).includes('secret-text'));
  }
});
test('revocation failure overrides otherwise successful observation', async () => {
  const result = await withObserverToken(privateKey, async () => ({ status: 'individual-evidence-checks-passed' }), fakeApi(undefined, true));
  assert.equal(result.phase, 'token-revocation'); assert.equal(result.status, 'observation-failed');
});
test('App HTTP boundary forbids arbitrary requests and redirects', async () => {
  await assert.rejects(githubAppApi('GET', '/user', 'test', null, () => assert.fail()));
  await assert.rejects(githubAppApi('GET', '/app/installations/167815503', 'test', null, async (url, options) => {
    assert.equal(url, 'https://api.github.com/app/installations/167815503'); assert.equal(options.redirect, 'error'); return { status: 302 };
  }));
});

function evidenceFixture() {
  const envelope = {
    schema: 'barber-staging-release-request/v1', action: 'deploy-staging',
    repository: { id: 1123713308, full_name: 'malabdullah/barberplusplus' },
    workflow: { path: '.github/workflows/deploy-staging.yml', blob_sha: selection.workflowBlobSha },
    runs: { ci: { id: selection.ciRunId, attempt: 1 }, release: { id: selection.releaseRunId, attempt: 1 } },
    commit: selection.commit, branch: 'main',
    images: { frontend: { repository: 'ghcr.io/malabdullah/barberplusplus', digest: `sha256:${'a'.repeat(64)}` }, functions: { repository: 'ghcr.io/malabdullah/barberplusplus-functions', digest: `sha256:${'b'.repeat(64)}` } },
    migrations: { tree_sha256: `sha256:${'c'.repeat(64)}`, latest: '20260903111635_test' },
    environment: 'staging', origins: { app: 'https://staging-barber.malabdullah.cloud', supabase: 'https://supabase-staging.malabdullah.cloud' },
    issued_at: '2026-10-08T09:59:00.000Z', expires_at: '2026-10-08T10:14:00.000Z', nonce: 'd'.repeat(32), request_id: `1123713308:${selection.releaseRunId}:1:${'d'.repeat(32)}`,
  };
  const artifact = { id: Number(selection.artifactId), expired: false, digest: 'archive', size_in_bytes: 123, created_at: '2026-10-08T09:59:02Z', workflow_run: { id: Number(selection.releaseRunId), repository_id: 1123713308, head_repository_id: 1123713308, head_sha: selection.commit, head_branch: 'main' } };
  const downloaded = { artifactId: artifact.id, archiveDigest: artifact.digest, archiveSizeInBytes: 123 };
  let clockCalls = 0;
  const dependencies = {
    readTrustedClock: async () => { clockCalls++; return { observedAt: new Date(now).toISOString() }; },
    readGitHubReleaseEvidence: async () => ({ artifactRecord: artifact, downloadedArtifact: { ...downloaded, envelopeJson: JSON.stringify(envelope) }, workflowFile: { source: 'fixture' } }),
    validateStagingApprovalEvidence: () => ({ status: 'approval-evidence-policy-valid-first-attempt' }),
    readGitHubCiRunEvidence: async () => ({ workflowRun: { run_attempt: 1 } }),
    readGitHubMigrationEvidence: async () => ({ commit: envelope.commit, treeSha256: envelope.migrations.tree_sha256, latest: envelope.migrations.latest, migrations: [1, 2, 3, 4] }),
    verifyStagingEnvelopeAttestationOnline: async () => ({ cryptographyVerified: true }),
    readPublicGhcrManifest: async () => ({}),
    verifyStagingImageAttestationOnline: async () => ({ attestationVerified: true }),
  };
  return { envelope, artifact, downloaded, dependencies, clockCalls: () => clockCalls, saveEnvelope: () => '/synthetic/envelope.json' };
}
test('successful mocked composition remains non-authorizing with no replay claim', async () => {
  const fixture = evidenceFixture();
  const result = await observeSelectedRelease(selection, fixture);
  assert.equal(result.status, 'individual-evidence-checks-passed'); assert.equal(fixture.clockCalls(), 2);
  assert.equal(result.authorizing, false); assert.equal(result.deployed, false); assert.equal(result.replayLedgerVerified, false);
});
test('expiry and malformed evidence fail before signature execution', async () => {
  const fixture = evidenceFixture();
  fixture.envelope.issued_at = '2026-10-05T08:04:36.689Z'; fixture.envelope.expires_at = '2026-10-05T08:19:36.689Z';
  fixture.dependencies.verifyStagingEnvelopeAttestationOnline = () => assert.fail();
  const result = await observeSelectedRelease(selection, fixture);
  assert.equal(result.status, 'observation-rejected'); assert.equal(result.phase, 'envelope-freshness');
});
test('rerun, foreign artifact, digest mismatch and absent approval are rejected', async () => {
  for (const mutate of [
    (f) => { f.envelope.runs.ci.attempt = 2; },
    (f) => { f.artifact.workflow_run.repository_id = 99; },
    (f) => { f.downloaded.archiveDigest = 'wrong'; },
    (f) => { f.dependencies.validateStagingApprovalEvidence = () => ({ status: 'blocked' }); },
    (f) => { f.dependencies.verifyStagingImageAttestationOnline = async () => ({ attestationVerified: false }); },
    (f) => { f.dependencies.readGitHubMigrationEvidence = async () => { throw Error('raw sensitive output'); }; },
  ]) {
    const fixture = evidenceFixture(); mutate(fixture);
    const result = await observeSelectedRelease(selection, fixture);
    assert.equal(result.status, 'observation-rejected'); assert.ok(!JSON.stringify(result).includes('raw sensitive output'));
  }
});
test('expiry during signature verification fails at the final clock gate', async () => {
  const fixture = evidenceFixture(); let calls = 0;
  fixture.dependencies.readTrustedClock = async () => ({ observedAt: new Date(now + (calls++ ? 900000 : 0)).toISOString() });
  const result = await observeSelectedRelease(selection, fixture);
  assert.equal(result.status, 'observation-rejected'); assert.equal(result.phase, 'final-freshness');
});
test('unit has no schedule or broker privileges and uses encrypted systemd credentials', () => {
  const unit = readFileSync(new URL('../ops/staging-vps/observer/barber-staging-observer.service', import.meta.url), 'utf8');
  for (const line of ['User=barber-staging-deploy', 'NoNewPrivileges=yes', 'ProtectSystem=strict', 'ProtectClock=yes', 'LimitCORE=0', 'Restart=no', 'CapabilityBoundingSet=', 'PrivateTmp=yes']) assert.ok(unit.split('\n').includes(line));
  assert.match(unit, /LoadCredentialEncrypted=github-app-private-key.pem:/);
  assert.doesNotMatch(unit, /\[Install\]|WantedBy=|SupplementaryGroups=|^Environment=.*TOKEN/m);
  assert.match(unit, /^UnsetEnvironment=.*NODE_OPTIONS.*GH_TOKEN/m);
});
