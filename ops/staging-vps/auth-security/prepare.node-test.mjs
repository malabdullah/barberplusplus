import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyArchive, verifyAssets } from './prepare.mjs';

test('reviewed Auth assets match their checksums', () => verifyAssets());
test('wrong source archive is rejected before Docker or extraction', () => {
  assert.throws(() => verifyArchive(Buffer.from('not the approved source')), /checksum mismatch/);
});
test('modified build recipe is rejected', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'barber-auth-lock-negative-'));
  writeFileSync(join(scratch, 'Dockerfile'), `${readFileSync(new URL('./Dockerfile', import.meta.url))}\n# changed\n`);
  assert.throws(() => verifyAssets(scratch), /Unreviewed asset: Dockerfile/);
});
