import assert from 'node:assert/strict';

// Scan-reviewed identities for disposable compatibility tests only. Outstanding
// findings remain; these are NOT deployment pins or security acceptance.
const images = Object.freeze({
  auth: 'supabase/gotrue@sha256:839f529492d116b4e8b7777c953a27c381d34c15a744b1bcefde5eefaa1f9f9f',
  storage: 'supabase/storage-api@sha256:13cdccea43f23d848f050eba0d4f3ccdf02a7aca93d4f43268438de95549ef74',
});

// Exact local build for disposable tests only. This ID is not a registry digest
// and must never be promoted by the deployment adapter or pulled by tag.
const patchedStorage = Object.freeze({
  auth: images.auth,
  storage: 'sha256:05ca80acbbe1fa533ca946fcd9aabbbea8065b86bfd1446e8350650ae1e6ea46',
});
const patchedCore = Object.freeze({
  auth: 'sha256:add5d67a982f17b36538b37ac316095bc5b6ddb9549207ca4e764aadb8307755',
  storage: patchedStorage.storage,
  // Official 14.x patch fixes sporadic PGRST303 "JWT issued at future".
  rest: 'postgrest/postgrest@sha256:c847127074bd26e1b8d3f7c0e6e01e5346f4b85dd34f5d699fd230af960827c0',
});
const localMetadata = Object.freeze({
  auth: {
    id: 'sha256:aa5adadc5b0e338b64d2d4565c6f7820989f778cb9e89895b1c4a07ed079302d',
    source: 'https://github.com/supabase/auth',
    revision: '4eee58f296d9698a1c2c0ae14d7a0b379c7622d3',
    candidate: 'LOCAL-ONLY: downstream vendored pgproto3 patch; grpc1.83.2; not upstream official release',
    cmd: ['auth'], user: 'supabase',
  },
  storage: {
    id: 'sha256:ffc760ae7a04b0790ba3988c31916a586790db88b66f53d7f307dfe297231613',
    source: 'https://github.com/supabase/storage',
    revision: 'eccef5e70a67fb4030e0646e5e22602c94f568bc',
    candidate: 'storage-security-local-only', cmd: ['node', 'dist/start/server.js'], user: '',
  },
});

export function coreCandidateImages(option, platform) {
  if (option === undefined) return Object.freeze({});
  assert.ok(['--core-candidates', '--storage-security-candidate', '--security-core-candidates'].includes(option),
    'Unknown core candidate selection');
  assert.equal(platform, 'linux/amd64', 'These scanned candidate manifests are AMD64 only');
  return option === '--core-candidates' ? images
    : option === '--storage-security-candidate' ? patchedStorage : patchedCore;
}

export function validateCoreCandidateMetadata(service, ref, metadata, platform) {
  assert.ok(Object.hasOwn(images, service) || Object.hasOwn(patchedCore, service), 'Unknown candidate service');
  assert.ok(ref === images[service] || ref === patchedCore[service],
    'Unreviewed candidate image');
  assert.equal(platform, 'linux/amd64');
  assert.equal(`${metadata.Os}/${metadata.Architecture}`, platform);
  if (ref.startsWith('sha256:')) {
    // Docker's containerd store reports the selected platform manifest here,
    // whereas the daemon-addressable local reference above is its OCI index.
    const expected = localMetadata[service];
    assert.equal(metadata.Id, expected.id,
      'Local candidate platform content identity mismatch');
    assert.equal(metadata.Config?.Labels?.['org.opencontainers.image.source'], expected.source);
    assert.equal(metadata.Config?.Labels?.['org.opencontainers.image.revision'], expected.revision);
    assert.equal(metadata.Config?.Labels?.['cloud.malabdullah.barber.candidate'], expected.candidate);
    assert.deepEqual(metadata.Config?.Cmd, expected.cmd);
    assert.equal(metadata.Config?.User ?? '', expected.user);
  } else {
    assert.ok(metadata.RepoDigests?.includes(ref), 'Candidate manifest identity mismatch');
  }
}
