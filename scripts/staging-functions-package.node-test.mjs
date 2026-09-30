import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { functionNames, packageFunctions, scopeRuntimeLock, verifyFunctionBundle } from './package-staging-functions.mjs';

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'barber-function-package-test-'));
  const repo = join(root, 'repo'); mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (path, data = 'export {};\n') => {
    mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), data);
  };
  try {
    git('init', '-q'); git('config', 'user.name', 'Synthetic fixture'); git('config', 'user.email', 'fixture@barber.test');
    for (const name of functionNames) put(`supabase/functions/${name}/index.ts`);
    put('supabase/functions/_shared/environment.ts');
    put('supabase/functions/_shared/environment_test.ts');
    put('supabase/functions/.env.example', 'SYNTHETIC=fixture');
    put('ops/staging-vps/functions/main/index.ts'); put('ops/staging-vps/functions/main/gateway.ts');
    put('ops/staging-vps/functions/main/gateway_test.ts');
    put('deno.json', '{}'); put('deno.lock', '{"version":"5"}');
    git('add', '.'); git('commit', '-qm', 'Synthetic fixture');
    fn({ root, repo, git, put, commit: git('rev-parse', 'HEAD') });
  } finally { rmSync(root, { recursive: true }); }
}

test('deterministic committed inventory excludes local changes, env files and tests', () => fixture(({ root, repo, put, commit }) => {
  put('supabase/functions/.env', 'UNTRACKED=synthetic');
  put('supabase/functions/invite-barber/index.ts', 'uncommitted change');
  const first = join(root, 'first'); const second = join(root, 'second');
  assert.deepEqual(packageFunctions(repo, commit, first), packageFunctions(repo, commit, second));
  const manifest = verifyFunctionBundle(first);
  assert.equal(Object.keys(manifest.files).some((p) => p.includes('.env') || p.includes('_test')), false);
  assert.equal(readFileSync(join(first, 'invite-barber/index.ts'), 'utf8'), 'export {};\n');
  assert.throws(() => packageFunctions(repo, commit, first), /EEXIST/);
  assert.throws(() => packageFunctions(repo, 'HEAD', join(root, 'bad')), /full source commit/);
}));

test('rejects tracked symlinks and unexpected function directories before writing output', () => fixture(({ root, repo, git, put, commit }) => {
  symlinkSync('../../../../outside', join(repo, 'supabase/functions/invite-barber/link.ts'));
  git('add', '.'); git('commit', '-qm', 'Synthetic symlink');
  assert.throws(() => packageFunctions(repo, git('rev-parse', 'HEAD'), join(root, 'bad')), /Non-regular/);
  assert.equal(existsSync(join(root, 'bad')), false);
  git('rm', 'supabase/functions/invite-barber/link.ts');
  put('supabase/functions/unreviewed/index.ts'); git('add', '.'); git('commit', '-qm', 'Unreviewed function');
  assert.throws(() => packageFunctions(repo, git('rev-parse', 'HEAD'), join(root, 'bad')), /Unexpected/);
  // The earlier immutable commit is unaffected.
  packageFunctions(repo, commit, join(root, 'good'));
}));

test('verifier detects changed content, extra files and symlinks', () => fixture(({ root, repo, commit }) => {
  const output = join(root, 'bundle'); packageFunctions(repo, commit, output);
  const file = join(output, 'main/index.ts'); chmodSync(file, 0o644); writeFileSync(file, 'changed');
  assert.throws(() => verifyFunctionBundle(output), /checksum/);
  writeFileSync(file, 'export {};\n'); writeFileSync(join(output, '.env'), 'SYNTHETIC=fixture');
  assert.throws(() => verifyFunctionBundle(output), /inventory/);
  rmSync(join(output, '.env')); symlinkSync(file, join(output, 'link'));
  assert.throws(() => verifyFunctionBundle(output), /symlinks/);
}));

test('scoped lock preserves exact transitive records and rejects ambiguous resolution', () => {
  const lock = { version: '5', specifiers: { 'npm:root@1.0.0': '1.0.0' }, npm: {
    'root@1.0.0': { integrity: 'root-integrity', dependencies: ['child'] },
    'child@2.0.0': { integrity: 'child-integrity' },
    'unused-tool@3.0.0': { integrity: 'not-needed' },
  }, remote: { 'https://example.invalid/pinned.ts': 'unchanged' } };
  const scoped = scopeRuntimeLock(lock, ["import 'npm:root@1.0.0';"]);
  assert.deepEqual(Object.keys(scoped.npm), ['child@2.0.0', 'root@1.0.0']);
  assert.deepEqual(scoped.npm['child@2.0.0'], lock.npm['child@2.0.0']);
  assert.deepEqual(scoped.remote, lock.remote);
  assert.throws(() => scopeRuntimeLock(lock, ["import 'npm:missing@1.0.0';"]), /missing/);
  lock.npm['child@3.0.0'] = { integrity: 'different' };
  assert.throws(() => scopeRuntimeLock(lock, ["import 'npm:root@1.0.0';"]), /Ambiguous/);
});
