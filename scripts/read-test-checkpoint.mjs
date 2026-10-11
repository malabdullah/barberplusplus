import assert from 'node:assert/strict';
import { BACKUP_LIMIT } from './staging-private-backup-format.mjs';
import { unpackStagingBackup } from './staging-live-backup-format.mjs';
import { unpackTestCheckpoint } from './test-checkpoint-format.mjs';

export function readTestOrHistoricalCheckpoint(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= BACKUP_LIMIT);
  const kind = JSON.parse(bytes).kind;
  return kind === 'barber-test-checkpoint/v3' ? unpackTestCheckpoint(bytes) : unpackStagingBackup(bytes);
}
