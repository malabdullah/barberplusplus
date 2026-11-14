import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('deletion successor preserves all released migrations and follows the reporting prefix', () => {
  const map = JSON.parse(readFileSync('ops/account-deletion/reports-migration-map.json', 'utf8'));
  const files = readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort();
  assert.equal(map.baselineMigrationCount, 108);
  assert.equal(map.preserveTestHistory, true);
  assert.equal(map.baselineMigrations.length, 108);
  assert.deepEqual(files.slice(0, 108), map.baselineMigrations.map(item => item.name));
  for (const item of [...map.baselineMigrations, ...map.mapping.map(item => ({ name: item.releaseName, sha256: item.sha256 }))]) {
    assert.equal(createHash('sha256').update(readFileSync('supabase/migrations/' + item.name)).digest('hex'), item.sha256, item.name);
  }
  assert.equal(map.mapping.length, 9);
  assert.deepEqual(files.slice(108, 117), map.mapping.map(item => item.releaseName));
  assert.equal(files.length, 118);
  assert.match(files.at(-1), /_customer_deletion_financial_privacy\.sql$/);
  assert.equal(new Set(files.map(name => name.slice(0, 14))).size, files.length);
});
