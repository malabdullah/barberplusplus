import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkRecoveryFixture, verifyRecoveryKey } from './verify-staging-recovery-key.mjs';

const id = 'fixture-20260928T120000Z-01234567';
function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'barber-recovery-test-'));
  let key;
  try {
    const generated = execFileSync('age-keygen', [], { stdio: ['ignore', 'pipe', 'ignore'] });
    key = Buffer.from(generated.toString().split('\n').find((line) => line.startsWith('AGE-SECRET-KEY-')) + '\n');
    generated.fill(0);
    const recipient = execFileSync('age-keygen', ['-y'], { input: key, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    const payload = execFileSync('age', ['-r', recipient], { input: 'Synthetic recovery test only.', stdio: ['pipe', 'pipe', 'ignore'] });
    const manifest = { version: 1, id, environment: 'staging', sourceHost: 'srv1207055', kind: 'synthetic-probe', file: 'payload.tar.age', bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex'), createdAt: '2026-09-28T12:00:00Z' };
    writeFileSync(join(dir, 'payload.tar.age'), payload, { mode: 0o600 });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    fn({ dir, key, manifest, payload });
  } finally { key?.fill(0); rmSync(dir, { recursive: true }); }
}

test('supplied key decrypts fixture without a local identity and records only non-secret evidence', () => withFixture(({ dir, key }) => {
  const receiptPath = verifyRecoveryKey(dir, id, key);
  const receiptText = readFileSync(receiptPath, 'utf8');
  const receipt = JSON.parse(receiptText);
  assert.equal(receipt.status, 'supplied-recovery-key-verified');
  assert.equal(receipt.databaseRestoreVerified, false);
  assert.equal(receipt.storageRestoreVerified, false);
  assert.equal(receiptText.includes('AGE-SECRET-KEY'), false);
  assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
  assert.equal(readdirSync(dir).length, 3);
  const second = verifyRecoveryKey(dir, id, key);
  assert.notEqual(second, receiptPath);
}));

test('wrong or malformed keys never create success evidence', () => withFixture(({ dir, key }) => {
  const wrong = execFileSync('age-keygen', [], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const wrongLine = Buffer.from(wrong.toString().split('\n').find((line) => line.startsWith('AGE-SECRET-KEY-')));
    try { assert.throws(() => verifyRecoveryKey(dir, id, wrongLine), /did not decrypt/); }
    finally { wrongLine.fill(0); }
    for (const value of [Buffer.from(''), Buffer.concat([key, key]), Buffer.alloc(129), Buffer.from('not a key')]) {
      try { assert.throws(() => verifyRecoveryKey(dir, id, value), /one age secret/); }
      finally { value.fill(0); }
    }
    assert.equal(readdirSync(dir).length, 2);
  } finally { wrong.fill(0); }
}));

test('tampering is rejected even if the untrusted manifest checksum is updated', () => withFixture(({ dir, key, payload, manifest }) => {
  payload[payload.length - 1] ^= 1;
  writeFileSync(join(dir, 'payload.tar.age'), payload);
  assert.throws(() => verifyRecoveryKey(dir, id, key), /checksum/);
  manifest.sha256 = createHash('sha256').update(payload).digest('hex');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  assert.throws(() => verifyRecoveryKey(dir, id, key), /did not decrypt/);
  assert.equal(readdirSync(dir).length, 2);
}));

test('refuses real backups, unsafe paths, broad permissions and oversized fixtures', () => withFixture(({ dir, manifest }) => {
  assert.throws(() => checkRecoveryFixture(dir, id.replace('fixture-', 'staging-')), /synthetic/);
  assert.throws(() => checkRecoveryFixture(dir, '../invalid'));
  const file = join(dir, 'manifest.json');
  chmodSync(file, 0o644);
  assert.throws(() => checkRecoveryFixture(dir, id), /private/);
  chmodSync(file, 0o600);
  writeFileSync(file, ' '.repeat(16385));
  assert.throws(() => checkRecoveryFixture(dir, id), /size limits/);
  writeFileSync(file, JSON.stringify(manifest));
  writeFileSync(join(dir, 'payload.tar.age'), Buffer.alloc(1024 * 1024 + 1));
  assert.throws(() => checkRecoveryFixture(dir, id), /size limits/);
  symlinkSync(dir, join(dir, 'link'));
  assert.throws(() => checkRecoveryFixture(join(dir, 'link'), id), /symlink/);
}));

test('interactive wrapper refuses piped input before reading a secret', () => {
  assert.throws(() => execFileSync('bash', ['scripts/test-staging-recovery-key.sh', id], {
    input: 'synthetic non-secret input', stdio: ['pipe', 'pipe', 'pipe'],
  }), (error) => {
    assert.equal(error.status, 1);
    assert.match(error.stderr.toString(), /interactive terminal only/);
    assert.equal(error.stdout.length, 0);
    return true;
  });
});
