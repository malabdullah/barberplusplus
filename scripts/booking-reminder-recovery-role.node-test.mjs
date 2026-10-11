import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { BOOKING_REMINDER_MIGRATION, bookingReminderRecoveryRole, bookingReminderRoleQuery,
  validateBookingReminderRole, restoreBookingReminderRoleSql } from './booking-reminder-recovery-role.mjs';
const candidate = { migrations: [BOOKING_REMINDER_MIGRATION] };
test('reminder recovery role binds exactly to reviewed migration bytes', () => {
  const data = readFileSync(new URL('../supabase/migrations/' + BOOKING_REMINDER_MIGRATION.file, import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'), BOOKING_REMINDER_MIGRATION.sha256);
  assert.deepEqual(validateBookingReminderRole(structuredClone(bookingReminderRecoveryRole), candidate), bookingReminderRecoveryRole);
  assert.doesNotMatch(bookingReminderRoleQuery, /pg_authid|rolpassword/i);
  assert.match(restoreBookingReminderRoleSql(bookingReminderRecoveryRole, candidate), /NOLOGIN NOINHERIT NOSUPERUSER/);
});
test('historical checkpoints require no extra role; unbound and missing roles fail closed', () => {
  assert.equal(restoreBookingReminderRoleSql(undefined, { migrations: [] }), '');
  assert.equal(validateBookingReminderRole(null, { migrations: [] }), null);
  assert.throws(() => validateBookingReminderRole(bookingReminderRecoveryRole, { migrations: [] }));
  assert.throws(() => validateBookingReminderRole(null, candidate));
  assert.throws(() => validateBookingReminderRole(bookingReminderRecoveryRole, { migrations: [{ ...BOOKING_REMINDER_MIGRATION, sha256: '0'.repeat(64) }] }));
});
test('role recovery rejects elevation, API memberships, settings and secret fields', () => {
  for (const change of [{ name: 'postgres' }, { superuser: true }, { login: true }, { bypassRls: true },
    { createRole: true }, { memberships: [] }, { config: ['search_path=untrusted'] },
    { password: 'synthetic-forbidden-field' }, { parameters: [{ parameter: 'log_min_messages' }] }]) {
    assert.throws(() => restoreBookingReminderRoleSql({ ...structuredClone(bookingReminderRecoveryRole), ...change }, candidate));
  }
});
