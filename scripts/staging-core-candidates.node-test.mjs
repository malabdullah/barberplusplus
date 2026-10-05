import assert from 'node:assert/strict';
import test from 'node:test';
import { coreCandidateImages, validateCoreCandidateMetadata } from './staging-core-candidates.mjs';

test('candidate selection is explicit, fixed, immutable and AMD64-only', () => {
  assert.deepEqual(coreCandidateImages(undefined, 'linux/arm64'), {});
  const images = coreCandidateImages('--core-candidates', 'linux/amd64');
  assert.deepEqual(Object.keys(images), ['auth', 'storage']);
  assert.ok(Object.isFrozen(images));
  for (const ref of Object.values(images)) assert.match(ref, /^supabase\/[a-z-]+@sha256:[a-f0-9]{64}$/);
  for (const option of ['', '--latest', 'supabase/gotrue:latest']) {
    assert.throws(() => coreCandidateImages(option, 'linux/amd64'));
  }
  assert.throws(() => coreCandidateImages('--core-candidates', 'linux/arm64'));
});

test('candidate metadata must match the exact scanned manifest and platform', () => {
  for (const [name, ref] of Object.entries(coreCandidateImages('--core-candidates', 'linux/amd64'))) {
    const metadata = { Os: 'linux', Architecture: 'amd64', RepoDigests: [ref] };
    validateCoreCandidateMetadata(name, ref, metadata, 'linux/amd64');
    for (const change of [{ Os: 'windows' }, { Architecture: 'arm64' }, { RepoDigests: [] }, { RepoDigests: ['other'] }]) {
      assert.throws(() => validateCoreCandidateMetadata(name, ref, { ...metadata, ...change }, 'linux/amd64'));
    }
    assert.throws(() => validateCoreCandidateMetadata('db', ref, metadata, 'linux/amd64'));
    assert.throws(() => validateCoreCandidateMetadata(name, ref.replace(/.$/, '0'), metadata, 'linux/amd64'));
    assert.throws(() => validateCoreCandidateMetadata(name, ref, metadata, 'linux/arm64'));
  }
});

test('local Storage candidate requires its exact content ID, source labels, command and platform', () => {
  const images = coreCandidateImages('--storage-security-candidate', 'linux/amd64');
  assert.ok(Object.isFrozen(images));
  assert.match(images.storage, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => coreCandidateImages('--storage-security-candidate', 'linux/arm64'));
  const metadata = { Id: 'sha256:ffc760ae7a04b0790ba3988c31916a586790db88b66f53d7f307dfe297231613', Os: 'linux', Architecture: 'amd64', Config: {
    User: '', Cmd: ['node', 'dist/start/server.js'], Labels: {
      'org.opencontainers.image.source': 'https://github.com/supabase/storage',
      'org.opencontainers.image.revision': 'eccef5e70a67fb4030e0646e5e22602c94f568bc',
      'cloud.malabdullah.barber.candidate': 'storage-security-local-only',
    },
  } };
  validateCoreCandidateMetadata('storage', images.storage, metadata, 'linux/amd64');
  const exportedRef = coreCandidateImages('--exported-security-core-candidates', 'linux/amd64').storage;
  validateCoreCandidateMetadata('storage', exportedRef, metadata, 'linux/amd64');
  for (const change of [{ Id: `sha256:${'0'.repeat(64)}` }, { Os: 'windows' },
    { Architecture: 'arm64' }, { Config: {} }, { Config: { ...metadata.Config, Cmd: ['sh'] } },
    { Config: { ...metadata.Config, Labels: {} } }]) {
    assert.throws(() => validateCoreCandidateMetadata('storage', images.storage, { ...metadata, ...change }, 'linux/amd64'));
    assert.throws(() => validateCoreCandidateMetadata('storage', exportedRef, { ...metadata, ...change }, 'linux/amd64'));
  }
  assert.throws(() => validateCoreCandidateMetadata('auth', images.storage, metadata, 'linux/amd64'));
  assert.throws(() => validateCoreCandidateMetadata('storage', `sha256:${'0'.repeat(64)}`, metadata, 'linux/amd64'));
});

test('local Auth candidate stays distinct from official and Storage identities', () => {
  const images = coreCandidateImages('--security-core-candidates', 'linux/amd64');
  assert.ok(Object.isFrozen(images));
  assert.equal(images.storage, coreCandidateImages('--storage-security-candidate', 'linux/amd64').storage);
  assert.notEqual(images.auth, coreCandidateImages('--core-candidates', 'linux/amd64').auth);
  assert.throws(() => coreCandidateImages('--security-core-candidates', 'linux/arm64'));
  const metadata = { Id: 'sha256:aa5adadc5b0e338b64d2d4565c6f7820989f778cb9e89895b1c4a07ed079302d',
    Os: 'linux', Architecture: 'amd64', Config: { Cmd: ['auth'], User: 'supabase', Labels: {
      'org.opencontainers.image.source': 'https://github.com/supabase/auth',
      'org.opencontainers.image.revision': '4eee58f296d9698a1c2c0ae14d7a0b379c7622d3',
      'cloud.malabdullah.barber.candidate': 'LOCAL-ONLY: downstream vendored pgproto3 patch; grpc1.83.2; not upstream official release',
    } } };
  validateCoreCandidateMetadata('auth', images.auth, metadata, 'linux/amd64');
  const exportedRef = coreCandidateImages('--exported-security-core-candidates', 'linux/amd64').auth;
  validateCoreCandidateMetadata('auth', exportedRef, metadata, 'linux/amd64');
  for (const change of [{ Id: 'sha256:add5d67a982f17b36538b37ac316095bc5b6ddb9549207ca4e764aadb8307755' }, { Id: images.storage }, { Architecture: 'arm64' },
    { Config: { ...metadata.Config, User: 'root' } }, { Config: { ...metadata.Config, Cmd: ['sh'] } },
    { Config: { ...metadata.Config, Labels: {} } }]) {
    assert.throws(() => validateCoreCandidateMetadata('auth', images.auth, { ...metadata, ...change }, 'linux/amd64'));
    assert.throws(() => validateCoreCandidateMetadata('auth', exportedRef, { ...metadata, ...change }, 'linux/amd64'));
  }
  assert.throws(() => validateCoreCandidateMetadata('storage', images.auth, metadata, 'linux/amd64'));
});

test('exported local core candidates are addressed by the reviewed AMD64 manifest, not an OCI wrapper', () => {
  const images = coreCandidateImages('--exported-security-core-candidates', 'linux/amd64');
  assert.ok(Object.isFrozen(images));
  assert.throws(() => coreCandidateImages('--exported-security-core-candidates', 'linux/arm64'));
  assert.equal(images.auth, 'sha256:aa5adadc5b0e338b64d2d4565c6f7820989f778cb9e89895b1c4a07ed079302d');
  assert.equal(images.storage, 'sha256:ffc760ae7a04b0790ba3988c31916a586790db88b66f53d7f307dfe297231613');
});

test('patched core uses only the exact official REST bugfix manifest', () => {
  const { rest } = coreCandidateImages('--security-core-candidates', 'linux/amd64');
  assert.equal(rest, 'postgrest/postgrest@sha256:c847127074bd26e1b8d3f7c0e6e01e5346f4b85dd34f5d699fd230af960827c0');
  const metadata = { Os: 'linux', Architecture: 'amd64', RepoDigests: [rest] };
  validateCoreCandidateMetadata('rest', rest, metadata, 'linux/amd64');
  assert.throws(() => validateCoreCandidateMetadata('rest', rest, { ...metadata, RepoDigests: [] }, 'linux/amd64'));
  assert.throws(() => validateCoreCandidateMetadata('rest', 'postgrest/postgrest:latest', metadata, 'linux/amd64'));
});
