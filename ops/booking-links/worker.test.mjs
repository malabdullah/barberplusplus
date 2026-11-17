import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { HANDOFF_ORIGIN, BOOKING_ORIGIN } from './worker.js';
import testWorker, { HANDOFF_ORIGIN as TEST_HANDOFF, TEST_ORIGIN } from '../cloud-test/booking-links/worker.js';
const id = '10000000-0000-4000-8000-000000000011';
test('Live browser fallback uses only fixed production origin and public selection', () => {
  for (const kind of ['shop', 'barber']) for (const method of ['GET', 'HEAD']) {
    const response = worker.fetch(new Request(`${HANDOFF_ORIGIN}/book?${kind}=${id}`, { method, headers: { cookie: 'synthetic', authorization: 'synthetic' } }));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `${BOOKING_ORIGIN}/book?${kind}=${id}`);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
});
test('invalid selectors, ticket paths and Android association are never handled', () => {
  for (const path of ['/', '/book', '/book?shop=bad', `/book?shop=${id}&barber=${id}`, `/book?shop=${id}&shop=${id}`, `/book?shop=${id}&next=https://foreign.example`, `/book?shop=${id}#private`, '/booking/share', '/.well-known/assetlinks.json']) {
    assert.equal(worker.fetch(new Request(HANDOFF_ORIGIN + path)).status, 404);
  }
  assert.equal(worker.fetch(new Request(HANDOFF_ORIGIN + '/book?barber=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaA')).status, 404);
  assert.equal(worker.fetch(new Request(HANDOFF_ORIGIN + `/book?shop=${id}`, { method: 'POST' })).status, 405);
  assert.equal(worker.fetch(new Request('https://foreign.example/book?shop=' + id)).status, 404);
});
test('Live association is direct JSON with exact Live app and approved book/signup routes', async () => {
  const response = worker.fetch(new Request(HANDOFF_ORIGIN + '/.well-known/apple-app-site-association'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('set-cookie'), null);
  const data = await response.json();
  assert.deepEqual(data.applinks.details[0].appIDs, ['D49RFZQ6BT.com.barberplusplus.customer']);
  assert.deepEqual(data.applinks.details[0].components, [{ '/': '/book', '?': { shop: '*' } }, { '/': '/book', '?': { barber: '*' } }, { '/': '/auth/email', '?': { client: 'ios', state: '*' } }]);
  assert(!JSON.stringify(data).includes('.test'));
});
test('Live helper preserves accepted Test helper selector and fallback semantics', () => {
  for (const query of [`shop=${id}`, `barber=${id}`, `shop=${id}&barber=${id}`, 'shop=bad', `barber=${id}&next=bad`]) {
    const live = worker.fetch(new Request(HANDOFF_ORIGIN + '/book?' + query));
    const test = testWorker.fetch(new Request(TEST_HANDOFF + '/book?' + query));
    assert.equal(live.status, test.status);
    if (live.status === 307) assert.equal(live.headers.get('location').replace(BOOKING_ORIGIN, TEST_ORIGIN), test.headers.get('location'));
  }
});
