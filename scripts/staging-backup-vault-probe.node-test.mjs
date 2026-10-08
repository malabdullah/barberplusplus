import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { selectBackupVaultProbe } from './staging-backup-vault-probe.mjs';

test('refresh reads the existing recovery probe without writing or rotating it', () => {
  const calls = [];
  const result = selectBackupVaultProbe('refresh-private-bootstrap', query => {
    calls.push(query); return query.includes('count(*)') ? '1' : 'a'.repeat(48);
  });
  assert.equal(result, 'a'.repeat(48));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(query => query.startsWith('SELECT ')));
});
test('refresh rejects absent/extra secrets, missing probe and malformed decrypted value', () => {
  for (const [count, probe] of [['0', ''], ['2', 'a'.repeat(48)], ['1', ''], ['1', 'not-the-synthetic-probe']]) {
    assert.throws(() => selectBackupVaultProbe('refresh-private-bootstrap', query => query.includes('count(*)') ? count : probe));
  }
});
test('original bootstrap still refuses nonempty Vault and creates only one random probe', () => {
  assert.throws(() => selectBackupVaultProbe('bootstrap', () => '1'));
  const calls = [];
  const result = selectBackupVaultProbe('bootstrap', query => { calls.push(query); return '0'; });
  assert.match(result, /^[a-f0-9]{48}$/); assert.equal(calls.length, 2);
  assert.ok(calls[1].includes(`vault.create_secret('${result}', 'bootstrap_recovery_probe')`));
});
test('unknown mode is denied before any SQL', () => {
  assert.throws(() => selectBackupVaultProbe('force', () => assert.fail('must not query')));
});
test('capture retains isolation/model checks, exclusive lock, encrypted publication and no reset', () => {
  const source = readFileSync(new URL('./capture-private-staging-backup.mjs', import.meta.url), 'utf8');
  for (const fragment of ["validatePrivateModel(model)", "'--refresh-private-bootstrap'", 'mkdirSync(lockPath',
    "'/usr/bin/age'", 'flush(`${directory}/payload.tar.age`)', 'captureComplete && !quiesced',
    'state.State.Health.Status', 'packPrivateBackup(parts']) assert.ok(source.includes(fragment));
  assert.ok(!/db reset|DROP DATABASE|vault\.delete/.test(source));
});
