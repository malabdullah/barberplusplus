import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('production backup identity, recovery evidence and WAL continuity safety', () => {
  const result = spawnSync('python3', ['ops/backup/test_backup.py'], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
});

test('daily backups clean up on interruption and reject stale or misbound recovery evidence', () => {
  const result = spawnSync('python3', ['ops/backup/test_daily.py'], {
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
});
