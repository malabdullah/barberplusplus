import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { AUTH_ORIGIN, APP_ORIGIN } from './worker.js';
import { createAuthReturnWorker } from './core.js';
const id = '00000000-0000-4000-8000-000000000001';
test('Live helper contains all three actual Play distribution certificates', async () => {
  const [association] = await worker.fetch(new Request(AUTH_ORIGIN + '/.well-known/assetlinks.json')).json();
  assert.equal(association.target.package_name, 'com.barberplusplus.customer');
  assert.equal(association.target.sha256_cert_fingerprints.length, 3);
  assert.equal(new Set(association.target.sha256_cert_fingerprints).size, 3);
});
for (const path of [`/auth/email?requestId=${id}&state=${id}&delivery=${id}`, `/auth/oauth?state=${id}&code=${id}`, `/auth/oauth?state=${id}&error=access_denied`]) test('Live return is fixed and credential-free: ' + path.split('?')[0] + path.length, () => {
  const result = worker.fetch(new Request(AUTH_ORIGIN + path)); assert.equal(result.status, 307);
  assert(result.headers.get('location').startsWith(APP_ORIGIN)); assert(!result.headers.get('location').includes(id));
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer'); assert.equal(result.headers.get('cache-control'), 'no-store');
});
for (const path of ['/auth/oauth?state=bad&code=' + id, `/auth/oauth?state=${id}&code=${id}&access_token=secret`, `/auth/email?requestId=${id}&state=${id}&delivery=${id}&next=https://evil.test`, `/.well-known/assetlinks.json?package=attacker`, '/.well-known/apple-app-site-association']) test('Live rejects malformed or unsupported return ' + path, () => assert.equal(worker.fetch(new Request(AUTH_ORIGIN + path)).status, 404));
test('does not accept Test origins, packages or certificates as a Live binding', () => {
  assert.equal(worker.fetch(new Request('https://barber-auth-test.alabdullah-cs.workers.dev/auth/oauth?state=' + id + '&code=' + id)).status, 404);
  assert.throws(() => createAuthReturnWorker({ origin: AUTH_ORIGIN, appOrigin: APP_ORIGIN, packageName: 'com.barberplusplus.customer.test', fingerprints: [] }));
  assert.throws(() => createAuthReturnWorker({ origin: AUTH_ORIGIN, appOrigin: APP_ORIGIN, packageName: 'com.barberplusplus.customer', fingerprints: ['not-a-certificate'] }));
});
