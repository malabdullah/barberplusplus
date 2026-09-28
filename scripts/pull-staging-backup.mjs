import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, renameSync, rmdirSync, statfsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const backupRoot = '/Users/malabdullah/BarberBackups/staging';
export const keyRoot = '/Users/malabdullah/.config/barber-staging-backup';
const maxBytes = 50 * 1024 ** 3;
const remoteRoot = '/var/backups/barber-staging/export';
const sshArgs = ['-i', '/Users/malabdullah/.ssh/barber_staging_admin_ed25519',
  '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
  'barber-admin@185.97.146.8'];

export function validateId(id) {
  if (!/^(?:staging|fixture)-\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(id)) throw new Error('Invalid staging backup identifier');
}

export function validateManifest(manifest, id) {
  validateId(id);
  if (!manifest || manifest.version !== 1 || manifest.environment !== 'staging'
    || Object.keys(manifest).sort().join() !== 'bytes,createdAt,environment,file,id,kind,sha256,sourceHost,version'
    || manifest.sourceHost !== 'srv1207055' || manifest.id !== id
    || !['staging-backup', 'synthetic-probe'].includes(manifest.kind)
    || (manifest.kind === 'synthetic-probe') !== id.startsWith('fixture-')
    || manifest.file !== 'payload.tar.age' || !/^[a-f0-9]{64}$/.test(manifest.sha256)
    || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > maxBytes
    || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new Error('Invalid staging backup manifest');
  }
}

export function requirePrivate(path, directory = false) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())
    || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error('Backup path must be private, owned by this user, and not a symlink');
}

export async function verifyEncryptedFile(path, manifest, identity, age = 'age') {
  requirePrivate(path);
  requirePrivate(identity);
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; digest.update(chunk); }
  if (bytes !== manifest.bytes || digest.digest('hex') !== manifest.sha256) throw new Error('Encrypted backup size or checksum mismatch');
  try {
    // Authenticate the entire ciphertext without writing or displaying plaintext.
    execFileSync(age, ['--decrypt', '-i', identity, path], { stdio: 'ignore', timeout: 3600000 });
  } catch { throw new Error('Encrypted backup authentication/decryption failed'); }
}

function remoteRead(id, file) {
  validateId(id);
  if (!['manifest.json', 'payload.tar.age'].includes(file)) throw new Error('Invalid export filename');
  const directory = `${remoteRoot}/${id}`;
  // Every path component is fixed or validated. No caller-provided host, path,
  // shell fragment, or filename can reach SSH. Only root-owned exports qualify.
  return `set -eu; test "$(hostname -s)" = srv1207055; `
    + `sudo -n sh -c 'set -eu; for p in /var/backups/barber-staging ${remoteRoot} ${directory}; do `
    + `test ! -L "$p"; test -d "$p"; test "$(stat -c %u "$p")" = 0; `
    + `test "$(stat -c %a "$p")" = 700; done; `
    + `test ! -L ${directory}/${file}; test -f ${directory}/${file}; `
    + `test "$(stat -c %u ${directory}/${file})" = 0; `
    + `test "$(stat -c %a ${directory}/${file})" = 600; cat ${directory}/${file}'`;
}

export async function receiveArchive(source, finished, partial, destination, manifest, identity) {
  requirePrivate(partial, true);
  validateManifest(manifest, manifest.id);
  const payload = join(partial, 'payload.tar.age');
  let received = 0;
  const limit = new Transform({ transform(chunk, _, callback) {
    received += chunk.length;
    callback(received > manifest.bytes ? new Error('Transfer exceeds declared size') : null, chunk);
  } });
  await Promise.all([finished, pipeline(source, limit, createWriteStream(payload, { flags: 'wx', mode: 0o600 }))]);
  await verifyEncryptedFile(payload, manifest, identity);
  writeFileSync(join(partial, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(partial, 'receipt.json'), JSON.stringify({
    status: 'encrypted-transfer-verified', id: manifest.id, kind: manifest.kind,
    verifiedAt: new Date().toISOString(), sha256: manifest.sha256, bytes: manifest.bytes,
    restoreVerified: false,
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  // mkdir is exclusive, even if another process created an empty destination.
  // Publish the receipt LAST. Directory existence alone never means success.
  mkdirSync(destination, { mode: 0o700 });
  renameSync(payload, join(destination, 'payload.tar.age'));
  renameSync(join(partial, 'manifest.json'), join(destination, 'manifest.json'));
  renameSync(join(partial, 'receipt.json'), join(destination, 'receipt.json'));
  rmdirSync(partial);
}

export async function pullBackup(id) {
  validateId(id);
  requirePrivate('/Users/malabdullah/BarberBackups', true);
  requirePrivate(backupRoot, true);
  requirePrivate(keyRoot, true);
  const identity = join(keyRoot, 'identity.txt');
  requirePrivate(identity);
  const destination = join(backupRoot, id);
  if (existsSync(destination)) throw new Error('Backup destination already exists; refusing overwrite');
  let manifest;
  try {
    manifest = JSON.parse(execFileSync('ssh', [...sshArgs, remoteRead(id, 'manifest.json')],
      { encoding: 'utf8', maxBuffer: 16384, timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { throw new Error('Unable to read staging export manifest; no backup accepted'); }
  validateManifest(manifest, id);
  const disk = statfsSync(backupRoot);
  if (disk.bavail * disk.bsize < manifest.bytes + 2 * 1024 ** 3) throw new Error('Insufficient backup disk space (2 GiB reserve required)');
  const partial = join(backupRoot, `.partial-${id}-${randomUUID()}`);
  mkdirSync(partial, { mode: 0o700 });
  const child = spawn('ssh', [...sshArgs, remoteRead(id, 'payload.tar.age')], { stdio: ['ignore', 'pipe', 'ignore'] });
  const timer = setTimeout(() => child.kill('SIGTERM'), 3600000);
  const finished = new Promise((resolve, reject) => {
    child.on('error', () => reject(new Error('Staging transfer could not start')));
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error('Staging transfer interrupted')));
  });
  try {
    await receiveArchive(child.stdout, finished, partial, destination, manifest, identity);
    return { id, kind: manifest.kind, bytes: manifest.bytes, destination };
  } catch {
    child.kill('SIGTERM');
    // Keep only encrypted partial data for inspection, never a success receipt
    // at a completed destination. No retention/deletion is automatic.
    throw new Error('Backup transfer or verification failed; encrypted partial directory retained');
  } finally { clearTimeout(timer); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/pull-staging-backup.mjs <backup-id>');
    console.log(JSON.stringify(await pullBackup(process.argv[2])));
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Invalid backup metadata' : error.message);
    process.exitCode = 1;
  }
}
