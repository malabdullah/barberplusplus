import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createCustomerCallbackServer } from './customer-oauth-callback.mjs';

async function fixture(t, upstream) {
  const calls = [];
  const server = createCustomerCallbackServer({ hostname: 'auth-test.example.test', request: async (...args) => {
    calls.push(args);
    return upstream ? upstream(...args) : new Response(null, { status: 302, headers: { location: 'http://localhost:5173/customer/auth-callback?code=pkce' } });
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const send = (path, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method: options.method || 'GET', headers: { host: 'auth-test.example.test', ...options.headers } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
  return { send, calls };
}

test('callback relay does not expose other API paths, hosts or methods', async t => {
  const { send, calls } = await fixture(t);
  for (const path of ['/auth/v1/admin/users', '/rest/v1/customers', '//auth/v1/callback', '/auth/v1/callback/../admin', '/auth/v1/callback%2fadmin', '/auth/v1/callback/']) assert.equal((await send(path)).status, 404);
  assert.equal((await send('/auth/v1/callback?state=s&code=c', { headers: { host: 'other.example.test' } })).status, 404);
  assert.equal((await send('/auth/v1/callback?state=s&code=c', { method: 'DELETE' })).status, 405);
  assert.equal((await send('/auth/v1/callback?code=c')).status, 400);
  assert.equal((await send('/auth/v1/callback?state=s&state=t&code=c')).status, 400);
  assert.equal(calls.length, 0);
});

test('callback relay accepts provider GET and Apple form POST without forwarding client credentials', async t => {
  const { send, calls } = await fixture(t);
  const get = await send('/auth/v1/callback?state=s&code=c', { headers: { cookie: 'private=secret', authorization: 'Bearer secret' } });
  assert.equal(get.status, 302);
  assert.equal(get.headers.location, 'http://localhost:5173/customer/auth-callback?code=pkce');
  assert.equal(get.headers['cache-control'], 'no-store');
  assert.equal(get.headers['referrer-policy'], 'no-referrer');
  const body = 'state=s&code=c&id_token=test-token&user=%7B%22name%22%3A%22Test%22%7D';
  assert.equal((await send('/auth/v1/callback', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://appleid.apple.com' }, body })).status, 302);
  assert.equal(calls[0][0], 'http://127.0.0.1:55321/auth/v1/callback?state=s&code=c');
  assert.equal(calls[0][1].headers.cookie, undefined);
  assert.equal(calls[0][1].headers.authorization, undefined);
  assert.equal(calls[1][1].body, body);
  assert.equal(calls[1][1].redirect, 'manual');
});

test('callback relay rejects oversized, unexpected and misdirected responses', async t => {
  const { send, calls } = await fixture(t, () => new Response(null, { status: 302, headers: { location: 'https://unrelated.example/steal' } }));
  assert.equal((await send('/auth/v1/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 415);
  assert.equal((await send('/auth/v1/callback?state=s&code=c', { headers: { origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await send('/auth/v1/callback', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `state=s&code=${'a'.repeat(32768)}` })).status, 413);
  assert.equal(calls.length, 0);
  assert.equal((await send('/auth/v1/callback?state=s&code=c')).status, 502);
});

test('upstream failures do not expose errors or credentials', async t => {
  const { send } = await fixture(t, () => { throw Error('private diagnostic'); });
  const response = await send('/auth/v1/callback?state=s&error=access_denied');
  assert.equal(response.status, 502);
  assert.equal(response.body.includes('private diagnostic'), false);
});
