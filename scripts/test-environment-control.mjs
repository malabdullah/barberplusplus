// Root-only fixed-purpose commands on srv1207055. No commands/URLs/paths accepted.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { observedTestRuntime, testInventory } from './test-environment-runtime.mjs';
import { TEST_STATE_ROOT, OPERATION_LOCK, protectedTestPath, readTestJson, saveTestJson, makeTestState, withTestOperation } from './test-environment-state.mjs';
import { candidateIdentity, assertTestOperation, validateTestCandidate, testCheckpointRequirement } from './test-environment-policy.mjs';

async function input() {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; assert.ok(size <= 65536); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks));
}
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
  const [operation, detail] = process.argv.slice(2);
  assert.ok(['--inventory', '--initialize', '--freeze', '--open', '--maintenance', '--end-maintenance', '--preflight', '--begin', '--complete'].includes(operation));
  assert.equal(process.argv.length, ['--maintenance', '--preflight', '--begin'].includes(operation) ? 4 : 3);
  if (operation === '--initialize') {
    assert.equal(existsSync(`${TEST_STATE_ROOT}/state.json`), false); assert.equal(existsSync(`${TEST_STATE_ROOT}/runtime.json`), false);
    assert.equal(existsSync(OPERATION_LOCK), false);
    if (existsSync(TEST_STATE_ROOT)) protectedTestPath(TEST_STATE_ROOT, true);
    const observed = observedTestRuntime();
    assert.ok(observed.originMatch && observed.syntheticOnly && observed.states.every(s => s.running && ['healthy', 'running'].includes(s.health) && !s.oom));
    if (!existsSync(TEST_STATE_ROOT)) mkdirSync(TEST_STATE_ROOT, { mode: 0o700 });
    saveTestJson('runtime.json', observed.candidate); saveTestJson('state.json', makeTestState(observed.candidate, 'open'));
    console.log(JSON.stringify({ initialized: true, candidateIdentity: observed.candidateIdentity, productionApproved: false }));
  } else if (operation === '--inventory') console.log(JSON.stringify(testInventory()));
  else if (['--preflight', '--begin'].includes(operation)) {
    const request = await input(); assert.deepEqual(Object.keys(request).sort(), ['candidate', 'checkpoint', 'requestedAt']);
    validateTestCandidate(request.candidate);
    assert.ok(['frontend', 'stateful', 'reset', 'maintenance'].includes(detail));
    const now = Date.now(); const requestedAt = Date.parse(request.requestedAt);
    assert.ok(now >= requestedAt && now - requestedAt <= 900000);
    const observed = testInventory(); assert.equal(existsSync(OPERATION_LOCK), false);
    assertTestOperation({ state: readTestJson('state.json'), candidate: request.candidate, operation: detail });
    const current = observed.candidate;
    if (detail === 'frontend') {
      assert.deepEqual(request.candidate.migrations, current.migrations);
      assert.deepEqual(Object.fromEntries(Object.entries(request.candidate.images).filter(([k]) => k !== 'frontend')),
        Object.fromEntries(Object.entries(current.images).filter(([k]) => k !== 'frontend')));
      for (const key of ['backend', 'bootstrap', 'nginx']) assert.equal(request.candidate.configuration[key], current.configuration[key]);
    }
    if (request.checkpoint) {
      assert.match(request.checkpoint.id, /^staging-\d{8}T\d{6}Z-[a-f0-9]{8}$/);
      const root = `/var/backups/barber-staging/export/${request.checkpoint.id}`;
      // Existing validated inventory interface owns the historical receipt schema.
      const { lstatSync } = await import('node:fs');
      for (const path of [root, `${root}/manifest.json`, `${root}/off-vps-receipt.json`]) {
        const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0);
      }
      const manifest = JSON.parse(readFileSync(`${root}/manifest.json`)); const receipt = JSON.parse(readFileSync(`${root}/off-vps-receipt.json`));
      assert.equal(manifest.id, request.checkpoint.id); assert.equal(receipt.sha256, manifest.sha256);
      assert.equal(receipt.bytes, manifest.bytes);
      request.checkpoint = { ...receipt, createdAt: manifest.createdAt };
    }
    const checkpoint = testCheckpointRequirement(detail, request.checkpoint, requestedAt, now);
    if (operation === '--begin') {
      mkdirSync(OPERATION_LOCK, { mode: 0o700 });
      writeFileSync(`${OPERATION_LOCK}/journal.json`, JSON.stringify({ version: 1, kind: 'test-operation', operation: detail,
        createdAt: new Date().toISOString(), states: [], beforeIdentity: candidateIdentity(current), candidate: request.candidate }), { flag: 'wx', mode: 0o600 });
      // Recheck after obtaining the same atomic lock used by capture/freeze.
      assertTestOperation({ state: readTestJson('state.json'), candidate: request.candidate, operation: detail });
    }
    console.log(JSON.stringify({ operation: detail, reserved: operation === '--begin', checkpoint, productionApproved: false }));
  } else if (operation === '--complete') {
    protectedTestPath(OPERATION_LOCK, true);
    const journal = JSON.parse(readFileSync(protectedTestPath(`${OPERATION_LOCK}/journal.json`)));
    assert.equal(journal.kind, 'test-operation'); assert.ok(['frontend', 'stateful', 'reset', 'maintenance'].includes(journal.operation));
    const observed = observedTestRuntime(); assert.equal(observed.candidateIdentity, candidateIdentity(journal.candidate));
    assert.ok(observed.originMatch && observed.syntheticOnly && observed.states.every(s => s.running && ['healthy', 'running'].includes(s.health) && !s.oom));
    saveTestJson('runtime.json', observed.candidate); saveTestJson('state.json', makeTestState(observed.candidate, 'open'));
    unlinkSync(`${OPERATION_LOCK}/journal.json`); rmdirSync(OPERATION_LOCK);
    console.log(JSON.stringify({ completed: true, acceptanceInvalidated: true, candidateIdentity: observed.candidateIdentity }));
  } else {
    const observed = testInventory();
    const action = operation === '--open' ? 'acceptance' : operation === '--freeze' ? 'acceptance' : 'maintenance';
    withTestOperation(observed.candidate, action, () => {
      if (operation === '--freeze' || operation === '--open') saveTestJson('state.json', makeTestState(observed.candidate, operation === '--freeze' ? 'frozen' : 'open'));
      else if (operation === '--maintenance') {
        assert.match(detail, /^[a-z][a-z0-9-]{0,63}$/); const now = Date.now();
        saveTestJson('maintenance.json', { schema: 'barber-test-maintenance/v1', owner: 'malabdullah', candidateIdentity: observed.candidateIdentity,
          startsAt: new Date(now).toISOString(), endsAt: new Date(now + 900000).toISOString(), reason: detail });
      } else if (existsSync(`${TEST_STATE_ROOT}/maintenance.json`)) unlinkSync(protectedTestPath(`${TEST_STATE_ROOT}/maintenance.json`));
    });
    console.log(JSON.stringify({ operation, candidateIdentity: observed.candidateIdentity, productionApproved: false }));
  }
} catch (error) {
  console.error('Test operation rejected; inspect the private state and operation lock.');
  const location = String(error?.stack || '').match(/test-environment-[a-z-]+\.mjs:\d+:\d+/)?.[0];
  if (location) console.error(`Sanitized check location: ${location}`);
  process.exitCode = 1;
}
