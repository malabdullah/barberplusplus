const maxEnvelopeBytes = 16 * 1024;
const sha1Pattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const migrationPattern = /^\d{14}_[a-z0-9_]+$/;
const noncePattern = /^[0-9a-f]{32}$/;
const decimalIdPattern = /^[1-9]\d*$/;

export const barberStagingEnvelopePolicy = Object.freeze({
  repositoryId: 1123713308,
  repository: 'malabdullah/barberplusplus',
  workflowPath: '.github/workflows/deploy-staging.yml',
  branch: 'main',
  environment: 'staging',
  frontendRepository: 'ghcr.io/malabdullah/barberplusplus',
  functionsRepository: 'ghcr.io/malabdullah/barberplusplus-functions',
  appOrigin: 'https://staging-barber.malabdullah.cloud',
  supabaseOrigin: 'https://supabase-staging.malabdullah.cloud',
  maxLifetimeMs: 15 * 60 * 1000,
  maxFutureSkewMs: 60 * 1000,
});

const externalChecks = Object.freeze([
  'github-attestation',
  'github-run-metadata',
  'github-environment-approval',
  'ghcr-manifest-and-attestation',
  'workflow-blob-allowlist',
  'migration-evidence',
  'trusted-clock',
  'server-replay-ledger',
  'broker-authorization',
]);

function fail(message) {
  throw new Error(`Invalid staging release envelope: ${message}`);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactObject(value, name, fields) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail(`${name} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== fields.length || actual.some((field, index) => field !== fields[index])) {
    fail(`${name} fields or field order do not match the v1 schema`);
  }
}

function exactString(value, name, expected) {
  if (typeof value !== 'string') fail(`${name} must be a string`);
  if (expected !== undefined && value !== expected) fail(`${name} is not allowed`);
}

function positiveSafeInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail(`${name} must be a positive safe integer`);
}

function decimalId(value, name) {
  exactString(value, name);
  if (!decimalIdPattern.test(value)) fail(`${name} must be a canonical positive decimal string`);
}

function digest(value, name) {
  exactString(value, name);
  if (!sha256Pattern.test(value)) fail(`${name} must be a lowercase SHA-256 digest`);
}

function isoTime(value, name) {
  exactString(value, name);
  let parsed;
  try {
    parsed = new Date(value);
    if (parsed.toISOString() !== value) fail(`${name} must be canonical UTC ISO-8601`);
  } catch {
    fail(`${name} must be canonical UTC ISO-8601`);
  }
  return parsed.getTime();
}

export function parseStagingReleaseEnvelope(raw, {
  now = new Date(),
} = {}) {
  const policy = barberStagingEnvelopePolicy;
  if (typeof raw !== 'string') fail('input must be a UTF-8 JSON string');
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes === 0 || bytes > maxEnvelopeBytes) fail(`input must contain 1-${maxEnvelopeBytes} bytes`);

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail('input is not JSON');
  }

  exactObject(value, 'root', [
    'schema', 'action', 'repository', 'workflow', 'runs', 'commit', 'branch',
    'images', 'migrations', 'environment', 'origins', 'issued_at', 'expires_at',
    'nonce', 'request_id',
  ]);
  exactString(value.schema, 'schema', 'barber-staging-release-request/v1');
  exactString(value.action, 'action', 'deploy-staging');

  exactObject(value.repository, 'repository', ['id', 'full_name']);
  positiveSafeInteger(value.repository.id, 'repository.id');
  if (value.repository.id !== policy.repositoryId) fail('repository.id is not allowed');
  exactString(value.repository.full_name, 'repository.full_name', policy.repository);

  exactObject(value.workflow, 'workflow', ['path', 'blob_sha']);
  exactString(value.workflow.path, 'workflow.path', policy.workflowPath);
  exactString(value.workflow.blob_sha, 'workflow.blob_sha');
  if (!sha1Pattern.test(value.workflow.blob_sha)) fail('workflow.blob_sha must be a lowercase full Git blob SHA');

  exactObject(value.runs, 'runs', ['ci', 'release']);
  for (const name of ['ci', 'release']) {
    exactObject(value.runs[name], `runs.${name}`, ['id', 'attempt']);
    decimalId(value.runs[name].id, `runs.${name}.id`);
    positiveSafeInteger(value.runs[name].attempt, `runs.${name}.attempt`, 1000);
  }

  exactString(value.commit, 'commit');
  if (!sha1Pattern.test(value.commit)) fail('commit must be a lowercase full commit SHA');
  exactString(value.branch, 'branch', policy.branch);

  exactObject(value.images, 'images', ['frontend', 'functions']);
  for (const [name, repository] of [
    ['frontend', policy.frontendRepository],
    ['functions', policy.functionsRepository],
  ]) {
    exactObject(value.images[name], `images.${name}`, ['repository', 'digest']);
    exactString(value.images[name].repository, `images.${name}.repository`, repository);
    digest(value.images[name].digest, `images.${name}.digest`);
  }

  exactObject(value.migrations, 'migrations', ['tree_sha256', 'latest']);
  digest(value.migrations.tree_sha256, 'migrations.tree_sha256');
  exactString(value.migrations.latest, 'migrations.latest');
  if (!migrationPattern.test(value.migrations.latest)) fail('migrations.latest is invalid');

  exactString(value.environment, 'environment', policy.environment);
  exactObject(value.origins, 'origins', ['app', 'supabase']);
  exactString(value.origins.app, 'origins.app', policy.appOrigin);
  exactString(value.origins.supabase, 'origins.supabase', policy.supabaseOrigin);

  const issuedAt = isoTime(value.issued_at, 'issued_at');
  const expiresAt = isoTime(value.expires_at, 'expires_at');
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowTime)) fail('validator time is invalid');
  if (expiresAt <= issuedAt || expiresAt - issuedAt > policy.maxLifetimeMs) fail('expiry window is invalid');
  if (issuedAt > nowTime + policy.maxFutureSkewMs) fail('issued_at is too far in the future');
  if (expiresAt <= nowTime) fail('request is expired');

  exactString(value.nonce, 'nonce');
  if (!noncePattern.test(value.nonce)) fail('nonce must be 128-bit lowercase hexadecimal');
  exactString(value.request_id, 'request_id');
  const expectedRequestId = `${value.repository.id}:${value.runs.release.id}:${value.runs.release.attempt}:${value.nonce}`;
  if (value.request_id !== expectedRequestId) fail('request_id does not match repository, release run, attempt, and nonce');

  if (raw !== JSON.stringify(value)) fail('input must use the canonical compact JSON encoding and field order');

  return Object.freeze({
    status: 'syntax-valid',
    authorizing: false,
    envelope: deepFreeze(value),
    requiredExternalChecks: externalChecks,
  });
}
