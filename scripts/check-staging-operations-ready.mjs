import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { requirePrivate } from './pull-staging-backup.mjs';

try {
  assert.equal(process.platform, 'darwin'); assert.equal(process.argv.length, 2);
  const root = '/Users/malabdullah/Library/Application Support/BarberStagingOperations';
  requirePrivate(root, true); requirePrivate(`${root}/status.json`);
  assert.equal(existsSync(`${root}/failure-notified.json`), false);
  const status = JSON.parse(readFileSync(`${root}/status.json`));
  assert.equal(status.version, 1);
  const age = Date.now() - Date.parse(status.checkedAt); assert.ok(age >= 0 && age <= 30 * 60000);
  assert.equal(status.releaseAllowed, true);
  console.log('Current staging operational readiness passed. A new release-specific backup and owner approval are still required.');
} catch { console.error('Staging operational readiness unavailable, failed or stale. Release blocked.'); process.exitCode = 1; }
