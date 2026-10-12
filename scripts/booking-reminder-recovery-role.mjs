import assert from 'node:assert/strict';
import { recoveryRoleQuery } from './staging-recovery-roles.mjs';

export const BOOKING_REMINDER_MIGRATION = Object.freeze({
  file: '20261011085658_private_booking_reminder_triggers.sql',
  sha256: '37877dc53acdb831f6845adc5eee7af51a3a1791d4a44a05af86f0a9ee172ca9',
});
export const bookingReminderRecoveryRole = Object.freeze({
  name: 'barber_reminder_writer', superuser: false, inherit: false,
  createRole: false, createDatabase: false, login: false, replication: false,
  bypassRls: false, connectionLimit: -1, validUntil: null, config: null,
  memberships: [{ role: 'barber_reminder_writer', member: 'postgres',
    grantor: 'postgres', admin: false, inherit: false, set: true },
  // PostgreSQL 17 automatically gives a non-superuser role creator ADMIN,
  // without SET/INHERIT, recorded under the bootstrap superuser grantor.
  { role: 'barber_reminder_writer', member: 'postgres', grantor: 'supabase_admin',
    admin: true, inherit: false, set: false }],
  parameters: [],
});
// Fixed-name catalog metadata only; no pg_authid or password hashes.
export const bookingReminderRoleQuery = recoveryRoleQuery.replaceAll('supabase_realtime_admin', 'barber_reminder_writer')
  .replace('ORDER BY granted.rolname, member.rolname', 'ORDER BY granted.rolname, member.rolname, grantor.rolname');
export function validateBookingReminderRole(metadata, candidate) {
  const migration = candidate.migrations.find(item => item.file === BOOKING_REMINDER_MIGRATION.file);
  if (migration) {
    assert.equal(migration.sha256, BOOKING_REMINDER_MIGRATION.sha256);
    assert.deepEqual(metadata, bookingReminderRecoveryRole, 'Unreviewed reminder recovery role');
    return metadata;
  }
  assert.ok(metadata === null || metadata === undefined, 'Role without its reviewed migration');
  return null;
}
export function restoreBookingReminderRoleSql(metadata, candidate) {
  if (!validateBookingReminderRole(metadata, candidate)) return '';
  // Run as postgres, only in a fresh labelled target where this role is absent.
  // The database dump restores the schema/column/function ACLs afterward.
  return 'CREATE ROLE barber_reminder_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;\nGRANT barber_reminder_writer TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;';
}
