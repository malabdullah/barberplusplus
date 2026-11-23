import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrationTree, sha256, validateManifest, REPOSITORY, WORKFLOW } from './protocol.mjs';

const root = process.cwd();
const out = resolve(process.argv[2] || '.release-private/package');
mkdirSync(out, { recursive: true, mode: 0o700 });
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (process.env.GITHUB_REPOSITORY !== REPOSITORY || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_SHA !== commit || process.env.GITHUB_EVENT_NAME !== 'push') throw Error('Only a main push may package a production release');
// git archive includes tracked source only; secret files must never be tracked.
const paths = ['supabase/functions', 'supabase/migrations', 'supabase/schema.expected.sql', 'scripts/normalize-schema.py', 'ops/release', 'deno.json', 'deno.lock'];
const tracked = execFileSync('git', ['ls-files', '--', ...paths], { encoding: 'utf8' }).trim().split('\n');
if (tracked.some(p => /(?:^|\/)\.env(?:\.|$)/.test(p) && !p.endsWith('.example'))) throw Error('Tracked secret file refused');
const files = tracked.filter(p => !/(?:^|\/)\.env(?:\.|$)/.test(p));
const temporary = mkdtempSync(join(tmpdir(), 'barber-release-source-'));
const staged = join(temporary, 'source');
try {
  mkdirSync(staged, { mode: 0o700 });
  const archive = join(temporary, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', '--output=' + archive, commit, '--', ...files]);
  execFileSync('tar', ['-xf', archive, '-C', staged]);
  execFileSync(process.execPath, ['ops/release/bundle-functions.mjs', staged], { stdio: 'inherit' });
  execFileSync('tar', ['-czf', join(out, 'backend.tar.gz'), '-C', staged, 'supabase', 'scripts', 'ops', 'deno.json', 'deno.lock']);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
const manifest = {
  schemaVersion: 1, repository: REPOSITORY, ref: 'refs/heads/main', workflow: WORKFLOW,
  commit, runId: process.env.GITHUB_RUN_ID, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  frontendImage: process.env.FRONTEND_IMAGE,
  backendFile: 'backend.tar.gz', backendSha256: sha256(readFileSync(`${out}/backend.tar.gz`)),
  expectedSchemaSha256: sha256(readFileSync('supabase/schema.expected.sql')),
  runtimeLockSha256: sha256(readFileSync('ops/release/runtime-lock.json')),
  compatibility: 'backward-compatible', migrations: migrationTree(root),
};
validateManifest(manifest, { commit, runId: manifest.runId, runAttempt: manifest.runAttempt });
writeFileSync(`${out}/release.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Packaged ${commit} with ${manifest.migrations.length} migration hashes`);
