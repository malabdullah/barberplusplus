// Prepare a disposable build context from public, checksum-verified upstream
// manifests. No container is started, image published or deployment pin changed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceCommit = 'eccef5e70a67fb4030e0646e5e22602c94f568bc';
const hashes = Object.freeze({
  'package.json': ['2a10cbe0549ecda2f099650a08723d498d50de37d8744e2c34560bf93b93b09a',
    'd9c3b36289af94190986ce1545e56d71937520374e847ad6fddc5c803671349f'],
  'package-lock.json': ['f28a4ce5bf734eaf6a08e5f67e78ad05c48651b75ab4874e211ce1a5e7553cd9',
    '13276aea2bb4ae7133199c9b875bb9b827c4f0e89b2df1ab9469d5c8d350e8ea'],
});
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function prepareStorageCandidate(upstream, destination) {
  assert.ok(isAbsolute(upstream) && isAbsolute(destination), 'Absolute paths required');
  const source = realpathSync(upstream);
  const git = (...args) => execFileSync('git', ['-C', source, ...args], {
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(git('rev-parse', 'HEAD').toString().trim(), sourceCommit, 'Wrong upstream source commit');
  const blobs = Object.fromEntries(Object.entries(hashes).map(([name, [expected]]) => {
    // Read committed blobs only; do not copy the checkout's secrets or edits.
    const data = git('show', `${sourceCommit}:${name}`);
    assert.equal(sha(data), expected, 'Upstream manifest checksum mismatch');
    return [name, data];
  }));
  const patch = readFileSync(join(root, 'ops/staging-vps/storage-security.patch'));
  const targets = [...patch.toString().matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]);
  assert.deepEqual(targets.sort(), Object.keys(hashes).sort(), 'Unexpected patch target');
  const dockerfile = readFileSync(join(root, 'ops/staging-vps/Dockerfile.storage-candidate'));
  assert.equal(sha(dockerfile), '1ba4fa5b4c5eeed6cc7c71e1032963ebacf3d29217e58b7a9bcaaefec351154d',
    'Candidate recipe changed; review and re-scan required');
  // Exclusive creation rejects an existing directory or symlink; never rewrite
  // an existing build, checkout, live configuration or user file.
  mkdirSync(destination, { mode: 0o700 });
  for (const [name, data] of Object.entries(blobs)) {
    writeFileSync(join(destination, name), data, { flag: 'wx', mode: 0o600 });
  }
  const apply = (check) => execFileSync('git', ['apply', ...(check ? ['--check'] : []), '-'], {
    cwd: destination, input: patch, stdio: ['pipe', 'pipe', 'pipe'],
  });
  apply(true);
  apply(false);
  for (const [name, [, expected]] of Object.entries(hashes)) {
    assert.equal(sha(readFileSync(join(destination, name))), expected, 'Patched manifest checksum mismatch');
  }
  writeFileSync(join(destination, 'Dockerfile'), dockerfile, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(destination, '.dockerignore'), '**\n!package.json\n!package-lock.json\n!Dockerfile\n',
    { flag: 'wx', mode: 0o600 });
  return { sourceCommit, manifests: Object.fromEntries(Object.entries(hashes).map(([name, values]) => [name, values[1]])),
    dockerfileSha256: sha(dockerfile), scope: 'disposable-local-candidate-only' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 4, 'Pass an exact upstream checkout and a new absolute output directory');
    console.log(JSON.stringify(prepareStorageCandidate(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(`Storage candidate preparation refused: ${error.code || error.message.split('\n')[0]}`);
    process.exitCode = 1;
  }
}
