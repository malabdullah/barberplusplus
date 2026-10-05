import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAcceptedRelease, getMigrationSet, verifyAcceptedRelease } from './release-manifest.mjs';

const commit = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;

async function migrationsFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'barber-release-manifest-'));
  const migrationsDir = path.join(root, 'migrations');
  await mkdir(migrationsDir);
  await writeFile(path.join(migrationsDir, '20260903090000_baseline.sql'), 'select 1;\n');
  await writeFile(path.join(migrationsDir, '20260903100000_expand.sql'), 'select 2;\n');
  return migrationsDir;
}

test('creates and verifies an accepted release with the complete migration set', async () => {
  const migrationsDir = await migrationsFixture();
  const manifest = await createAcceptedRelease({
    commit,
    digest,
    workflowRunId: '12345',
    acceptedAt: '2026-09-03T09:00:00.000Z',
    migrationsDir,
  });

  assert.equal(manifest.latest_migration, '20260903100000_expand');
  assert.equal(manifest.migrations.length, 2);
  assert.equal(await verifyAcceptedRelease(manifest, commit, migrationsDir, '12345'), digest);
});

test('rejects migration content changed after staging acceptance', async () => {
  const migrationsDir = await migrationsFixture();
  const manifest = await createAcceptedRelease({
    commit,
    digest,
    workflowRunId: '12345',
    acceptedAt: '2026-09-03T09:00:00.000Z',
    migrationsDir,
  });

  await writeFile(path.join(migrationsDir, '20260903100000_expand.sql'), 'select 3;\n');
  await assert.rejects(
    verifyAcceptedRelease(manifest, commit, migrationsDir),
    /migration set does not match/,
  );
});

test('rejects non-timestamped migration names', async () => {
  const migrationsDir = await migrationsFixture();
  await writeFile(path.join(migrationsDir, 'legacy.sql'), 'select 1;\n');
  await assert.rejects(getMigrationSet(migrationsDir), /not a timestamped regular SQL file/);
});

test('rejects a manifest copied from a different staging workflow run', async () => {
  const migrationsDir = await migrationsFixture();
  const manifest = await createAcceptedRelease({
    commit,
    digest,
    workflowRunId: '12345',
    acceptedAt: '2026-09-03T09:00:00.000Z',
    migrationsDir,
  });

  await assert.rejects(
    verifyAcceptedRelease(manifest, commit, migrationsDir, '67890'),
    /workflow run ID does not match/,
  );
});

