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
