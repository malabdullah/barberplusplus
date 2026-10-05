import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
  readGitHubCiRunEvidence,
  inspectReleaseArtifactZip,
  readGhcrManifest,
  readGitHubMigrationEvidence,
  readGitHubReleaseEvidence,
  readPublicGhcrManifest,
} from './staging-evidence-transport.mjs';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(content, { name = 'staging-release-request.json', method = 8, flags = 0x800, externalAttributes = 0o100644 << 16 } = {}) {
  const body = Buffer.from(content);
  const compressed = method === 8 ? deflateRawSync(body) : body;
  const filename = Buffer.from(name);
  const checksum = crc32(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(externalAttributes >>> 0, 38);
  const localRecord = Buffer.concat([local, filename, compressed]);
  const centralRecord = Buffer.concat([central, filename]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, eocd]);
}

test('inspects one bounded regular canonical envelope without extracting files', () => {
  const content = '{"schema":"fixture"}';
  const result = inspectReleaseArtifactZip(zip(content));
  assert.equal(result.envelopeJson, content);
  assert.deepEqual(result.entries, [{
    name: 'staging-release-request.json',
    regularFile: true,
    sizeInBytes: Buffer.byteLength(content),
    digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
  }]);
});

test('rejects traversal, alternate names, links, encryption and unsupported compression', () => {
  for (const archive of [
    zip('{}', { name: '../staging-release-request.json' }),
    zip('{}', { name: 'other.json' }),
    zip('{}', { externalAttributes: 0o120777 << 16 }),
    zip('{}', { flags: 0x801 }),
    zip('{}', { flags: 0x840 }),
    zip('{}', { method: 9 }),
  ]) assert.throws(() => inspectReleaseArtifactZip(archive), /Invalid staging evidence transport/);
});

test('rejects oversized, corrupt, trailing, ZIP64 and hidden-entry structures', () => {
  assert.throws(() => inspectReleaseArtifactZip(Buffer.alloc(1024 * 1024 + 1)));
  const corrupt = zip('{}');
  corrupt[59] ^= 1;
  assert.throws(() => inspectReleaseArtifactZip(corrupt), /(decompression|CRC)/);
  assert.throws(() => inspectReleaseArtifactZip(Buffer.concat([zip('{}'), Buffer.from('tail')])));
  const zip64 = zip('{}');
  zip64.writeUInt32LE(0xffffffff, zip64.length - 22 + 16);
  assert.throws(() => inspectReleaseArtifactZip(zip64), /ZIP64/);
  const hidden = zip('{}');
  hidden.writeUInt16LE(2, hidden.length - 22 + 8);
  hidden.writeUInt16LE(2, hidden.length - 22 + 10);
  assert.throws(() => inspectReleaseArtifactZip(hidden), /exactly one/);
  const bytesBeforeDirectory = zip('{}');
  const directoryOffset = bytesBeforeDirectory.length - 22 - (46 + Buffer.byteLength('staging-release-request.json'));
  const withHiddenBytes = Buffer.concat([
    bytesBeforeDirectory.subarray(0, directoryOffset),
    Buffer.from('hidden'),
    bytesBeforeDirectory.subarray(directoryOffset),
  ]);
  withHiddenBytes.writeUInt32LE(directoryOffset + 6, withHiddenBytes.length - 22 + 16);
  assert.throws(() => inspectReleaseArtifactZip(withHiddenBytes), /hidden data/);
});

test('collects only allowlisted read-only GitHub evidence and bounded archive data', async () => {
  const commit = 'a'.repeat(40);
  const runId = '37180000002';
  const artifactId = '99';
  const envelope = '{"schema":"fixture"}';
  const archive = zip(envelope);
  const workflowSource = 'name: Deploy staging\n';
  const responses = new Map([
    [`repos/malabdullah/barberplusplus/actions/runs/${runId}`, { id: Number(runId), run_attempt: 1 }],
    [`repos/malabdullah/barberplusplus/actions/runs/${runId}/approvals`, []],
    ['repos/malabdullah/barberplusplus/environments/staging', { id: 21158713380, name: 'staging' }],
    [`repos/malabdullah/barberplusplus/actions/artifacts/${artifactId}`, {
      id: Number(artifactId),
      name: `staging-release-request-${commit}-${runId}-1`,
    }],
    [`repos/malabdullah/barberplusplus/contents/.github/workflows/deploy-staging.yml?ref=${commit}`, {
      path: '.github/workflows/deploy-staging.yml',
      sha: 'b'.repeat(40),
      encoding: 'base64',
      content: Buffer.from(workflowSource).toString('base64'),
    }],
  ]);
  const calls = [];
  const execute = async (binary, args, options) => {
    calls.push({ binary, args, options });
    const endpoint = args[1];
    if (endpoint === `repos/malabdullah/barberplusplus/actions/artifacts/${artifactId}/zip`) return { stdout: archive };
    return { stdout: Buffer.from(JSON.stringify(responses.get(endpoint))) };
  };
  const result = await readGitHubReleaseEvidence({
    releaseRunId: runId, artifactId, commit, ghPath: '/usr/local/bin/gh', execute,
  });
  assert.equal(result.status, 'read-only-github-evidence-collected');
  assert.equal(result.authorizing, false);
  assert.equal(result.workflowFile.source, workflowSource);
  assert.equal(result.downloadedArtifact.envelopeJson, envelope);
  assert.equal(calls.length, 6);
  assert.ok(calls.every((call) => call.binary === '/usr/local/bin/gh'));
  assert.ok(calls.every((call) => call.args[0] === 'api' && call.args.includes('GET') && call.options.encoding === null));
});

test('rejects unsafe GitHub identifiers, workflow payloads and verifier paths', async () => {
  await assert.rejects(() => readGitHubReleaseEvidence({ releaseRunId: '../1', artifactId: 2, commit: 'a'.repeat(40), execute: async () => ({ stdout: Buffer.from('{}') }) }));
  await assert.rejects(() => readGitHubReleaseEvidence({ releaseRunId: 1, artifactId: 2, commit: 'bad', execute: async () => ({ stdout: Buffer.from('{}') }) }));
  await assert.rejects(() => readGitHubReleaseEvidence({ releaseRunId: 1, artifactId: 2, commit: 'a'.repeat(40), ghPath: '/tmp/gh', execute: async () => ({ stdout: Buffer.from('{}') }) }));
  const commit = 'a'.repeat(40);
  const responses = [
    JSON.stringify({ id: 1, run_attempt: 1 }),
    '[]',
    '{}',
    JSON.stringify({ id: 2, name: `staging-release-request-${commit}-1-1` }),
    JSON.stringify({ path: '.github/workflows/deploy-staging.yml', encoding: 'base64', content: 'not base64!!!' }),
  ];
  await assert.rejects(() => readGitHubReleaseEvidence({
    releaseRunId: 1,
    artifactId: 2,
    commit,
    execute: async () => ({ stdout: Buffer.from(responses.shift()) }),
  }), /base64/);
});

test('rejects a non-release artifact before downloading its archive', async () => {
  const commit = 'a'.repeat(40);
  const endpoints = [
    JSON.stringify({ id: 1, run_attempt: 1 }),
    '[]',
    JSON.stringify({ id: 21158713380, name: 'staging' }),
    JSON.stringify({ id: 2, name: 'gitleaks-results.sarif' }),
  ];
  let calls = 0;
  await assert.rejects(() => readGitHubReleaseEvidence({
    releaseRunId: 1,
    artifactId: 2,
    commit,
    execute: async () => {
      calls += 1;
      return { stdout: Buffer.from(endpoints.shift()) };
    },
  }), /artifact is not the expected staging-release-request/);
  assert.equal(calls, 4);
});

test('collects only the successful same-repository protected-main CI source run', async () => {
  const commit = 'a'.repeat(40);
  const run = {
    id: 41, run_attempt: 1, status: 'completed', conclusion: 'success', event: 'push',
    head_branch: 'main', head_sha: commit, path: '.github/workflows/ci.yml',
    repository: { id: 1123713308, full_name: 'malabdullah/barberplusplus' },
    head_repository: { id: 1123713308, full_name: 'malabdullah/barberplusplus' },
  };
  const result = await readGitHubCiRunEvidence({
    ciRunId: 41,
    commit,
    execute: async (binary, args) => {
      assert.equal(binary, '/usr/bin/gh');
      assert.equal(args[1], 'repos/malabdullah/barberplusplus/actions/runs/41');
      return { stdout: Buffer.from(JSON.stringify(run)) };
    },
  });
  assert.equal(result.workflowRun.id, 41);
  assert.equal(result.authorizing, false);
  for (const mutate of [
    (value) => { value.event = 'pull_request'; },
    (value) => { value.head_sha = 'b'.repeat(40); },
    (value) => { value.head_repository.id = 1; },
    (value) => { value.conclusion = 'failure'; },
  ]) {
    const altered = structuredClone(run);
    mutate(altered);
    await assert.rejects(() => readGitHubCiRunEvidence({
      ciRunId: 41, commit, execute: async () => ({ stdout: Buffer.from(JSON.stringify(altered)) }),
    }), /protected-main source/);
  }
});

test('collects the exact bounded migration tree from one immutable commit', async () => {
  const commit = 'a'.repeat(40);
  const files = [
    ['20260901000000_baseline.sql', 'select 1;\n'],
    ['20260903111635_harden_authorization.sql', 'select 2;\n'],
  ];
  const listing = files.map(([name, body], index) => ({ name, path: `supabase/migrations/${name}`, type: 'file', size: Buffer.byteLength(body), sha: String(index + 1).repeat(40) }));
  const responses = new Map([[`repos/malabdullah/barberplusplus/contents/supabase/migrations?ref=${commit}`, listing]]);
  for (const [index, [name, body]] of files.entries()) responses.set(`repos/malabdullah/barberplusplus/contents/supabase/migrations/${name}?ref=${commit}`,
    { ...listing[index], encoding: 'base64', content: Buffer.from(body).toString('base64') });
  const calls = [];
  const result = await readGitHubMigrationEvidence({ commit, execute: async (binary, args) => {
    calls.push({ binary, args }); return { stdout: Buffer.from(JSON.stringify(responses.get(args[1]))) };
  } });
  const rows = files.map(([name, body]) => `${name}\0${createHash('sha256').update(body).digest('hex')}\n`).join('');
  assert.equal(result.treeSha256, `sha256:${createHash('sha256').update(rows).digest('hex')}`);
  assert.equal(result.latest, '20260903111635_harden_authorization');
  assert.equal(result.authorizing, false);
  assert.equal(calls.length, 3);
});

test('migration collection rejects alternate paths, duplicates, metadata changes and malformed content', async () => {
  const commit = 'a'.repeat(40);
  const base = { name: '20260901000000_baseline.sql', path: 'supabase/migrations/20260901000000_baseline.sql', type: 'file', size: 9, sha: '1'.repeat(40) };
  for (const listing of [
    [],
    [base, { ...base }],
    [{ ...base, name: '../baseline.sql' }],
    [{ ...base, path: 'production.sql' }],
  ]) await assert.rejects(() => readGitHubMigrationEvidence({ commit, execute: async () => ({ stdout: Buffer.from(JSON.stringify(listing)) }) }));
  let call = 0;
  await assert.rejects(() => readGitHubMigrationEvidence({
    commit,
    execute: async () => {
      call += 1;
      return {
        stdout: Buffer.from(JSON.stringify(
          call === 1
            ? [base]
            : { ...base, sha: '2'.repeat(40), encoding: 'base64', content: 'bad!' },
        )),
      };
    },
  }), /metadata/);
});

function manifestResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

test('collects a public immutable GHCR manifest only when body and registry digests agree', async () => {
  const body = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json' });
  const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  const result = await readPublicGhcrManifest({
    repository: 'malabdullah/barberplusplus',
    digest,
    fetchImpl: async () => manifestResponse(body, {
      headers: {
        'content-type': 'application/vnd.oci.image.manifest.v1+json',
        'docker-content-digest': digest,
      },
    }),
  });
  assert.equal(result.digest, digest);
  assert.equal(result.authorizing, false);
});

test('uses only an exact public GHCR bearer challenge and fails closed when pull is unavailable', async () => {
  const body = JSON.stringify({ schemaVersion: 2 });
  const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  let call = 0;
  const result = await readPublicGhcrManifest({
    repository: 'malabdullah/barberplusplus-functions',
    digest,
    fetchImpl: async (url, options) => {
      call += 1;
      if (call === 1) return manifestResponse('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:malabdullah/barberplusplus-functions:pull"' } });
      if (call === 2) return manifestResponse(JSON.stringify({ token: 'bounded-public-registry-token' }), { headers: { 'content-type': 'application/json' } });
      assert.equal(options.headers.Authorization, 'Bearer bounded-public-registry-token');
      return manifestResponse(body, { headers: { 'content-type': 'application/vnd.docker.distribution.manifest.v2+json', 'docker-content-digest': digest } });
    },
  });
  assert.equal(result.digest, digest);

  await assert.rejects(() => readPublicGhcrManifest({
    repository: 'malabdullah/barberplusplus-functions', digest,
    fetchImpl: async () => manifestResponse('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://evil.invalid/token",service="ghcr.io",scope="repository:malabdullah/barberplusplus-functions:pull"' } }),
  }), /challenge/);
});

test('uses read:packages credentials only for the exact GHCR token exchange', async () => {
  const body = JSON.stringify({ schemaVersion: 2 });
  const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  const token = 'github_pat_fixture_value_not_a_secret';
  let call = 0;
  const result = await readGhcrManifest({
    repository: 'malabdullah/barberplusplus', digest,
    credentials: { username: 'malabdullah', token },
    fetchImpl: async (url, options) => {
      call += 1;
      if (call === 1) return manifestResponse('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:malabdullah/barberplusplus:pull"' } });
      if (call === 2) {
        assert.equal(options.headers.Authorization, `Basic ${Buffer.from(`malabdullah:${token}`).toString('base64')}`);
        return manifestResponse(JSON.stringify({ token: 'bounded-registry-token' }));
      }
      assert.equal(options.headers.Authorization, 'Bearer bounded-registry-token');
      return manifestResponse(body, { headers: { 'content-type': 'application/vnd.oci.image.manifest.v1+json', 'docker-content-digest': digest } });
    },
  });
  assert.equal(result.digest, digest);
  assert.equal(JSON.stringify(result).includes(token), false);
  await assert.rejects(() => readGhcrManifest({ repository: 'malabdullah/barberplusplus', digest,
    credentials: { username: 'malabdullah', token: 'short' }, fetchImpl: fetch }), /credentials/);
});

test('rejects GHCR repository, digest, redirects, content type and digest mismatch', async () => {
  const body = '{}';
  const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  await assert.rejects(() => readPublicGhcrManifest({ repository: 'attacker/repo', digest, fetchImpl: fetch }));
  await assert.rejects(() => readPublicGhcrManifest({ repository: 'malabdullah/barberplusplus', digest: 'latest', fetchImpl: fetch }));
  await assert.rejects(() => readPublicGhcrManifest({
    repository: 'malabdullah/barberplusplus', digest,
    fetchImpl: async () => manifestResponse(body, { headers: { 'content-type': 'text/plain', 'docker-content-digest': digest } }),
  }), /content type/);
  await assert.rejects(() => readPublicGhcrManifest({
    repository: 'malabdullah/barberplusplus', digest,
    fetchImpl: async () => manifestResponse(body, { headers: { 'content-type': 'application/vnd.oci.image.manifest.v1+json', 'docker-content-digest': `sha256:${'0'.repeat(64)}` } }),
  }), /digest/);
});
