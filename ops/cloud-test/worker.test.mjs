import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const origin = 'https://test.example.com';
const env = {APP_URL:origin,SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',TEST_ACCESS_PASSWORD:'test-only-password',CLOUD_TEST_ACCESS_KEY:'gateway-test-only',ASSETS:{fetch:async request => {assert.equal(request.headers.get('authorization'),null);return new Response('asset');}}};
const login = () => new Request(origin,{headers:{authorization:`Basic ${btoa('tester:test-only-password')}`}});
test('application pages and assets fail closed before authentication', async () => {
  assert.equal((await worker.fetch(new Request(`${origin}/assets/app.js`),env)).status,401);
  assert.equal((await worker.fetch(login(),{...env,TEST_ACCESS_PASSWORD:''})).status,503);
  const response = await worker.fetch(login(),env);
  assert.equal(await response.text(),'asset');
  assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('gateway cookies cannot be used for cross-origin calls or arbitrary proxy paths', async () => {
  const response = await worker.fetch(login(),env);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await worker.fetch(new Request(`${origin}/test-api/customer-auth`,{method:'POST',headers:{cookie,origin:'https://other.example.com'}}),env)).status,403);
  assert.equal((await worker.fetch(new Request(`${origin}/test-api/../../auth`,{headers:{cookie}}),{...env,ASSETS:{fetch:async()=>new Response('asset')}})).status,200);
  assert.equal((await worker.fetch(new Request(`${origin}/test-api/unknown`,{headers:{cookie}}),env)).status,404);
  assert.equal((await worker.fetch(new Request('https://other.example.com/',{headers:{cookie}}),env)).status,404);
});
test('the private inbox renders HTML and forwards only gateway authentication', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url,`${env.SUPABASE_URL}/functions/v1/cloud-test-inbox`);
    assert.equal(options.headers.get('x-cloud-test-key'),env.CLOUD_TEST_ACCESS_KEY);
    assert.equal(options.headers.get('authorization'),null);
    return new Response('<h1>Test inbox</h1>',{headers:{'Content-Type':'text/plain','Content-Disposition':'attachment'}});
  };
  try {
    const response = await worker.fetch(new Request(`${origin}/test-inbox`,{headers:{authorization:login().headers.get('authorization')}}),env);
    assert.match(response.headers.get('content-type'),/^text\/html/);
    assert.equal(response.headers.get('content-disposition'),null);
    assert.equal(await response.text(),'<h1>Test inbox</h1>');
  } finally { globalThis.fetch = original; }
});

test('only exact installation branding is public, without forwarding or issuing credentials', async () => {
  const paths = ['/apple-touch-icon.png', '/apple-touch-icon-v2.png', '/icon-192.png', '/icon-512.png', '/site.webmanifest'];
  const assets = {fetch:async request => {
    assert.equal(request.headers.get('authorization'), null);
    assert.equal(request.headers.get('cookie'), null);
    const type = new URL(request.url).pathname.endsWith('.png') ? 'image/png' : 'application/manifest+json';
    return new Response(request.method === 'HEAD' ? null : 'branding', {headers:{'Content-Type':type,'Set-Cookie':'unexpected=1'}});
  }};
  for (const path of paths) {
    for (const method of ['GET', 'HEAD']) {
      const response = await worker.fetch(new Request(origin + path + '?v=2', {method,headers:{authorization:login().headers.get('authorization'),cookie:'private=1'}}), {...env,ASSETS:assets});
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('x-robots-tag'), /noindex/);
      if (method === 'HEAD') assert.equal(await response.text(), '');
    }
    assert.equal((await worker.fetch(new Request(origin + path), {...env,ASSETS:assets})).status, 200);
    assert.equal((await worker.fetch(new Request(origin + path, {method:'POST'}), {...env,ASSETS:assets})).status, 401);
  }
  for (const path of ['/', '/book', '/login', '/test-inbox?format=json', '/runtime-config.js', '/assets/app.js', '/test-api/customer-booking', '/apple-touch-icon-v2.png/../runtime-config.js', '/icons/other.png']) {
    assert.equal((await worker.fetch(new Request(origin + path), {...env,ASSETS:assets})).status, 401, path);
  }
  assert.equal((await worker.fetch(new Request('https://other.example.com/icon-192.png'), {...env,ASSETS:assets})).status, 404);
});

test('public installation paths reject missing files and SPA HTML fallbacks', async () => {
  for (const path of ['/apple-touch-icon-v2.png', '/site.webmanifest']) {
    for (const response of [new Response('private SPA', {headers:{'Content-Type':'text/html'}}), new Response('missing', {status:404})]) {
      const result = await worker.fetch(new Request(origin + path), {...env,ASSETS:{fetch:async()=>response}});
      assert.equal(result.status, 404);
      assert.equal(await result.text(), 'Branding asset unavailable.');
      assert.equal(result.headers.get('set-cookie'), null);
    }
  }
});
