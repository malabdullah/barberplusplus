import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { FIXTURE_ACCOUNTS, prepareStagingFixtures } from './staging-fixtures.mjs';

test('five unique random credentials per run, all at the synthetic domain', () => {
  const runs = [prepareStagingFixtures(), prepareStagingFixtures()];
  const passwords = runs.flatMap((run) => run.accounts.map((account) => account.password));
  assert.equal(new Set(passwords).size, 10);
  for (const run of runs) {
    assert.equal(run.accounts.length, 5);
    for (const account of run.accounts) {
      assert.ok(/^[a-f0-9]{48}$/.test(account.password), 'Random password format');
      assert.ok(account.email.endsWith('@barber.test'));
      assert.ok(run.sql.includes(account.password), 'Credential inserted only in in-memory SQL');
    }
    assert.ok(!run.sql.includes('{{') && !run.sql.includes('LocalOnly123!'));
  }
});

test('separate staging template keeps atomic empty-target and cron gates', () => {
  const { sql } = prepareStagingFixtures();
  assert.ok(sql.includes('BEGIN;') && sql.trimEnd().endsWith('COMMIT;'));
  assert.ok(sql.indexOf('DO $guard$') < sql.indexOf('insert into auth.users'));
  for (const token of ['cron.launch_active_jobs', 'auth.users', 'vault.secrets',
    'storage.objects', 'storage.buckets', "schemaname = 'public'", 'has_rows']) {
    assert.ok(sql.includes(token), `Missing fixture gate: ${token}`);
  }
  assert.ok(!sql.includes("where email like '%@barber.test'"));
  assert.ok(!/\b(?:DROP|TRUNCATE|DELETE)\b/i.test(sql));
  assert.ok(!/'5000000[1-4]'/.test(sql), 'Do not use plausible real recipient numbers');
});

test('development seed remains unchanged and cannot be used by renderer', () => {
  const source = readFileSync(new URL('./staging-fixtures.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes('supabase/seed.sql'));
  const seed = readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8');
  assert.ok(seed.includes('must never be\n-- applied to staging or production'));
  assert.ok(seed.includes('LocalOnly123!'));
  assert.ok(Object.isFrozen(FIXTURE_ACCOUNTS));
});
