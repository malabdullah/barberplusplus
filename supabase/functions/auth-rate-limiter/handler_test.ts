import { createAuthRateLimiterHandler } from './handler.ts';

const appUrl = 'https://barber.test';
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Unexpected result');
}
const request = (body: unknown) => new Request(appUrl, { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Origin': appUrl }, body: JSON.stringify(body) });

Deno.test('rate limiter keeps server-selected settings and valid response shape', async () => {
  let called = false;
  const handler = createAuthRateLimiterHandler({ appUrl, checkLimit: async parameters => {
    called = true;
    equal(parameters, { p_identifier: 'login:synthetic@barber.test', p_max_attempts: 5,
      p_window_seconds: 60, p_lockout_seconds: 300 });
    return { data: { allowed: true, retryAfter: 0, remaining: 4, private: 'must not escape' }, error: null };
  } });
  const response = await handler(request({ action: 'login', identifier: ' Synthetic@barber.test ', maxAttempts: 999 }));
  equal(response.status, 200); equal(called, true);
  equal(await response.json(), { allowed: true, retryAfter: 0, remaining: 4 });
  equal(response.headers.get('cache-control'), 'no-store');
});

for (const mode of ['backend-error', 'throw', 'null', 'invalid-shape']) {
  Deno.test(`rate limiter fails closed on ${mode} without revealing backend details`, async () => {
    const handler = createAuthRateLimiterHandler({ appUrl, checkLimit: async () => {
      if (mode === 'throw') throw new Error('private-backend-detail');
      return { data: mode === 'invalid-shape' ? { allowed: true, remaining: -1, retryAfter: 0 } : null,
        error: mode === 'backend-error' ? { message: 'private-backend-detail' } : null };
    } });
    const response = await handler(request({ action: 'login', identifier: 'synthetic@barber.test' }));
    equal(response.status, 503); equal(response.headers.get('retry-after'), '60');
    equal(await response.json(), { error: 'Rate limit unavailable', allowed: false, retryAfter: 60, remaining: 0 });
  });
}

for (const body of [null, [], {}, { action: '__proto__', identifier: 'synthetic' },
  { action: 'constructor', identifier: 'synthetic' }, { action: 'unknown', identifier: 'synthetic' },
  { action: 'login', identifier: 42 }, { action: 'login', identifier: '' },
  { action: 'login', identifier: 'x'.repeat(321) }, { action: 'login', identifier: 'x\n' }]) {
  Deno.test(`rate limiter rejects invalid input ${JSON.stringify(body).slice(0, 65)}`, async () => {
    const handler = createAuthRateLimiterHandler({ appUrl, checkLimit: () => { throw new Error('Must not call backend'); } });
    equal((await handler(request(body))).status, 400);
  });
}

Deno.test('rate limiter keeps methods/CORS and refuses hostile origin', async () => {
  const handler = createAuthRateLimiterHandler({ appUrl, checkLimit: () => { throw new Error('Must not call backend'); } });
  equal((await handler(new Request(appUrl))).status, 405);
  equal((await handler(new Request(appUrl, { method: 'OPTIONS', headers: { Origin: appUrl } }))).status, 204);
  equal((await handler(new Request(appUrl, { method: 'OPTIONS', headers: { Origin: 'https://hostile.invalid' } }))).status, 403);
  equal((await handler(new Request(appUrl, { method: 'POST', body: '{' }))).status, 400);
});

Deno.test('rate limiter preserves genuine denial rather than converting it to allowance', async () => {
  const handler = createAuthRateLimiterHandler({ appUrl, checkLimit: async () => ({
    data: { allowed: false, retryAfter: 300, remaining: 0 }, error: null,
  }) });
  const response = await handler(request({ action: 'login', identifier: 'synthetic@barber.test' }));
  equal(response.status, 200); equal(await response.json(), { allowed: false, retryAfter: 300, remaining: 0 });
});
