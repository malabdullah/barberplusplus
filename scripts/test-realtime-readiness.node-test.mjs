import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForTestWebsocket } from './test-realtime-readiness.mjs';

test('fresh protocol waits for a real upgrade after transient startup failures', async () => {
  let time = 0; const statuses = [503, 'transport-error', 101]; let attempts = 0;
  await waitForTestWebsocket('synthetic-key', { now: () => time, sleep: async ms => { time += ms; }, probe: async () => { attempts++; return statuses.shift(); } });
  assert.equal(attempts, 3);
});
test('authentication and routing denials reject without retries', async () => {
  for (const status of [400, 401, 403, 404]) {
    let attempts = 0;
    await assert.rejects(waitForTestWebsocket('synthetic-key', { probe: async () => { attempts++; return status; } }));
    assert.equal(attempts, 1);
  }
});
test('unavailable protocol cannot manufacture readiness after the deadline', async () => {
  let time = 0;
  await assert.rejects(waitForTestWebsocket('synthetic-key', { now: () => time, sleep: async () => { time += 120000; }, probe: async () => 503 }));
  await assert.rejects(waitForTestWebsocket('secret\nnot-a-key'));
});
