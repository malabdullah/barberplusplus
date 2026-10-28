import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, automaticSql, REPOSITORY, WORKFLOW } from './protocol.mjs';
const commit = 'a'.repeat(40), hash = 'b'.repeat(64);
const valid = () => ({ schemaVersion: 1, repository: REPOSITORY, ref: 'refs/heads/main', workflow: WORKFLOW, commit, runId: '12', runAttempt: 1, frontendImage: `ghcr.io/${REPOSITORY}@sha256:${hash}`, backendFile: 'backend.tar.gz', backendSha256: hash, expectedSchemaSha256: hash, runtimeLockSha256: hash, compatibility: 'backward-compatible', migrations: [{ name: '20260901000000_baseline.sql', sha256: hash }] });
const expected = { commit, runId: '12', runAttempt: 1 };
test('accepts a bound immutable release', () => assert.equal(validateManifest(valid(), expected).commit, commit));
for (const [field, value] of Object.entries({ repository: 'other/repo', ref: 'refs/heads/dev', workflow: 'other.yml', commit: 'c'.repeat(40), runId: '13', runAttempt: 2, frontendImage: `ghcr.io/${REPOSITORY}:latest`, backendFile: '../../payload', backendSha256: 'bad', compatibility: 'destructive' })) {
  test(`rejects substituted ${field}`, () => assert.throws(() => validateManifest({ ...valid(), [field]: value }, expected)));
}
test('rejects duplicate/unsorted migration versions', () => { const m = valid(); m.migrations.push(m.migrations[0]); assert.throws(() => validateManifest(m, expected)); });
test('permits narrow additive SQL', () => { assert.ok(automaticSql('ALTER TABLE public.bookings ADD COLUMN extra_note text;')); assert.ok(automaticSql('CREATE INDEX booking_note_idx ON public.bookings(extra_note);')); });
for (const sql of ['DROP TABLE public.bookings;', 'ALTER TABLE public.bookings DROP COLUMN id;', 'ALTER TABLE public.bookings ADD COLUMN x text NOT NULL;', 'UPDATE public.bookings SET notes = null;', 'CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;', 'CREATE POLICY p ON public.bookings USING (true);', "CREATE TABLE x (a text DEFAULT 'DROP');"]) test('requires review for ' + sql.slice(0, 45), () => assert.equal(automaticSql(sql), false));
