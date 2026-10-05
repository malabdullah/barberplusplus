import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareLocalServicePins } from './prepare-local-service-pins.mjs';

function fixture(t, { cli = '2.116.0', major = 17 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'barber-local-pins-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'supabase'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { supabase: cli } }));
  writeFileSync(join(root, 'supabase/config.toml'), `[db]\nmajor_version = ${major}\n\n[auth]\nenabled = true\n`);
  return root;
}

test('sets the exact CLI-supported pin and is idempotent', (t) => {
  const root = fixture(t);
  assert.equal(prepareLocalServicePins(root), 'v16.4');
  assert.equal(prepareLocalServicePins(root), 'v16.4');
  assert.equal(readFileSync(join(root, 'supabase/.temp/rest-version'), 'utf8'), 'v16.4\n');
});

test('preserves conflicting user pins and unrelated local files', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'supabase/.temp'));
  writeFileSync(join(root, 'supabase/.temp/rest-version'), 'v16.1');
  writeFileSync(join(root, 'supabase/.temp/other'), 'preserve');
  assert.throws(() => prepareLocalServicePins(root), /differs/);
  assert.equal(readFileSync(join(root, 'supabase/.temp/rest-version'), 'utf8'), 'v16.1');
  assert.equal(readFileSync(join(root, 'supabase/.temp/other'), 'utf8'), 'preserve');
});

test('requires reviewed CLI and database versions', (t) => {
  assert.throws(() => prepareLocalServicePins(fixture(t, { cli: '2.117.0' })), /CLI pin/);
  assert.throws(() => prepareLocalServicePins(fixture(t, { major: 14 })), /PostgreSQL 17/);
});

test('refuses a symlinked temporary directory or REST pin', (t) => {
  const root = fixture(t);
  const destination = join(root, 'elsewhere');
  mkdirSync(destination);
  symlinkSync(destination, join(root, 'supabase/.temp'));
  assert.throws(() => prepareLocalServicePins(root), /symlink/);
  const second = fixture(t);
  mkdirSync(join(second, 'supabase/.temp'));
  writeFileSync(join(second, 'original'), 'v16.4');
  symlinkSync(join(second, 'original'), join(second, 'supabase/.temp/rest-version'));
  assert.throws(() => prepareLocalServicePins(second), /Unsafe/);
});
