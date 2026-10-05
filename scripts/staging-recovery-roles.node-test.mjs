import assert from 'node:assert/strict';
import { test } from 'node:test';
import { realtimeRecoveryRole, recoveryRoleQuery, restoreRecoveryRoleSql, validateRecoveryRole } from './staging-recovery-roles.mjs';
import { packRecoveryFixture, unpackRecoveryFixture } from './rehearse-staging-core-recovery.mjs';

test('only the reviewed non-login Realtime role can be restored', () => {
  assert.equal(validateRecoveryRole(null), null);
  assert.equal(restoreRecoveryRoleSql(null), '');
  validateRecoveryRole(structuredClone(realtimeRecoveryRole));
  assert.match(restoreRecoveryRoleSql(realtimeRecoveryRole), /NOLOGIN NOREPLICATION NOBYPASSRLS/);
  assert.doesNotMatch(recoveryRoleQuery, /pg_authid|rolpassword/i);
  for (const change of [{ name: 'postgres' }, { superuser: true }, { login: true },
    { memberships: [] }, { config: ['search_path=untrusted'] }, { parameters: [] },
    { extra: 'unreviewed' }, { password: 'must-never-enter-archive' }]) {
    assert.throws(() => restoreRecoveryRoleSql({ ...structuredClone(realtimeRecoveryRole), ...change }));
  }
});

test('encrypted-fixture payload preserves exact role metadata with a checksum', () => {
  const packed = packRecoveryFixture(Buffer.from('db'), Buffer.from('storage'), Buffer.from('config'), {}, realtimeRecoveryRole);
  assert.deepEqual(unpackRecoveryFixture(packed).recoveryRole, realtimeRecoveryRole);
  const data = JSON.parse(packed); data.recoveryRole.memberships[0].admin = true;
  assert.throws(() => unpackRecoveryFixture(Buffer.from(JSON.stringify(data))));
});
