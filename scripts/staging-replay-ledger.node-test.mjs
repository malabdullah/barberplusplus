import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, chmodSync, existsSync,
  mkdirSync, unlinkSync, symlinkSync, linkSync, statSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { initializeReplayLedger, openReplayTransaction, validateDurableReplayLedger } from './staging-replay-ledger.mjs';

const time = '2026-10-08T09:00:00.000Z';
const digest = value => `sha256:${value.repeat(64)}`;
const identity = (value = 'a') => ({ bindingSha256: value.repeat(64),
  requestId: `1123713308:${value === 'a' ? '123' : '124'}:1:${value.repeat(32)}`,
  artifactId: value === 'a' ? '321' : '322', envelopeSha256: digest(value), commit: value.repeat(40),
  frontendDigest: digest(value), functionsDigest: digest(value), migrationTreeSha256: digest(value) });
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'barber-ledger-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initializeReplayLedger(root);
  return root;
}
function finish(root, value = identity()) {
  const tx = openReplayTransaction(root); tx.begin(value, time);
  for (const event of ['verified', 'authorized', 'executing', 'consumed']) tx.advance(event, time);
  tx.close();
}
function rechained(records) {
  let head = '0'.repeat(64);
  return records.map((value, index) => {
    const record = { ...value, sequence: index + 1, previousHash: head };
    const raw = JSON.stringify(record); head = createHash('sha256').update(raw).digest('hex');
    return `${raw}\n`;
  }).join('');
}

test('explicit initialization, durable terminal transitions and reopen preserve independent histories', t => {
  const root = fixture(t); finish(root);
  const first = readFileSync(join(root, 'ledger.jsonl'), 'utf8');
  const tx = openReplayTransaction(root);
  assert.equal(tx.snapshot().records.length, 5);
  assert.equal(tx.snapshot().authorizing, false);
  tx.begin(identity('b'), time); tx.advance('failed', time); tx.close();
  const all = readFileSync(join(root, 'ledger.jsonl'), 'utf8');
  assert.ok(all.startsWith(first));
  assert.equal(validateDurableReplayLedger(all).records.length, 7);
  for (const name of ['ledger.jsonl', 'checkpoint.json']) assert.equal(statSync(join(root, name)).mode & 0o777, 0o600);
  assert.equal(existsSync(join(root, 'in-progress')), false);
});

test('concurrent processes cannot acquire a held release transaction', t => {
  const root = fixture(t); const tx = openReplayTransaction(root);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { openReplayTransaction } from ${JSON.stringify(new URL('./staging-replay-ledger.mjs', import.meta.url).href)};
     try { openReplayTransaction(process.argv[1]); process.exitCode = 1; } catch { process.exitCode = 0; }`, root]);
  assert.equal(child.status, 0); tx.close();
});

test('a real killed process leaves a lock and no automatic retry', t => {
  const root = fixture(t);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { openReplayTransaction } from ${JSON.stringify(new URL('./staging-replay-ledger.mjs', import.meta.url).href)};
     const tx = openReplayTransaction(process.argv[1]); tx.begin(${JSON.stringify(identity())}, ${JSON.stringify(time)});
     process.kill(process.pid, 'SIGKILL');`, root]);
  assert.equal(child.signal, 'SIGKILL');
  assert.ok(existsSync(join(root, 'in-progress')));
  assert.throws(() => openReplayTransaction(root));
  assert.equal(validateDurableReplayLedger(readFileSync(join(root, 'ledger.jsonl'), 'utf8')).terminal, false);
});

test('unfinished transaction cannot close, skip states or change identity', t => {
  const root = fixture(t); const tx = openReplayTransaction(root);
  tx.begin(identity(), time);
  assert.throws(() => tx.close());
  assert.throws(() => tx.advance('executing', time));
  assert.throws(() => tx.begin(identity('b'), time));
  tx.advance('failed', time); tx.close();
  assert.throws(() => tx.advance('verified', time));
});

test('every replay dimension is denied even when other request fields change', t => {
  const root = fixture(t); finish(root);
  const tx = openReplayTransaction(root);
  const original = identity();
  for (const key of ['bindingSha256', 'requestId', 'artifactId', 'envelopeSha256']) {
    assert.throws(() => tx.begin({ ...identity('b'), [key]: original[key] }, time));
  }
  assert.throws(() => tx.begin({ ...identity('b'), requestId: `1123713308:123:1:${'b'.repeat(32)}` }, time));
  assert.throws(() => tx.begin({ ...identity('b'), requestId: `1123713308:124:1:${'a'.repeat(32)}` }, time));
  assert.throws(() => tx.begin({ ...identity('b'), commit: original.commit, frontendDigest: original.frontendDigest,
    functionsDigest: original.functionsDigest, migrationTreeSha256: original.migrationTreeSha256 }, time));
  tx.close();
});

test('strict identity rejects foreign repo, rerun, unsafe numeric IDs and extra fields', t => {
  const root = fixture(t); const tx = openReplayTransaction(root);
  for (const bad of [
    { ...identity(), requestId: `1123713309:123:1:${'a'.repeat(32)}` },
    { ...identity(), requestId: `1123713308:123:2:${'a'.repeat(32)}` },
    { ...identity(), artifactId: '9007199254740993' },
    { ...identity(), artifactId: 321 },
    { ...identity(), command: 'anything' },
    { ...identity(), frontendDigest: 'latest' },
  ]) assert.throws(() => tx.begin(bad, time));
  tx.close();
});

test('timestamps must be real canonical dates and never regress', t => {
  const root = fixture(t); const tx = openReplayTransaction(root);
  assert.throws(() => tx.begin(identity(), '2026-02-30T09:00:00.000Z'));
  assert.throws(() => tx.begin(identity(), '2026-10-08T09:00:00Z'));
  tx.begin(identity(), time);
  assert.throws(() => tx.advance('verified', '2026-10-08T08:59:59.000Z'));
  tx.advance('failed', time); tx.close();
});

test('valid chain hashes cannot disguise illegal lifecycle, identity switching or replay', t => {
  const root = fixture(t); finish(root);
  const records = readFileSync(join(root, 'ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  for (const mutate of [
    rows => { rows[1].event = 'executing'; },
    rows => { rows[1].artifactId = '999'; },
    rows => { rows[0].event = 'consumed'; },
    rows => { rows.push({ ...rows[0] }); },
  ]) { const changed = structuredClone(records); mutate(changed); assert.throws(() => validateDurableReplayLedger(rechained(changed))); }
});

test('checkpoint detects truncation at an otherwise valid record boundary', t => {
  const root = fixture(t); finish(root);
  writeFileSync(join(root, 'ledger.jsonl'), '', { mode: 0o600 });
  assert.throws(() => openReplayTransaction(root), /operator review/);
  assert.ok(existsSync(join(root, 'in-progress')));
});

test('partial writes, missing checkpoint and pending checkpoint quarantine instead of repairing', t => {
  for (const mutate of [
    root => writeFileSync(join(root, 'ledger.jsonl'), '{"partial":'),
    root => unlinkSync(join(root, 'checkpoint.json')),
    root => writeFileSync(join(root, 'checkpoint.pending'), '{}', { mode: 0o600 }),
  ]) {
    const root = fixture(t); mutate(root);
    assert.throws(() => openReplayTransaction(root), /operator review/);
    assert.ok(existsSync(join(root, 'in-progress')));
  }
});

test('changes while locked are rejected before further append', t => {
  const root = fixture(t); const tx = openReplayTransaction(root);
  tx.begin(identity(), time);
  chmodSync(join(root, 'ledger.jsonl'), 0o644);
  assert.throws(() => tx.advance('verified', time));
  assert.ok(existsSync(join(root, 'in-progress')));
});

test('file symlinks, hardlinks, directories, unprotected permissions and owner mismatch are denied', t => {
  for (const mutate of [
    root => { renameSync(join(root, 'ledger.jsonl'), join(root, 'target')); symlinkSync('target', join(root, 'ledger.jsonl')); },
    root => linkSync(join(root, 'ledger.jsonl'), join(root, 'linked')),
    root => { unlinkSync(join(root, 'ledger.jsonl')); mkdirSync(join(root, 'ledger.jsonl')); },
    root => chmodSync(join(root, 'ledger.jsonl'), 0o644),
  ]) {
    const root = fixture(t); mutate(root); assert.throws(() => openReplayTransaction(root));
  }
  const root = fixture(t);
  assert.throws(() => openReplayTransaction(root, process.getuid() + 1));
  chmodSync(root, 0o755); assert.throws(() => openReplayTransaction(root));
});

test('oversized ledger is denied and existing state never automatically initialized', t => {
  const root = fixture(t);
  assert.throws(() => initializeReplayLedger(root));
  writeFileSync(join(root, 'ledger.jsonl'), 'x'.repeat(1024 * 1024 + 1));
  assert.throws(() => openReplayTransaction(root));
});

test('failed release is terminal and cannot be resumed even if lock was cleared normally', t => {
  const root = fixture(t); const tx = openReplayTransaction(root);
  tx.begin(identity(), time); tx.advance('failed', time); tx.close();
  const next = openReplayTransaction(root);
  assert.throws(() => next.begin(identity(), time)); next.close();
});
