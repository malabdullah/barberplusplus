import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';

const execFileAsync = promisify(execFile);
const apiPrefix = 'repos/malabdullah/barberplusplus/';
const maxJsonBytes = 1024 * 1024;
const maxArchiveBytes = 1024 * 1024;
const maxEnvelopeBytes = 16 * 1024;
const digestPattern = /^sha256:[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(`Invalid staging evidence transport: ${message}`);
}

function positiveId(value, name) {
  const string = String(value);
  if (!/^[1-9]\d*$/.test(string) || !Number.isSafeInteger(Number(string))) fail(`${name} must be a positive safe integer`);
  return string;
}

function parseJsonBuffer(stdout, name, maximum = maxJsonBytes) {
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '');
  if (bytes.length === 0 || bytes.length > maximum) fail(`${name} response is absent or oversized`);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(`${name} response is not JSON`);
  }
}

function decodeCanonicalBase64(content, name, maximum) {
  if (typeof content !== 'string') fail(`${name} is not base64 content`);
  const encoded = content.replace(/\n/g, '');
  if (encoded.length === 0 || encoded.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail(`${name} base64 is invalid`);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.length === 0 || bytes.length > maximum) fail(`${name} base64 is noncanonical or oversized`);
  return bytes;
}

async function ghApi(execute, ghPath, endpoint, maximum = maxJsonBytes) {
  if (!endpoint.startsWith(apiPrefix) || /[\0\s]/.test(endpoint) || endpoint.includes('..')) fail('GitHub API endpoint is not allowlisted');
  const { stdout } = await execute(ghPath, [
    'api', endpoint,
    '--method', 'GET',
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2026-03-10',
  ], {
    encoding: null,
    maxBuffer: maximum,
    timeout: 30_000,
    windowsHide: true,
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '');
}

export async function readGitHubReleaseEvidence({
  releaseRunId,
  artifactId,
  commit,
  ghPath = '/usr/bin/gh',
  execute = execFileAsync,
}) {
  const runId = positiveId(releaseRunId, 'releaseRunId');
  const artifact = positiveId(artifactId, 'artifactId');
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('commit must be a lowercase full SHA');
  if (!['/usr/bin/gh', '/usr/local/bin/gh', '/opt/homebrew/bin/gh'].includes(ghPath)) fail('ghPath is not allowlisted');

  const run = parseJsonBuffer(await ghApi(execute, ghPath, `${apiPrefix}actions/runs/${runId}`), 'workflow run');
  const approvals = parseJsonBuffer(await ghApi(execute, ghPath, `${apiPrefix}actions/runs/${runId}/approvals`, 256 * 1024), 'approval history', 256 * 1024);
  const environment = parseJsonBuffer(await ghApi(execute, ghPath, `${apiPrefix}environments/staging`, 256 * 1024), 'staging environment', 256 * 1024);
  const artifactRecord = parseJsonBuffer(await ghApi(execute, ghPath, `${apiPrefix}actions/artifacts/${artifact}`, 256 * 1024), 'artifact record', 256 * 1024);
  const runAttempt = positiveId(run.run_attempt, 'workflow run attempt');
  const expectedArtifactName = `staging-release-request-${commit}-${runId}-${runAttempt}`;
  if (artifactRecord.id !== Number(artifact) || artifactRecord.name !== expectedArtifactName) {
    fail(`artifact is not the expected ${expectedArtifactName}`);
  }
  const workflowFile = parseJsonBuffer(await ghApi(execute, ghPath, `${apiPrefix}contents/.github/workflows/deploy-staging.yml?ref=${commit}`, 256 * 1024), 'workflow file', 256 * 1024);
  if (workflowFile.encoding !== 'base64' || typeof workflowFile.content !== 'string') fail('workflow file is not base64 content');
  const workflowBytes = decodeCanonicalBase64(workflowFile.content, 'workflow file', 128 * 1024);
  const workflowSource = workflowBytes.toString('utf8');
  if (Buffer.from(workflowSource, 'utf8').compare(workflowBytes) !== 0) fail('workflow source is not valid UTF-8');
  if (Buffer.byteLength(workflowSource) === 0 || Buffer.byteLength(workflowSource) > 128 * 1024) fail('workflow source is absent or oversized');
  if (workflowFile.path !== '.github/workflows/deploy-staging.yml') fail('workflow file path is unexpected');

  const archive = await ghApi(execute, ghPath, `${apiPrefix}actions/artifacts/${artifact}/zip`, maxArchiveBytes);
  const inspectedArchive = inspectReleaseArtifactZip(archive);
  return Object.freeze({
    status: 'read-only-github-evidence-collected',
    authorizing: false,
    workflowRun: run,
    approvalHistory: approvals,
    environmentPolicy: environment,
    artifactRecord,
    workflowFile: Object.freeze({ path: workflowFile.path, gitBlobSha: workflowFile.sha, source: workflowSource }),
    downloadedArtifact: Object.freeze({
      artifactId: Number(artifact),
      archiveDigest: `sha256:${createHash('sha256').update(archive).digest('hex')}`,
      archiveSizeInBytes: archive.length,
      entries: inspectedArchive.entries,
      envelopeJson: inspectedArchive.envelopeJson,
    }),
    remainingAuthorizationChecks: Object.freeze([
      'github-token-scope-and-host-authentication-review',
      'approval-and-attestation-policy-validation',
      'ghcr-image-evidence',
      'migration-evidence',
      'trusted-clock',
      'persistent-replay-ledger',
      'broker-authorization',
    ]),
  });
}

export async function readGitHubCiRunEvidence({
  ciRunId,
  commit,
  ghPath = '/usr/bin/gh',
  execute = execFileAsync,
}) {
  const runId = positiveId(ciRunId, 'ciRunId');
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('commit must be a lowercase full SHA');
  if (!['/usr/bin/gh', '/usr/local/bin/gh', '/opt/homebrew/bin/gh'].includes(ghPath)) fail('ghPath is not allowlisted');
  const run = parseJsonBuffer(await ghApi(execute, ghPath, `${apiPrefix}actions/runs/${runId}`), 'CI workflow run');
  if (String(run.id) !== runId || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1
      || run.status !== 'completed' || run.conclusion !== 'success'
      || run.event !== 'push' || run.head_branch !== 'main' || run.head_sha !== commit
      || !['.github/workflows/ci.yml', '.github/workflows/ci.yml@main'].includes(run.path)
      || run.repository?.id !== 1123713308 || run.repository?.full_name !== 'malabdullah/barberplusplus'
      || run.head_repository?.id !== 1123713308 || run.head_repository?.full_name !== 'malabdullah/barberplusplus') {
    fail('CI workflow run does not match the successful protected-main source');
  }
  return Object.freeze({ status: 'read-only-ci-run-evidence-collected', authorizing: false, workflowRun: run });
}

export async function readGitHubMigrationEvidence({ commit, ghPath = '/usr/bin/gh', execute = execFileAsync }) {
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('commit must be a lowercase full SHA');
  if (!['/usr/bin/gh', '/usr/local/bin/gh', '/opt/homebrew/bin/gh'].includes(ghPath)) fail('ghPath is not allowlisted');
  const endpoint = `${apiPrefix}contents/supabase/migrations?ref=${commit}`;
  const listing = parseJsonBuffer(await ghApi(execute, ghPath, endpoint, 256 * 1024), 'migration directory', 256 * 1024);
  if (!Array.isArray(listing) || listing.length === 0 || listing.length > 64) fail('migration directory inventory is invalid');
  const names = listing.map((entry) => entry?.name);
  if (new Set(names).size !== names.length || names.some((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name))) fail('migration filename is invalid or duplicated');
  names.sort();
  const migrations = [];
  let totalBytes = 0;
  for (const name of names) {
    const listed = listing.find((entry) => entry.name === name);
    if (listed.type !== 'file' || listed.path !== `supabase/migrations/${name}` || !/^[0-9a-f]{40}$/.test(listed.sha)
        || !Number.isSafeInteger(listed.size) || listed.size < 1 || listed.size > 256 * 1024) fail('migration directory entry is invalid');
    const fileEndpoint = `${apiPrefix}contents/supabase/migrations/${name}?ref=${commit}`;
    const file = parseJsonBuffer(await ghApi(execute, ghPath, fileEndpoint, 512 * 1024), `migration ${name}`, 512 * 1024);
    if (file.type !== 'file' || file.name !== name || file.path !== listed.path || file.sha !== listed.sha || file.size !== listed.size || file.encoding !== 'base64') {
      fail('migration file metadata does not match its directory entry');
    }
    const bytes = decodeCanonicalBase64(file.content, `migration ${name}`, 256 * 1024);
    if (bytes.length !== file.size) fail('migration file size does not match');
    totalBytes += bytes.length;
    if (totalBytes > maxJsonBytes) fail('migration set is oversized');
    migrations.push(Object.freeze({ name, sha256: createHash('sha256').update(bytes).digest('hex') }));
  }
  const tree = migrations.map((entry) => `${entry.name}\0${entry.sha256}\n`).join('');
  return Object.freeze({
    status: 'read-only-migration-evidence-collected',
    authorizing: false,
    commit,
    treeSha256: `sha256:${createHash('sha256').update(tree).digest('hex')}`,
    latest: names.at(-1).replace(/\.sql$/, ''),
    migrations: Object.freeze(migrations),
  });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function inspectReleaseArtifactZip(input) {
  const archive = Buffer.isBuffer(input) ? input : Buffer.from(input || '');
  if (archive.length < 22 || archive.length > maxArchiveBytes) fail('artifact ZIP is absent or oversized');
  let eocd = -1;
  const floor = Math.max(0, archive.length - 65557);
  for (let offset = archive.length - 22; offset >= floor; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) fail('artifact ZIP end record is absent');
  const commentLength = archive.readUInt16LE(eocd + 20);
  if (commentLength !== 0 || eocd + 22 !== archive.length) fail('artifact ZIP comments or trailing data are forbidden');
  if (archive.readUInt16LE(eocd + 4) !== 0 || archive.readUInt16LE(eocd + 6) !== 0) fail('multi-disk ZIP is forbidden');
  const entriesOnDisk = archive.readUInt16LE(eocd + 8);
  const entryCount = archive.readUInt16LE(eocd + 10);
  if (entriesOnDisk !== 1 || entryCount !== 1 || entryCount === 0xffff) fail('artifact ZIP must contain exactly one entry and may not use ZIP64');
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (centralSize === 0xffffffff || centralOffset === 0xffffffff || centralOffset + centralSize !== eocd) fail('artifact ZIP central directory is invalid or ZIP64');
  if (archive.readUInt32LE(centralOffset) !== 0x02014b50 || centralSize < 46) fail('artifact ZIP central entry is invalid');

  const flags = archive.readUInt16LE(centralOffset + 8);
  const method = archive.readUInt16LE(centralOffset + 10);
  const expectedCrc = archive.readUInt32LE(centralOffset + 16);
  const compressedSize = archive.readUInt32LE(centralOffset + 20);
  const uncompressedSize = archive.readUInt32LE(centralOffset + 24);
  const nameLength = archive.readUInt16LE(centralOffset + 28);
  const extraLength = archive.readUInt16LE(centralOffset + 30);
  const entryCommentLength = archive.readUInt16LE(centralOffset + 32);
  const diskStart = archive.readUInt16LE(centralOffset + 34);
  const externalAttributes = archive.readUInt32LE(centralOffset + 38);
  const localOffset = archive.readUInt32LE(centralOffset + 42);
  if ((flags & 1) !== 0) fail('encrypted ZIP entries are forbidden');
  if ((flags & ~0x808) !== 0) fail('ZIP entry flags are not allowed');
  if (![0, 8].includes(method)) fail('ZIP compression method is not allowed');
  if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || uncompressedSize > maxEnvelopeBytes) fail('ZIP entry is ZIP64 or oversized');
  if (uncompressedSize > Math.max(1024, compressedSize * 100)) fail('ZIP compression ratio is unsafe');
  if (entryCommentLength !== 0 || diskStart !== 0) fail('ZIP entry comments or disks are forbidden');
  const centralEnd = centralOffset + 46 + nameLength + extraLength + entryCommentLength;
  if (centralEnd !== eocd) fail('ZIP has hidden or malformed central entries');
  const name = archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8');
  if (name !== 'staging-release-request.json') fail('ZIP entry name is not allowed');
  const unixMode = externalAttributes >>> 16;
  if ((unixMode & 0o170000) === 0o120000 || (externalAttributes & 0x10) !== 0) fail('ZIP links and directories are forbidden');

  if (localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== 0x04034b50) fail('ZIP local entry is invalid');
  const localFlags = archive.readUInt16LE(localOffset + 6);
  const localMethod = archive.readUInt16LE(localOffset + 8);
  const localNameLength = archive.readUInt16LE(localOffset + 26);
  const localExtraLength = archive.readUInt16LE(localOffset + 28);
  if (localFlags !== flags || localMethod !== method) fail('ZIP local and central metadata differ');
  const localName = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8');
  if (localName !== name) fail('ZIP local and central names differ');
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > centralOffset) fail('ZIP compressed data overlaps its directory');
  if ((flags & 8) === 0 && dataEnd !== centralOffset) fail('ZIP has hidden data before its directory');
  if ((flags & 8) !== 0) {
    if (dataEnd + 16 !== centralOffset || archive.readUInt32LE(dataEnd) !== 0x08074b50 ||
        archive.readUInt32LE(dataEnd + 4) !== expectedCrc ||
        archive.readUInt32LE(dataEnd + 8) !== compressedSize ||
        archive.readUInt32LE(dataEnd + 12) !== uncompressedSize) {
      fail('ZIP data descriptor is absent or inconsistent');
    }
  }
  const compressed = archive.subarray(dataStart, dataEnd);
  let content;
  try {
    content = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: maxEnvelopeBytes });
  } catch {
    fail('ZIP entry decompression failed');
  }
  if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) fail('ZIP entry size or CRC does not match');
  const envelopeJson = content.toString('utf8');
  if (Buffer.from(envelopeJson, 'utf8').compare(content) !== 0) fail('ZIP entry is not valid UTF-8');
  return Object.freeze({
    envelopeJson,
    entries: Object.freeze([Object.freeze({
      name,
      regularFile: true,
      sizeInBytes: content.length,
      digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    })]),
  });
}

function header(response, name) {
  return response.headers?.get?.(name) || response.headers?.get?.(name.toLowerCase()) || null;
}

const manifestMediaTypes = ['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'];
const indexMediaTypes = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'];

// This staging host is linux/amd64. Accept its one runtime descriptor and an
// optional BuildKit attestation descriptor, never nested indexes or extra
// runnable platforms. The signed top-level digest remains the release identity.
function inspectStagingImageIndex(index, mediaType) {
  if (index?.schemaVersion !== 2 || index.mediaType !== mediaType
      || !Array.isArray(index.manifests) || index.manifests.length < 1 || index.manifests.length > 2) {
    fail('GHCR index structure is not allowed');
  }
  const seen = new Set();
  for (const descriptor of index.manifests) {
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
        || !manifestMediaTypes.includes(descriptor.mediaType) || typeof descriptor.digest !== 'string' || !digestPattern.test(descriptor.digest)
        || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > maxJsonBytes
        || Object.hasOwn(descriptor, 'urls') || Object.hasOwn(descriptor, 'data')
        || seen.has(descriptor.digest)) fail('GHCR index descriptor is not allowed');
    seen.add(descriptor.digest);
  }
  const runtime = index.manifests.filter((entry) => entry.platform?.os === 'linux'
    && entry.platform?.architecture === 'amd64');
  if (runtime.length !== 1 || Object.keys(runtime[0].platform).some((key) => !['os', 'architecture'].includes(key))
      || Object.hasOwn(runtime[0], 'artifactType')
      || runtime[0].annotations?.['vnd.docker.reference.type']) fail('GHCR index must have exactly one plain linux/amd64 runtime');
  for (const descriptor of index.manifests.filter((entry) => entry !== runtime[0])) {
    if (descriptor.platform?.os !== 'unknown' || descriptor.platform?.architecture !== 'unknown'
        || descriptor.annotations?.['vnd.docker.reference.type'] !== 'attestation-manifest'
        || descriptor.annotations?.['vnd.docker.reference.digest'] !== runtime[0].digest) {
      fail('GHCR index auxiliary descriptor is not bound to the runtime');
    }
  }
  return Object.freeze({ digest: runtime[0].digest, sizeInBytes: runtime[0].size, mediaType: runtime[0].mediaType });
}

export async function readGhcrManifest({ repository, digest, credentials, fetchImpl = fetch }) {
  if (!['malabdullah/barberplusplus', 'malabdullah/barberplusplus-functions'].includes(repository)) fail('GHCR repository is not allowlisted');
  if (!digestPattern.test(digest)) fail('GHCR digest is invalid');
  if (credentials !== undefined) {
    if (!credentials || Object.keys(credentials).join(',') !== 'username,token'
        || credentials.username !== 'malabdullah' || typeof credentials.token !== 'string'
        || credentials.token.length < 20 || credentials.token.length > 512 || /[\0\r\n]/.test(credentials.token)) {
      fail('GHCR read credentials are invalid');
    }
  }
  const manifestUrl = `https://ghcr.io/v2/${repository}/manifests/${digest}`;
  const headers = { Accept: [...manifestMediaTypes, ...indexMediaTypes].join(', ') };
  let response = await fetchImpl(manifestUrl, { method: 'GET', headers, redirect: 'error' });
  if (response.status === 401) {
    const challenge = header(response, 'www-authenticate');
    const match = challenge?.match(/^Bearer realm="(https:\/\/ghcr\.io\/token)",service="ghcr\.io",scope="([^"]+)"$/);
    if (!match || match[2] !== `repository:${repository}:pull`) fail('GHCR authentication challenge is not allowed');
    const tokenHeaders = credentials ? { Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.token}`).toString('base64')}` } : undefined;
    const tokenResponse = await fetchImpl(`${match[1]}?service=ghcr.io&scope=${encodeURIComponent(match[2])}`, {
      method: 'GET', headers: tokenHeaders, redirect: 'error',
    });
    if (!tokenResponse.ok) fail('public GHCR pull token is unavailable; a read:packages identity is required');
    const tokenBytes = Buffer.from(await tokenResponse.arrayBuffer());
    if (tokenBytes.length === 0 || tokenBytes.length > 64 * 1024) fail('GHCR pull token response is absent or oversized');
    let tokenBody;
    try { tokenBody = JSON.parse(tokenBytes.toString('utf8')); } catch { fail('GHCR pull token response is not JSON'); }
    if (typeof tokenBody.token !== 'string' || tokenBody.token.length < 20 || tokenBody.token.length > 4096) fail('GHCR pull token response is invalid');
    response = await fetchImpl(manifestUrl, { method: 'GET', headers: { ...headers, Authorization: `Bearer ${tokenBody.token}` }, redirect: 'error' });
  }
  if (!response.ok) fail(`GHCR manifest is unavailable with status ${response.status}`);
  const contentLength = Number(header(response, 'content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxJsonBytes) fail('GHCR manifest is oversized');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0 || body.length > maxJsonBytes) fail('GHCR manifest is absent or oversized');
  const calculated = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  if (calculated !== digest || header(response, 'docker-content-digest') !== digest) fail('GHCR manifest digest does not match');
  const mediaType = header(response, 'content-type')?.split(';')[0];
  if (![...manifestMediaTypes, ...indexMediaTypes].includes(mediaType)) fail('GHCR manifest content type is not allowed');
  let parsed;
  try { parsed = JSON.parse(body.toString('utf8')); } catch { fail('GHCR manifest is not JSON'); }
  const runtimeDescriptor = indexMediaTypes.includes(mediaType) ? inspectStagingImageIndex(parsed, mediaType) : null;
  return Object.freeze({
    status: 'read-only-ghcr-manifest-collected',
    authorizing: false,
    repository,
    digest,
    mediaType,
    sizeInBytes: body.length,
    // Descriptor only: child bytes, config, layers and runtime health are not
    // verified by collecting the top-level signed manifest/index.
    ...(runtimeDescriptor ? { runtimeDescriptor } : {}),
    remainingAuthorizationChecks: Object.freeze(['image-attestation', 'commit-and-run-binding', 'broker-authorization']),
  });
}

export async function readPublicGhcrManifest(options) {
  return readGhcrManifest({ ...options, credentials: undefined });
}
