import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { candidateIdentity, validateTestCandidate, validateTestState, assertTestOperation } from './test-environment-policy.mjs';

export const TEST_STATE_ROOT = '/opt/barber-staging-test-operations';
export const OPERATION_LOCK = '/var/backups/barber-staging/capture-in-progress';
export function protectedTestPath(path, directory = false) {
  assert.ok(path === TEST_STATE_ROOT || path.startsWith(`${TEST_STATE_ROOT}/`) || path === OPERATION_LOCK || path.startsWith(`${OPERATION_LOCK}/`));
  for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) {
    const stat = lstatSync(parent); assert.ok(!stat.isSymbolicLink() && stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o022) === 0);
  }
  const stat = lstatSync(path);
  assert.ok(!stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0);
  assert.ok(directory ? stat.isDirectory() : stat.isFile() && stat.size > 0 && stat.size <= 65536);
  return path;
}
export function readTestJson(name) {
  assert.ok(['state.json', 'maintenance.json', 'security.json', 'runtime.json'].includes(name));
  return JSON.parse(readFileSync(protectedTestPath(`${TEST_STATE_ROOT}/${name}`), 'utf8'));
}
export function saveTestJson(name, value) {
  assert.ok(['state.json', 'maintenance.json', 'security.json', 'runtime.json'].includes(name));
  protectedTestPath(TEST_STATE_ROOT, true);
  const path = `${TEST_STATE_ROOT}/${name}`;
  if (existsSync(path)) protectedTestPath(path);
  const next = `${path}.next`;
  writeFileSync(next, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const fd = openSync(next, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(next, path);
}
export function makeTestState(candidate, mode, now = Date.now()) {
  validateTestCandidate(candidate);
  return validateTestState({ schema: 'barber-test-state/v1', owner: 'malabdullah', mode,
    createdAt: new Date(now).toISOString(), candidate, candidateIdentity: candidateIdentity(candidate) }, now);
}
export function assertUnfrozen(operation, candidate) {
  if (!existsSync(TEST_STATE_ROOT)) return; // Historical bootstrap, before Test installation.
  protectedTestPath(TEST_STATE_ROOT, true);
  const state = readTestJson('state.json');
  assertTestOperation({ state, candidate: candidate || state.candidate, operation });
}
export function withTestOperation(candidate, operation, callback) {
  assert.equal(existsSync(OPERATION_LOCK), false, 'Capture/maintenance lock requires investigation');
  // mkdir is the atomic arbitration point shared with the existing capture.
  mkdirSync(OPERATION_LOCK, { mode: 0o700 });
  const journal = `${OPERATION_LOCK}/journal.json`;
  let completed = false;
  try {
    writeFileSync(journal, JSON.stringify({ version: 1, kind: 'test-operation', operation,
      candidateIdentity: candidateIdentity(candidate), createdAt: new Date().toISOString(), states: [] }), { flag: 'wx', mode: 0o600 });
    assertUnfrozen(operation, candidate);
    const result = callback(); completed = true; return result;
  } finally {
    if (completed) { unlinkSync(journal); rmdirSync(OPERATION_LOCK); }
    // A rejected/interrupted operation retains its exact journal for review.
  }
}
