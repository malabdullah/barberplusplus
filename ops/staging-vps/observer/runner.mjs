import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { constants, lstatSync, openSync, fstatSync, readFileSync, writeFileSync, writeSync, fsyncSync, closeSync, mkdirSync, rmdirSync, readdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { parseObserverSelection, validateObserverCredentialMetadata, withObserverToken, observeSelectedRelease } from './scripts/staging-observer.mjs';

const exec = promisify(execFile);
const state = '/var/lib/barber-staging-observer';
const runtime = '/run/barber-staging-observer';
let audit;
let locked = false;
let result;
let phase = 'identity';
let credentialMetadata;
const append = (record) => {
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
  for (let offset = 0; offset < bytes.length;) {
    const written = writeSync(audit, bytes, offset, bytes.length - offset);
    assert.ok(written > 0); offset += written;
  }
  fsyncSync(audit);
};
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 997);
  assert.deepEqual(process.getgroups(), [985]);
  assert.equal(process.argv.length, 2);
  phase = 'audit-initialization';
  for (const path of [state, runtime]) {
    const stat = lstatSync(path);
    assert.ok(stat.isDirectory() && stat.uid === 997 && (stat.mode & 0o777) === 0o700);
  }
  assert.ok(readdirSync(state).length < 1000); // No silent rotation or unbounded audit accumulation.
  mkdirSync(`${state}/in-progress`, { mode: 0o700 }); locked = true;
  audit = openSync(`${state}/${randomUUID()}.jsonl`, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  append({ schema: 'barber-staging-observation/v1', event: 'started', observedAt: new Date().toISOString(), authorizing: false });
  const dir = openSync(state, constants.O_RDONLY); fsyncSync(dir); closeSync(dir);
  const selectionPath = '/etc/barber-staging-observer/selection.json';
  phase = 'root-selection';
  const fd = openSync(selectionPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let selection;
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === 0 && stat.nlink === 1 && (stat.mode & 0o777) === 0o644 && stat.size <= 4096);
    selection = parseObserverSelection(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
  append({ event: 'selected', ...selection, authorizing: false });
  phase = 'systemd-credential';
  const credentialDir = process.env.CREDENTIALS_DIRECTORY;
  assert.equal(credentialDir, '/run/credentials/barber-staging-observer.service');
  const keyPath = `${credentialDir}/github-app-private-key.pem`;
  phase = 'credential-metadata';
  const keyStat = lstatSync(keyPath);
  credentialMetadata = { uid: keyStat.uid, gid: keyStat.gid, mode: keyStat.mode & 0o777, regularFile: keyStat.isFile() };
  validateObserverCredentialMetadata(keyStat);
  const privateKey = readFileSync(keyPath);
  try {
    result = await withObserverToken(privateKey, async (token) => {
      const execute = (binary, args, options) => {
        assert.ok(['/usr/local/bin/gh', '/usr/bin/chronyc'].includes(binary));
        return exec(binary, args, { ...options, env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: runtime,
          GH_CONFIG_DIR: runtime, GH_PROMPT_DISABLED: '1', ...(binary === '/usr/local/bin/gh' ? { GH_TOKEN: token } : {}) } });
      };
      return observeSelectedRelease(selection, { execute, saveEnvelope: (raw) => {
        const path = `${runtime}/staging-release-request.json`;
        writeFileSync(path, raw, { flag: 'wx', mode: 0o600 }); return path;
      } });
    });
  } finally { privateKey.fill(0); }
} catch {
  result = { status: 'observation-failed', phase, ...(phase === 'credential-metadata' ? { credentialMetadata } : {}), authorizing: false, deployed: false };
}
try {
  if (audit !== undefined) { append({ event: 'finished', observedAt: new Date().toISOString(), ...result }); closeSync(audit); }
  if (locked) { rmdirSync(`${state}/in-progress`); const dir = openSync(state, constants.O_RDONLY); fsyncSync(dir); closeSync(dir); }
} catch { result = { status: 'observation-failed', phase: 'audit-completion', authorizing: false, deployed: false }; }
console.log(JSON.stringify(result));
process.exitCode = result.status === 'individual-evidence-checks-passed' ? 0 : 1;
