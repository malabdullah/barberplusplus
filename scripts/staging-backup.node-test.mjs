import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { receiveArchive, requirePrivate, validateId, validateManifest, verifyEncryptedFile } from './pull-staging-backup.mjs';

const id = 'fixture-20260928T120000Z-01234567';
const fixture = () => ({ version: 1, id, environment: 'staging', sourceHost: 'srv1207055', kind: 'synthetic-probe', file: 'payload.tar.age', sha256: 'a'.repeat(64), bytes: 100, createdAt: '2026-09-28T12:00:00Z' });
test('accepts only scoped backup identifiers', () => {
  validateId(id);
  for (const unsafe of ['../production', 'fixture-20260928T120000Z-01234567;id', '', 'production-20260928T120000Z-01234567']) assert.throws(() => validateId(unsafe));
  validateManifest(fixture(), id);
});
for (const [field, value] of Object.entries({ sourceHost: 'srv1073968', environment: 'production', kind: 'staging-backup', file: '../identity.txt', sha256: 'wrong', bytes: 0, createdAt: 'invalid', id: 'different' })) {
  test(`rejects unsafe manifest ${field}`, () => assert.throws(() => validateManifest({ ...fixture(), [field]: value }, id)));
}
test('rejects excessive or fractional transfer size', () => {
  for (const bytes of [51 * 1024 ** 3, 1.5, -1, '100']) assert.throws(() => validateManifest({ ...fixture(), bytes }, id));
});
test('rejects unrecognized manifest fields rather than storing possible secrets', () => {
  assert.throws(() => validateManifest({ ...fixture(), unexpected: 'synthetic' }, id));
});
test('requires private non-symlink files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'barber-backup-permission-test-'));
  try {
    const file = join(dir, 'fixture');
    writeFileSync(file, 'synthetic', { mode: 0o600 });
    requirePrivate(file);
    chmodSync(file, 0o644);
    assert.throws(() => requirePrivate(file));
    chmodSync(file, 0o600);
    symlinkSync(file, join(dir, 'link'));
    assert.throws(() => requirePrivate(join(dir, 'link')));
  } finally { rmSync(dir, { recursive: true }); }
});
test('authenticates ciphertext; rejects wrong keys, corruption and size mismatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'barber-backup-crypto-test-'));
  const run = (...args) => execFileSync(args[0], args.slice(1), { stdio: 'ignore' });
  try {
    const key = join(dir, 'key'); const wrong = join(dir, 'wrong');
    const recipient = join(dir, 'recipient'); const plain = join(dir, 'plain'); const encrypted = join(dir, 'payload.age');
    run('age-keygen', '-o', key); run('age-keygen', '-o', wrong);
    run('age-keygen', '-y', '-o', recipient, key);
    writeFileSync(plain, 'Synthetic fixture. No customer data.', { mode: 0o600 });
    run('age', '-R', recipient, '-o', encrypted, plain);
    chmodSync(encrypted, 0o600);
    const data = readFileSync(encrypted);
    const manifest = { ...fixture(), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    await verifyEncryptedFile(encrypted, manifest, key);
    await assert.rejects(verifyEncryptedFile(encrypted, manifest, wrong), /authentication/);
    await assert.rejects(verifyEncryptedFile(encrypted, { ...manifest, bytes: data.length + 1 }, key), /checksum/);
    const partial = mkdtempSync(join(dir, 'partial-'));
    const destination = join(dir, 'completed');
    await receiveArchive(Readable.from(data), Promise.resolve(), partial, destination, manifest, key);
    const receipt = JSON.parse(readFileSync(join(destination, 'receipt.json')));
    assert.equal(receipt.status, 'encrypted-transfer-verified');
    assert.equal(receipt.kind, 'synthetic-probe');
    assert.equal(receipt.restoreVerified, false);
    const duplicate = mkdtempSync(join(dir, 'duplicate-'));
    await assert.rejects(receiveArchive(Readable.from(data), Promise.resolve(), duplicate, destination, manifest, key), /EEXIST/);
    assert.deepEqual(readFileSync(join(destination, 'payload.tar.age')), data);
    data[data.length - 1] ^= 1;
    writeFileSync(encrypted, data);
    await assert.rejects(verifyEncryptedFile(encrypted, manifest, key), /checksum/);
    // Even an altered manifest cannot make tampered ciphertext authenticate.
    await assert.rejects(verifyEncryptedFile(encrypted, { ...manifest, sha256: createHash('sha256').update(data).digest('hex') }, key), /authentication/);
  } finally { rmSync(dir, { recursive: true }); }
});

for (const scenario of ['interrupted', 'remote failure', 'excess bytes', 'truncated']) {
  test(`does not publish a receipt after ${scenario} transfer`, async () => {
    const partial = mkdtempSync(join(tmpdir(), 'barber-backup-stream-test-'));
    const destination = join(partial, 'must-not-exist');
    try {
      const identity = join(partial, 'identity');
      execFileSync('age-keygen', ['-o', identity], { stdio: 'ignore' });
      const recipient = execFileSync('age-keygen', ['-y', identity], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const encrypted = execFileSync('age', ['-r', recipient], { input: 'Synthetic stream test', stdio: ['pipe', 'pipe', 'ignore'] });
      const manifest = { ...fixture(), bytes: encrypted.length, sha256: createHash('sha256').update(encrypted).digest('hex') };
      const half = encrypted.subarray(0, Math.floor(encrypted.length / 2));
      const source = scenario === 'interrupted' ? Readable.from((async function* () {
        yield half; throw new Error('Synthetic disconnect');
      })()) : Readable.from(scenario === 'excess bytes' ? Buffer.concat([encrypted, Buffer.alloc(1)])
        : scenario === 'truncated' ? half : encrypted);
      const finished = scenario === 'remote failure' ? Promise.reject(new Error('Synthetic SSH exit')) : Promise.resolve();
      await assert.rejects(receiveArchive(source, finished, partial, destination, manifest, identity), /disconnect|SSH exit|exceeds|checksum/);
      assert.equal(existsSync(destination), false);
      assert.equal(existsSync(join(partial, 'receipt.json')), false);
    } finally { rmSync(partial, { recursive: true }); }
  });
}
