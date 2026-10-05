import assert from 'node:assert/strict';
import test from 'node:test';
import { stagingEnvoyCors, STAGING_BROWSER_ORIGIN } from './staging-envoy-cors.mjs';

test('staging policy has one fixed HTTPS browser origin, not an environment override', () => {
  assert.equal(STAGING_BROWSER_ORIGIN, 'https://staging-barber.malabdullah.cloud');
});

test('refuses unknown, modified, rendered or secret-bearing input without reflecting it', () => {
  for (const input of [null, undefined, {}, Buffer.from('synthetic-secret'), '', 'synthetic-secret', 'cors: allow-all']) {
    assert.throws(() => stagingEnvoyCors(input), (error) => error.message === 'Refusing unreviewed upstream gateway listener');
  }
});
