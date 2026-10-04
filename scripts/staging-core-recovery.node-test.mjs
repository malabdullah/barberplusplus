import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPrivateStorageDenied, packRecoveryFixture, unpackRecoveryFixture } from './rehearse-staging-core-recovery.mjs';

test('Storage denial requires a known authorization response, never server/token errors', () => {
  assert.equal(isPrivateStorageDenied(400, { statusCode: '404', error: 'Bucket not found' }), true);
  assert.equal(isPrivateStorageDenied(404, { statusCode: '404', error: 'not_found' }), true);
  assert.equal(isPrivateStorageDenied(403, { statusCode: '403', error: 'Unauthorized' }), true);
  for (const status of [200, 401, 429, 500, 502, 503]) {
    assert.equal(isPrivateStorageDenied(status, { statusCode: '404', error: 'not_found' }), false);
  }
  assert.equal(isPrivateStorageDenied(400, { statusCode: '500', error: 'Internal' }), false);
  assert.equal(isPrivateStorageDenied(400, { statusCode: '400', error: 'InvalidJWT' }), false);
  assert.equal(isPrivateStorageDenied(400, { statusCode: '404', error: 'Unknown' }), false);
  assert.equal(isPrivateStorageDenied(400, null), false);
});

test('synthetic archive round-trip preserves DB, Storage and config', () => {
  const database = Buffer.from('synthetic-db');
  const storage = Buffer.from('synthetic-storage');
  const databaseConfig = Buffer.from('synthetic-root-key-volume');
  const config = { name: 'synthetic-only', services: {} };
  const restored = unpackRecoveryFixture(packRecoveryFixture(database, storage, databaseConfig, config));
  assert.deepEqual(restored, { database, storage, databaseConfig, config, recoveryRole: null });
});

test('archive parser rejects wrong kind, version and mismatched payload checksums', () => {
  const packed = packRecoveryFixture(Buffer.from('db'), Buffer.from('storage'), Buffer.from('key-volume'), {});
  for (const change of [
    (data) => { data.version = 1; },
    (data) => { data.kind = 'staging-backup'; },
    (data) => { data.database = Buffer.from('changed').toString('base64'); },
    (data) => { data.storage = ''; },
    (data) => { data.storageSha256 = '0'.repeat(64); },
    (data) => { delete data.databaseConfig; },
    (data) => { data.databaseConfigSha256 = '0'.repeat(64); },
    (data) => { delete data.recoveryRole; },
    (data) => { data.recoveryRoleSha256 = '0'.repeat(64); },
  ]) {
    const data = JSON.parse(packed.toString());
    change(data);
    assert.throws(() => unpackRecoveryFixture(Buffer.from(JSON.stringify(data))));
  }
});

test('rehearsal archives are bounded and require binary nonempty inputs', () => {
  assert.throws(() => packRecoveryFixture(Buffer.alloc(0), Buffer.from('storage'), Buffer.from('config'), {}));
  assert.throws(() => packRecoveryFixture('db', Buffer.from('storage'), Buffer.from('config'), {}));
  assert.throws(() => packRecoveryFixture(Buffer.from('db'), Buffer.alloc(0), Buffer.from('config'), {}));
  assert.throws(() => packRecoveryFixture(Buffer.from('db'), Buffer.from('storage'), Buffer.alloc(0), {}));
  assert.throws(() => unpackRecoveryFixture(Buffer.alloc(33 * 1024 * 1024)));
});
