import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStagingReleaseEnvelope } from './staging-release-envelope.mjs';

const now = new Date('2026-10-04T12:00:00.000Z');
const sha = (character) => character.repeat(40);
const digest = (character) => `sha256:${character.repeat(64)}`;

function validEnvelope() {
  const nonce = 'ab'.repeat(16);
  return {
    schema: 'barber-staging-release-request/v1',
    action: 'deploy-staging',
    repository: { id: 1123713308, full_name: 'malabdullah/barberplusplus' },
    workflow: { path: '.github/workflows/deploy-staging.yml', blob_sha: sha('a') },
    runs: { ci: { id: '36707154914', attempt: 1 }, release: { id: '36707160000', attempt: 2 } },
    commit: sha('b'),
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
    request_id: `1123713308:36707160000:2:${nonce}`,
  };
}

const parse = (value, options) => parseStagingReleaseEnvelope(
  typeof value === 'string' ? value : JSON.stringify(value),
  { now, ...options },
);
const reject = (mutate, pattern = /Invalid staging release envelope/) => {
  const value = validEnvelope();
  mutate(value);
  assert.throws(() => parse(value), pattern);
};

test('accepts the exact canonical v1 envelope but never authorizes it', () => {
  const result = parse(validEnvelope());
  assert.equal(result.status, 'syntax-valid');
  assert.equal(result.authorizing, false);
  assert.deepEqual(result.requiredExternalChecks, [
    'github-attestation', 'github-run-metadata', 'github-environment-approval',
    'ghcr-manifest-and-attestation', 'workflow-blob-allowlist',
    'migration-evidence', 'trusted-clock', 'server-replay-ledger',
    'broker-authorization',
  ]);
  assert.equal(Object.isFrozen(result.envelope.images.frontend), true);
});

test('rejects empty, malformed, noncanonical, duplicate and oversized JSON', () => {
  assert.throws(() => parse(''));
  assert.throws(() => parse('{'));
  const canonical = JSON.stringify(validEnvelope());
  assert.throws(() => parse(`${canonical}\n`), /canonical compact JSON/);
  assert.throws(() => parse(canonical.replace('{', '{"schema":"duplicate",')), /canonical compact JSON/);
  assert.throws(() => parse(`{"padding":"${'x'.repeat(17 * 1024)}"}`), /1-16384 bytes/);
});

test('rejects missing, extra, reordered and wrong-type fields', () => {
  reject((value) => { delete value.action; });
  reject((value) => { value.extra = true; });
  reject((value) => { value.repository = null; }, /repository must be an object/);
  reject((value) => { value.repository.id = '1123713308'; }, /positive safe integer/);
  reject((value) => { value.runs.release.attempt = 0; });
  const reordered = validEnvelope();
  reordered.repository = { full_name: reordered.repository.full_name, id: reordered.repository.id };
  assert.throws(() => parse(reordered), /field order/);
});

test('rejects wrong fixed repository, workflow, branch, environment and origins', () => {
  reject((value) => { value.repository.id += 1; }, /repository.id is not allowed/);
  reject((value) => { value.repository.full_name = 'attacker/fork'; });
  reject((value) => { value.workflow.path = '.github/workflows/other.yml'; });
  reject((value) => { value.workflow.blob_sha = sha('A'); });
  reject((value) => { value.branch = 'feature'; });
  reject((value) => { value.environment = 'production'; });
  reject((value) => { value.origins.app = 'https://barber.malabdullah.cloud'; });
  reject((value) => { value.origins.supabase = 'https://supabase.malabdullah.cloud'; });
});

test('rejects mutable, malformed and cross-repository image references', () => {
  reject((value) => { value.images.frontend.repository = 'ghcr.io/attacker/barberplusplus'; });
  reject((value) => { value.images.frontend.digest = 'latest'; });
  reject((value) => { value.images.functions.digest = digest('A'); });
  reject((value) => { value.images.functions.digest = `sha256:${'d'.repeat(63)}`; });
  reject((value) => { value.migrations.tree_sha256 = 'e'.repeat(64); });
});

test('rejects malformed commits, run IDs and migration identifiers', () => {
  reject((value) => { value.commit = sha('B'); });
  reject((value) => { value.runs.ci.id = '01'; });
  reject((value) => { value.runs.release.id = 42; });
  reject((value) => { value.runs.release.attempt = 1001; });
  reject((value) => { value.migrations.latest = '../migration'; });
});

test('rejects expired, future, noncanonical and overlong validity windows', () => {
  reject((value) => { value.expires_at = '2026-10-04T12:00:00.000Z'; }, /expired/);
  reject((value) => { value.issued_at = '2026-10-04T12:02:00.000Z'; }, /future/);
  reject((value) => { value.expires_at = '2026-10-04T12:20:00.000Z'; }, /expiry window/);
  reject((value) => { value.issued_at = '2026-10-04T11:59:00Z'; }, /canonical UTC/);
  reject((value) => { value.expires_at = value.issued_at; }, /expiry window/);
});

test('rejects weak nonce and request-ID substitution or replay-shape changes', () => {
  reject((value) => { value.nonce = 'ab'.repeat(15); });
  reject((value) => { value.nonce = 'AB'.repeat(16); });
  reject((value) => { value.request_id = value.request_id.replace(':2:', ':1:'); }, /does not match/);
  reject((value) => { value.runs.release.id = '36707160001'; }, /does not match/);
  reject((value) => { value.repository.id = 1123713309; }, /repository.id is not allowed/);
});
