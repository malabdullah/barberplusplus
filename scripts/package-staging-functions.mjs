import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const functionNames = ['auth-rate-limiter', 'cleanup-notifications', 'get-kuwait-governorates', 'invite-barber', 'send-booking-reminders', 'send-whatsapp-message', 'whatsapp-flow-endpoint', 'whatsapp-webhook'];
const sha = (data) => createHash('sha256').update(data).digest('hex');
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const validFile = (name) => /^[a-zA-Z0-9_/-]+\.ts$/.test(name)
  && !name.split('/').some((part) => part === '..' || part.startsWith('.'))
  && !/(?:_test|\.test)\.ts$/.test(name)
  && ['main', '_shared', ...functionNames].includes(name.split('/')[0]);

// The app lock also contains the frontend/tooling graph. Edge Runtime eagerly
// loads that npm snapshot. Retain only reachable package records, unchanged:
// never resolve a new version, invent an integrity hash or disable the lock.
export function scopeRuntimeLock(lock, sources) {
  if (lock.version !== '5') throw new Error('Unsupported source lock version');
  const scoped = { version: lock.version, specifiers: {}, jsr: {}, npm: {}, remote: lock.remote || {} };
  const findPackage = (kind, name) => {
    if (lock[kind]?.[name]) return name;
    const matches = Object.keys(lock[kind] || {}).filter((key) => key.startsWith(`${name}@`));
    if (matches.length !== 1) throw new Error('Ambiguous or missing locked dependency');
    return matches[0];
  };
  const visit = (kind, name) => {
    const key = findPackage(kind, name);
    if (scoped[kind][key]) return;
    scoped[kind][key] = lock[kind][key];
    for (const dependency of [...(lock[kind][key].dependencies || []), ...(lock[kind][key].optionalDependencies || [])]) {
      if (/^(jsr|npm):/.test(dependency)) visitSpecifier(dependency);
      else visit('npm', dependency);
    }
  };
  const visitSpecifier = (specifier) => {
    const candidates = Object.keys(lock.specifiers || {}).filter((key) => key === specifier || key.startsWith(`${specifier}@`));
    if (candidates.length !== 1) throw new Error('Ambiguous or missing locked specifier');
    const key = candidates[0];
    const match = key.match(/^(jsr|npm):((?:@[^/]+\/)?[^@]+)@(.+)$/);
    if (!match) throw new Error('Invalid locked specifier');
    scoped.specifiers[key] = lock.specifiers[key];
    visit(match[1], `${match[2]}@${lock.specifiers[key]}`);
  };
  for (const source of sources) {
    for (const match of source.toString().matchAll(/['"]((?:jsr|npm):(?:@[^/'"]+\/)?[^/@'"]+@[^/'"]+)/g)) visitSpecifier(match[1]);
  }
  for (const field of ['specifiers', 'jsr', 'npm', 'remote']) scoped[field] = Object.fromEntries(Object.entries(scoped[field]).sort(([a], [b]) => a.localeCompare(b, 'en')));
  return scoped;
}

export function packageFunctions(repo, commit, destination) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A full source commit SHA is required');
  if (git(repo, 'rev-parse', `${commit}^{commit}`).toString().trim() !== commit) throw new Error('Invalid source commit');
  if (!isAbsolute(destination)) throw new Error('An absolute, new output directory is required');
  const files = {};
  const blobs = new Map();
  const tree = git(repo, 'ls-tree', '-rz', commit, '--', 'supabase/functions', 'ops/staging-vps/functions/main', 'deno.json', 'deno.lock').toString();
  for (const entry of tree.split('\0').filter(Boolean)) {
    const match = entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/);
    if (!match) throw new Error('Non-regular source entries are not permitted');
    const [, , oid, path] = match;
    let name;
    if (['deno.json', 'deno.lock'].includes(path)) name = path;
    else if (path.startsWith('supabase/functions/')) name = path.slice('supabase/functions/'.length);
    else name = path.slice('ops/staging-vps/functions/'.length);
    if (!['deno.json', 'deno.lock'].includes(name) && !validFile(name)) {
      // Secret/config files and tests are never read, even if tracked.
      if (name.split('/').some((p) => p.startsWith('.')) || /(?:_test|\.test)\.ts$/.test(name)) continue;
      throw new Error('Unexpected function source file requires review');
    }
    if (Object.hasOwn(files, name)) throw new Error('Duplicate function source path');
    const data = git(repo, 'cat-file', 'blob', oid);
    files[name] = sha(data);
    blobs.set(name, data);
  }
  for (const name of [...functionNames.map((name) => `${name}/index.ts`), 'main/index.ts', 'main/gateway.ts', '_shared/environment.ts', 'deno.json', 'deno.lock']) {
    if (!files[name]) throw new Error('Incomplete function source inventory');
  }
  const sourceLock = blobs.get('deno.lock');
  const scopedLock = Buffer.from(JSON.stringify(scopeRuntimeLock(JSON.parse(sourceLock), [...blobs].filter(([name]) => name.endsWith('.ts')).map(([, data]) => data)), null, 2) + '\n');
  blobs.set('source-lock/deno.lock', sourceLock);
  files['source-lock/deno.lock'] = sha(sourceLock);
  blobs.set('deno.lock', scopedLock);
  files['deno.lock'] = sha(scopedLock);
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')));
  const manifest = { version: 1, environment: 'staging', sourceCommit: commit, files: sorted, treeSha256: sha(JSON.stringify(sorted)) };
  // Exclusive creation refuses overwrite, including a symlink destination.
  mkdirSync(destination, { mode: 0o755 });
  for (const [name, data] of blobs) {
    mkdirSync(dirname(join(destination, name)), { recursive: true, mode: 0o755 });
    writeFileSync(join(destination, name), data, { flag: 'wx', mode: 0o444 });
  }
  writeFileSync(join(destination, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
  return manifest;
}

export function verifyFunctionBundle(directory) {
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Invalid bundle directory');
  const inventory = [];
  const walk = (prefix = '') => {
    for (const name of readdirSync(join(directory, prefix))) {
      const path = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(join(directory, path));
      if (stat.isSymbolicLink()) throw new Error('Bundle symlinks are forbidden');
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) inventory.push(path);
      else throw new Error('Invalid bundle entry');
    }
  };
  walk();
  const manifest = JSON.parse(readFileSync(join(directory, 'bundle-manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.environment !== 'staging' || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)
    || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)
    || Object.keys(manifest).sort().join() !== 'environment,files,sourceCommit,treeSha256,version') throw new Error('Invalid bundle manifest');
  const expected = Object.keys(manifest.files);
  if (inventory.sort().join('\n') !== [...expected, 'bundle-manifest.json'].sort().join('\n')) throw new Error('Bundle inventory mismatch');
  for (const name of expected) {
    if (!['deno.json', 'deno.lock', 'source-lock/deno.lock'].includes(name) && !validFile(name)) throw new Error('Unsafe bundle path');
    if (sha(readFileSync(join(directory, name))) !== manifest.files[name]) throw new Error('Bundle checksum mismatch');
  }
  const regenerated = JSON.stringify(scopeRuntimeLock(JSON.parse(readFileSync(join(directory, 'source-lock/deno.lock'))),
    expected.filter((name) => name.endsWith('.ts')).map((name) => readFileSync(join(directory, name)))), null, 2) + '\n';
  if (readFileSync(join(directory, 'deno.lock'), 'utf8') !== regenerated) throw new Error('Runtime lock differs from the committed dependency closure');
  const sorted = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b, 'en')));
  if (sha(JSON.stringify(sorted)) !== manifest.treeSha256) throw new Error('Bundle tree hash mismatch');
  for (const name of [...functionNames.map((name) => `${name}/index.ts`), 'main/index.ts', 'main/gateway.ts', '_shared/environment.ts', 'deno.json', 'deno.lock']) {
    if (!manifest.files[name]) throw new Error('Incomplete bundle inventory');
  }
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/package-staging-functions.mjs <full-commit-sha> <new-absolute-output-directory>');
    const manifest = packageFunctions(resolve('.'), process.argv[2], process.argv[3]);
    verifyFunctionBundle(process.argv[3]);
    console.log(JSON.stringify({ sourceCommit: manifest.sourceCommit, treeSha256: manifest.treeSha256, files: Object.keys(manifest.files).length }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
