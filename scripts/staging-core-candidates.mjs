import assert from 'node:assert/strict';

// Scan-reviewed identities for disposable compatibility tests only. Outstanding
// findings remain; these are NOT deployment pins or security acceptance.
const images = Object.freeze({
  auth: 'supabase/gotrue@sha256:839f529492d116b4e8b7777c953a27c381d34c15a744b1bcefde5eefaa1f9f9f',
  storage: 'supabase/storage-api@sha256:13cdccea43f23d848f050eba0d4f3ccdf02a7aca93d4f43268438de95549ef74',
});

export function coreCandidateImages(option, platform) {
  if (option === undefined) return Object.freeze({});
  assert.equal(option, '--core-candidates', 'Unknown core candidate selection');
  assert.equal(platform, 'linux/amd64', 'These scanned candidate manifests are AMD64 only');
  return images;
}

export function validateCoreCandidateMetadata(service, ref, metadata, platform) {
  assert.ok(Object.hasOwn(images, service), 'Unknown candidate service');
  assert.equal(ref, images[service], 'Unreviewed candidate image');
  assert.equal(platform, 'linux/amd64');
  assert.equal(`${metadata.Os}/${metadata.Architecture}`, platform);
  assert.ok(metadata.RepoDigests?.includes(ref), 'Candidate manifest identity mismatch');
}
