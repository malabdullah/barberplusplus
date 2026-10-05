import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { APPROVED_SOURCE, validatePrivateModel } from './staging-private-model.mjs';
import { validateRecoveryRole } from './staging-recovery-roles.mjs';

export const BACKUP_LIMIT = 64 * 1024 * 1024;
export const checksum = (data) => createHash('sha256').update(data).digest('hex');
const privateFiles = ['compose.private.json', 'synthetic-accounts.json', 'synthetic-integration.json',
  'seed.private.sql', 'prepared.json', 'initialized.json', 'functional-verified.json', 'security-tests.sql'];
export function validateBackupFile(path) {
  assert.ok(privateFiles.includes(path) || /^sql\/(realtime|_supabase|logs|webhooks|pooler|jwt|roles)\.sql$/.test(path)
    || /^gateway\/(docker-entrypoint\.sh|envoy\.yaml|lds\.template\.yaml|cds\.yaml)$/.test(path)
    || /^migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(path), 'Unexpected backup file');
}
export function packPrivateBackup(parts, metadata) {
  const entries = Object.fromEntries(Object.entries(parts).map(([name, bytes]) => {
    assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0);
    return [name, { sha256: checksum(bytes), data: bytes.toString('base64') }];
  }));
  const value = Buffer.from(JSON.stringify({ kind: 'barber-staging-eight-service-backup/v1', metadata, entries }));
  unpackPrivateBackup(value);
  return value;
}
export function unpackPrivateBackup(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= BACKUP_LIMIT);
  const bundle = JSON.parse(bytes.toString());
  assert.equal(bundle.kind, 'barber-staging-eight-service-backup/v1');
  assert.deepEqual(Object.keys(bundle).sort(), ['entries', 'kind', 'metadata']);
  assert.equal(bundle.metadata.source, APPROVED_SOURCE);
  assert.equal(bundle.metadata.host, 'srv1207055');
  assert.match(bundle.metadata.id, /^staging-\d{8}T\d{6}Z-[a-f0-9]{8}$/);
  assert.match(bundle.metadata.vaultProbe, /^[a-f0-9]{48}$/);
  validateRecoveryRole(bundle.metadata.recoveryRole);
  const entries = {};
  for (const [path, entry] of Object.entries(bundle.entries)) {
    if (!['database.dump', 'storage.tar', 'database-config.tar'].includes(path)) validateBackupFile(path);
    assert.deepEqual(Object.keys(entry).sort(), ['data', 'sha256']);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    const data = Buffer.from(entry.data, 'base64');
    assert.ok(data.length > 0 && data.toString('base64') === entry.data);
    assert.equal(checksum(data), entry.sha256);
    entries[path] = data;
  }
  for (const path of [...privateFiles, 'database.dump', 'storage.tar', 'database-config.tar']) assert.ok(entries[path]);
  const model = JSON.parse(entries['compose.private.json']);
  validatePrivateModel(model);
  const prepared = JSON.parse(entries['prepared.json']);
  assert.equal(prepared.approvedSource, APPROVED_SOURCE);
  assert.equal(checksum(entries['compose.private.json']), prepared.composeSha256);
  assert.equal(checksum(entries['seed.private.sql']), prepared.seedSha256);
  for (const [path, digest] of Object.entries(prepared.publicFiles)) {
    validateBackupFile(path); assert.equal(checksum(entries[path]), digest);
  }
  for (const [path, digest] of Object.entries(prepared.migrations)) assert.equal(checksum(entries[`migrations/${path}`]), digest);
  return { metadata: bundle.metadata, entries, model };
}
