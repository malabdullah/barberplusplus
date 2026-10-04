import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const FIXTURE_ACCOUNTS = Object.freeze([
  ['ADMIN', 'admin@barber.test'],
  ['MANAGER', 'manager@barber.test'],
  ['AGENT', 'agent@barber.test'],
  ['BARBER', 'barber@barber.test'],
  ['MANAGER_TWO', 'manager-two@barber.test'],
].map(([role, email]) => Object.freeze({ role, email })));

// Pure preparation only: no network, stdout, files, database connections or CLI.
// The caller must verify the target, baseline and quarantine before executing.
// SQL and passwords are sensitive; supply through stdin, never arguments/logs.
export function prepareStagingFixtures() {
  let sql = readFileSync(new URL('../ops/staging-vps/fixtures.sql.template', import.meta.url), 'utf8');
  const accounts = FIXTURE_ACCOUNTS.map(({ role, email }) => {
    const password = randomBytes(24).toString('hex');
    const placeholder = `{{PASSWORD_${role}}}`;
    assert.equal(sql.split(placeholder).length, 2, 'Fixture placeholder mismatch');
    sql = sql.replace(placeholder, password);
    return { email, password };
  });
  assert.ok(!sql.includes('{{') && !sql.includes('LocalOnly123!'), 'Unresolved or insecure fixture password');
  return { sql, accounts };
}
