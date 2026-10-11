// Local persistence only. No network, credentials, commands, deployment or automatic recovery.
import assert from 'node:assert/strict';
import { constants, openSync, closeSync, fstatSync, lstatSync, realpathSync, readFileSync,
  writeSync, fsyncSync, mkdirSync, rmdirSync, renameSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateReplayLedger } from './staging-vps-verifier.mjs';

const limit = 1024 * 1024;
const identityKeys = ['bindingSha256', 'requestId', 'artifactId', 'envelopeSha256', 'commit',
  'frontendDigest', 'functionsDigest', 'migrationTreeSha256'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => `${JSON.stringify(value)}\n`;
const nextEvent = { observed: 'verified', verified: 'authorized', authorized: 'executing', executing: 'consumed' };
const terminal = (event) => ['consumed', 'failed'].includes(event);
const sameIdentity = (a, b) => identityKeys.every(key => a[key] === b[key]);

function requestParts(requestId) {
  assert.equal(typeof requestId, 'string');
  const match = requestId.match(/^1123713308:([1-9]\d*):1:([0-9a-f]{32})$/);
  assert.ok(match && Number.isSafeInteger(Number(match[1])));
  return { run: match[1], nonce: match[2] };
}

function timestamp(value) {
  assert.equal(typeof value, 'string');
  assert.equal(new Date(value).toISOString(), value);
  return value;
}

function validateIdentity(value) {
  assert.deepEqual(Object.keys(value), identityKeys);
  requestParts(value.requestId);
  for (const key of identityKeys) assert.equal(typeof value[key], 'string');
  assert.match(value.bindingSha256, /^[0-9a-f]{64}$/);
  assert.match(value.commit, /^[0-9a-f]{40}$/);
  assert.match(value.artifactId, /^[1-9]\d*$/);
  assert.ok(Number.isSafeInteger(Number(value.artifactId)));
  for (const key of ['envelopeSha256', 'frontendDigest', 'functionsDigest', 'migrationTreeSha256']) {
    assert.match(value[key], /^sha256:[0-9a-f]{64}$/);
  }
}

export function replayIdentityMatches(a, b) {
  const first = requestParts(a.requestId); const second = requestParts(b.requestId);
  return ['bindingSha256', 'requestId', 'artifactId', 'envelopeSha256'].some(key => a[key] === b[key])
    || first.run === second.run || first.nonce === second.nonce
    || ['commit', 'frontendDigest', 'functionsDigest', 'migrationTreeSha256'].every(key => a[key] === b[key]);
}

// Strengthens the existing wire-format/hash-chain reader with state and identity rules.
export function validateDurableReplayLedger(raw) {
  const parsed = validateReplayLedger(raw);
  const starts = [];
  let previous;
  for (const record of parsed.records) {
    const identity = Object.fromEntries(identityKeys.map(key => [key, record[key]]));
    validateIdentity(identity); timestamp(record.recordedAt);
    if (previous) assert.ok(record.recordedAt >= previous.recordedAt);
    if (record.event === 'observed') {
      assert.ok(!previous || terminal(previous.event));
      assert.ok(!starts.some(prior => replayIdentityMatches(prior, record)));
      starts.push(record);
    } else {
      assert.ok(previous && !terminal(previous.event) && sameIdentity(previous, record));
      assert.ok(record.event === 'failed' || nextEvent[previous.event] === record.event);
    }
    previous = record;
  }
  return Object.freeze({ ...parsed, status: 'durable-replay-ledger-valid',
    terminal: !previous || terminal(previous.event), authorizing: false });
}

function checkDirectory(root, uid) {
  assert.ok(isAbsolute(root) && realpathSync(root) === root);
  const stat = lstatSync(root);
  assert.ok(stat.isDirectory() && stat.uid === uid && (stat.mode & 0o777) === 0o700);
}

function protectedFile(path, flags, uid) {
  const fd = openSync(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === uid && stat.nlink === 1 && (stat.mode & 0o777) === 0o600);
    assert.ok(stat.size <= limit);
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}

function flushDirectory(root) {
  const fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeAll(fd, raw) {
  const bytes = Buffer.from(raw);
  for (let offset = 0; offset < bytes.length;) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    assert.ok(written > 0); offset += written;
  }
  fsyncSync(fd);
}

function readProtected(path, uid) {
  const fd = protectedFile(path, constants.O_RDONLY, uid);
  try { return readFileSync(fd, 'utf8'); } finally { closeSync(fd); }
}

function checkpoint(raw, parsed) {
  return canonical({ schema: 'barber-staging-ledger-checkpoint/v1',
    sequence: parsed.records.length, headSha256: parsed.headSha256, fileSha256: hash(raw) });
}

// Explicit first provisioning only, on a pre-created private directory. No caller auto-init.
export function initializeReplayLedger(root, uid = process.getuid()) {
  checkDirectory(root, uid);
  assert.deepEqual(readdirSync(root), []);
  mkdirSync(join(root, 'in-progress'), { mode: 0o700 }); flushDirectory(root);
  for (const [name, raw] of [['ledger.jsonl', ''], ['checkpoint.json', checkpoint('', validateDurableReplayLedger(''))]]) {
    const fd = protectedFile(join(root, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, uid);
    try { writeAll(fd, raw); } finally { closeSync(fd); }
  }
  flushDirectory(root); rmdirSync(join(root, 'in-progress')); flushDirectory(root);
  return Object.freeze({ status: 'ledger-initialized', authorizing: false });
}

function readState(root, uid) {
  const raw = readProtected(join(root, 'ledger.jsonl'), uid);
  const parsed = validateDurableReplayLedger(raw);
  assert.equal(readProtected(join(root, 'checkpoint.json'), uid), checkpoint(raw, parsed));
  assert.deepEqual(readdirSync(root).sort(), ['checkpoint.json', 'in-progress', 'ledger.jsonl']);
  return { raw, parsed };
}

// Holds the exclusive directory lock across the entire release transaction.
// A crash or uncertain write leaves it present. Never expire, delete or auto-resume it.
// The same library may serve two SEPARATE owners/directories; it grants no privileges.
export function openReplayTransaction(root, uid = process.getuid()) {
  checkDirectory(root, uid);
  mkdirSync(join(root, 'in-progress'), { mode: 0o700 }); flushDirectory(root);
  let state;
  try {
    state = readState(root, uid);
    assert.equal(state.parsed.terminal, true);
  } catch (error) {
    // Suspect history is quarantined behind this lock for operator review.
    throw new Error('Replay ledger requires operator review', { cause: error });
  }
  let closed = false; let identity; let uncertain = false;
  const append = (event, recordedAt, candidate) => {
    assert.equal(closed || uncertain, false);
    checkDirectory(root, uid);
    // Reread and verify before every state transition, not just the first write.
    const current = readState(root, uid);
    assert.equal(current.raw, state.raw);
    timestamp(recordedAt);
    if (event === 'observed') {
      assert.equal(identity, undefined); validateIdentity(candidate);
    } else { assert.ok(identity); candidate = identity; }
    const record = { sequence: state.parsed.records.length + 1, previousHash: state.parsed.headSha256,
      event, ...candidate, recordedAt };
    const raw = state.raw + canonical(record);
    assert.ok(Buffer.byteLength(raw) <= limit);
    const parsed = validateDurableReplayLedger(raw);
    uncertain = true; // From here, any I/O failure requires operator review; never retry append.
    const fd = protectedFile(join(root, 'ledger.jsonl'), constants.O_WRONLY | constants.O_APPEND, uid);
    try { writeAll(fd, canonical(record)); } finally { closeSync(fd); }
    const pending = join(root, 'checkpoint.pending');
    const ck = protectedFile(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, uid);
    try { writeAll(ck, checkpoint(raw, parsed)); } finally { closeSync(ck); }
    renameSync(pending, join(root, 'checkpoint.json')); flushDirectory(root);
    state = { raw, parsed }; identity = Object.freeze({ ...candidate }); uncertain = false;
    return Object.freeze({ status: 'ledger-event-recorded', event, sequence: record.sequence,
      headSha256: parsed.headSha256, authorizing: false });
  };
  return Object.freeze({
    snapshot: () => {
      assert.equal(closed || uncertain, false);
      const current = readState(root, uid); assert.equal(current.raw, state.raw);
      return current.parsed;
    },
    begin: (candidate, recordedAt) => append('observed', recordedAt, candidate),
    advance: (event, recordedAt) => {
      assert.ok(['verified', 'authorized', 'executing', 'consumed', 'failed'].includes(event));
      return append(event, recordedAt);
    },
    close: () => {
      assert.equal(closed || uncertain, false);
      const current = readState(root, uid); assert.equal(current.raw, state.raw);
      assert.equal(current.parsed.terminal, true);
      rmdirSync(join(root, 'in-progress')); flushDirectory(root); closed = true;
      return Object.freeze({ status: 'ledger-closed', authorizing: false });
    },
  });
}
