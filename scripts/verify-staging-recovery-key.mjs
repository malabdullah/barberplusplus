import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupRoot, requirePrivate, validateId, validateManifest } from './pull-staging-backup.mjs';

export function checkRecoveryFixture(directory, id) {
  validateId(id);
  if (!id.startsWith('fixture-')) throw new Error('Recovery key checks require a synthetic fixture');
  requirePrivate(directory, true);
  const metadata = join(directory, 'manifest.json');
  const payload = join(directory, 'payload.tar.age');
  requirePrivate(metadata);
  requirePrivate(payload);
  if (lstatSync(metadata).size > 16384 || lstatSync(payload).size > 1024 * 1024) {
    throw new Error('Recovery fixture exceeds size limits');
  }
  const manifest = JSON.parse(readFileSync(metadata, 'utf8'));
  validateManifest(manifest, id);
  const data = readFileSync(payload);
  if (data.length !== manifest.bytes || createHash('sha256').update(data).digest('hex') !== manifest.sha256) {
    throw new Error('Recovery fixture checksum mismatch');
  }
  return { manifest, payload };
}

export function verifyRecoveryKey(directory, id, key) {
  const { manifest, payload } = checkRecoveryFixture(directory, id);
  if (!Buffer.isBuffer(key) || key.length > 128
    || !/^AGE-SECRET-KEY-1[0-9A-Z]{58}\r?\n?$/.test(key.toString('ascii'))
    || key.some((byte) => byte > 127)) {
    throw new Error('Expected one age secret key line');
  }
  try {
    // The supplied recovery copy travels only through stdin, never argv, an
    // environment variable or a temporary identity file. Do not fall back to
    // the working identity. Decrypted output and age errors are discarded.
    execFileSync('age', ['--decrypt', '--identity', '-', payload], {
      input: key, stdio: ['pipe', 'ignore', 'ignore'], timeout: 30000,
    });
  } catch { throw new Error('Recovery key did not decrypt the fixture'); }
  const receipt = {
    version: 1, status: 'supplied-recovery-key-verified',
    id, sha256: manifest.sha256, verifiedAt: new Date().toISOString(),
    kind: 'synthetic-probe', databaseRestoreVerified: false, storageRestoreVerified: false,
  };
  const receiptPath = join(directory, `recovery-key-check-${randomUUID()}.json`);
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return receiptPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = Buffer.alloc(129);
  try {
    const [mode, id] = process.argv.slice(2);
    if (process.argv.length !== 4 || !['--preflight', '--verify'].includes(mode)) throw new Error('Invalid arguments');
    validateId(id);
    requirePrivate('/Users/malabdullah/BarberBackups', true);
    requirePrivate(backupRoot, true);
    const directory = join(backupRoot, id);
    if (mode === '--preflight') {
      checkRecoveryFixture(directory, id);
      console.log('Synthetic recovery fixture is ready.');
    } else {
      let length = 0;
      while (length < input.length) {
        const count = readSync(0, input, length, input.length - length, null);
        if (count === 0) break;
        length += count;
      }
      verifyRecoveryKey(directory, id, input.subarray(0, length));
      console.log('PASS: the supplied recovery key decrypted the synthetic fixture. Private receipt saved.');
    }
  } catch {
    // Never echo input, exception objects, subprocess errors or file contents.
    console.error('Recovery check failed; no successful recovery receipt was created.');
    process.exitCode = 1;
  } finally { input.fill(0); }
}
