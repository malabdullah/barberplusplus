import { test } from 'node:test';
import assert from 'node:assert/strict';
import live, { HANDOFF_ORIGIN as LIVE } from './worker.js';
import cloud, { HANDOFF_ORIGIN as TEST } from '../cloud-test/booking-links/worker.js';
const id = 'af220000-0000-4000-8000-000000000003';
for (const [worker, origin, app] of [[live, LIVE, 'https://www.barberplusplus.com'], [cloud, TEST, 'https://barber-test.alabdullah-cs.workers.dev']]) {
  test(`${origin} signup uses only a fixed same-environment browser fallback`, () => {
    for (const method of ['GET', 'HEAD']) {
      const response = worker.fetch(new Request(`${origin}/auth/email?client=ios&state=${id}`, { method, headers: { cookie: 'synthetic', authorization: 'synthetic' } }));
      assert.equal(response.status, 307);
      assert.equal(response.headers.get('location'), `${app}/customer/email-callback?next=account&signup_fallback=ios`);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });
  test(`${origin} rejects mixed purposes, duplicate/extra fields and untrusted destinations`, () => {
    for (const suffix of ['', '/', '?client=android&state=' + id, '?client=ios&state=bad', `?client=ios&state=${id}&state=${id}`, `?client=ios&state=${id}&redirect_to=https://evil.test`, `?client=ios&state=${id}&request_id=${id}`, `?client=ios&state=${id}#token_hash=private`]) {
      assert.equal(worker.fetch(new Request(origin + '/auth/email' + suffix)).status, 404);
    }
    assert.equal(worker.fetch(new Request(`${origin}/auth/email?client=ios&state=${id}`, { method: 'POST' })).status, 405);
  });
}
