import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'npm:jose@6.2.10';
import { createGateway, functionPolicies } from './gateway.ts';

const secret = crypto.randomUUID() + crypto.randomUUID();
const config = { jwtSecret: secret, cronSecret: crypto.randomUUID(), metaAppSecret: crypto.randomUUID(), metaVerifyToken: crypto.randomUUID() };
const request = (name: string, init?: RequestInit) => new Request(`http://functions:9000/${name}`, init);
const dispatch = async (name: string) => new Response(name);
const gate = createGateway(config, dispatch);
const jwt = (key = secret, expiry = '1h', alg = 'HS256') => new SignJWT({ role: 'authenticated' })
  .setProtectedHeader({ alg }).setExpirationTime(expiry).sign(new TextEncoder().encode(key));

Deno.test('gateway inventory matches repository functions and explicit JWT exceptions', async () => {
  const root = new URL('../../../../supabase/', import.meta.url);
  const names = [];
  for await (const entry of Deno.readDir(new URL('functions/', root))) {
    if (entry.isDirectory && !entry.name.startsWith('_')) names.push(entry.name);
  }
  assert.deepEqual(names.sort(), Object.keys(functionPolicies).sort());
  const toml = await Deno.readTextFile(new URL('config.toml', root));
  const exceptions = [...toml.matchAll(/\[functions\.([^\]]+)\]\s*verify_jwt\s*=\s*false/g)].map((match) => match[1]);
  assert.deepEqual(exceptions.sort(), Object.entries(functionPolicies).filter(([, p]) => p !== 'jwt').map(([n]) => n).sort());
});

for (const name of ['main', '_shared', 'hello', 'whatsapp-webhook/', 'whatsapp-webhook/child', 'whatsapp-webhook-other', '%77hatsapp-webhook', 'whatsapp-flow-endpoint/child']) {
  Deno.test(`gateway rejects unknown or non-exact path: ${name}`, async () => {
    assert.equal((await gate(request(name))).status, 404);
  });
}

Deno.test('JWT functions fail closed and accept only valid signed unexpired tokens', async () => {
  for (const token of ['', 'sb_publishable_fixture', 'invalid.jwt.fixture', await jwt(crypto.randomUUID().repeat(2)), await jwt(secret, '-1h'), await jwt(secret, '1h', 'HS384')]) {
    assert.equal((await gate(request('invite-barber', { headers: { authorization: `Bearer ${token}` } }))).status, 401);
  }
  assert.equal((await gate(request('invite-barber', { headers: { authorization: `Bearer ${await jwt()}` } }))).status, 200);
});

for (const alg of ['ES256', 'RS256']) {
  Deno.test(`gateway verifies ${alg} against only the configured staging JWKS`, async () => {
    const keys = await generateKeyPair(alg);
    const pub = await exportJWK(keys.publicKey);
    const asymmetric = createGateway({ jwks: JSON.stringify({ keys: [{ ...pub, kid: 'test-key', alg }] }) }, dispatch);
    const token = await new SignJWT({ role: 'authenticated' }).setExpirationTime('1h').setProtectedHeader({ alg, kid: 'test-key' }).sign(keys.privateKey);
    assert.equal((await asymmetric(request('invite-barber', { headers: { authorization: `Bearer ${token}` } }))).status, 200);
    assert.equal((await gate(request('invite-barber', { headers: { authorization: `Bearer ${token}` } }))).status, 401);
  });
}

Deno.test('missing JWT configuration and malformed JWKS cannot disable verification', async () => {
  const closed = createGateway({}, dispatch);
  assert.equal((await closed(request('invite-barber', { headers: { authorization: `Bearer ${await jwt()}` } }))).status, 401);
  assert.throws(() => createGateway({ jwks: 'invalid' }, dispatch));
  const noExpiry = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(secret));
  assert.equal((await gate(request('invite-barber', { headers: { authorization: `Bearer ${noExpiry}` } }))).status, 401);
});

Deno.test('cron endpoints require POST and the dedicated secret, not a JWT', async () => {
  for (const name of ['send-booking-reminders', 'cleanup-notifications']) {
    assert.equal((await gate(request(name))).status, 405);
    assert.equal((await gate(request(name, { method: 'POST', headers: { authorization: `Bearer ${await jwt()}` } }))).status, 401);
    assert.equal((await gate(request(name, { method: 'POST', headers: { 'x-cron-secret': config.cronSecret } }))).status, 200);
    assert.equal((await createGateway({}, dispatch)(request(name, { method: 'POST' }))).status, 401);
  }
});

async function signed(body: string, key: string = config.metaAppSecret) {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(body)));
  return `sha256=${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

Deno.test('both Meta POST endpoints require a signature over the exact body', async () => {
  const body = '{"encrypted_flow_data":"synthetic"}';
  for (const name of ['whatsapp-webhook', 'whatsapp-flow-endpoint']) {
    for (const signature of ['', 'sha256=bad', await signed(body, 'wrong-test-key'), await signed(body + ' ')]) {
      assert.equal((await gate(request(name, { method: 'POST', body, headers: { 'x-hub-signature-256': signature } }))).status, 401);
    }
    const echo = createGateway(config, async (_, req) => new Response(await req.text()));
    const response = await echo(request(name, { method: 'POST', body, headers: { 'x-hub-signature-256': await signed(body) } }));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), body);
    assert.equal((await createGateway({}, dispatch)(request(name, { method: 'POST', body, headers: { 'x-hub-signature-256': await signed(body) } }))).status, 401);
  }
});

Deno.test('Meta payload size is bounded even without Content-Length', async () => {
  const body = 'x'.repeat(100 * 1024 + 1);
  assert.equal((await gate(request('whatsapp-flow-endpoint', { method: 'POST', body,
    headers: { 'x-hub-signature-256': await signed(body) } }))).status, 413);
});

Deno.test('authenticated Meta replacements preserve worker context; invalid signatures never copy it', async () => {
  const body = '{"synthetic":true}';
  const contexts = new WeakMap<Request, string>();
  let copies = 0;
  const withContext = createGateway(config, async (_, req) => {
    assert.equal(contexts.get(req), 'synthetic-runtime-tag');
    assert.equal(await req.text(), body);
    return new Response('ok');
  }, (original, replacement) => {
    copies++;
    assert.equal(original.bodyUsed, true);
    assert.equal(contexts.get(original), 'synthetic-runtime-tag');
    contexts.set(replacement, contexts.get(original)!);
  });
  for (const name of ['whatsapp-webhook', 'whatsapp-flow-endpoint']) {
    const req = request(name, { method: 'POST', body, headers: { 'x-hub-signature-256': await signed(body) } });
    contexts.set(req, 'synthetic-runtime-tag');
    assert.equal((await withContext(req)).status, 200);
    assert.equal((await withContext(request(name, { method: 'POST', body, headers: { 'x-hub-signature-256': await signed(body, 'wrong') } }))).status, 401);
  }
  assert.equal(copies, 2);
});

Deno.test('Meta challenge is fail closed; Flow GET remains disabled', async () => {
  assert.equal((await gate(request('whatsapp-webhook'))).status, 403);
  assert.equal((await gate(request(`whatsapp-webhook?hub.mode=subscribe&hub.verify_token=${config.metaVerifyToken}&hub.challenge=fixture`))).status, 200);
  assert.equal((await createGateway({}, dispatch)(request('whatsapp-webhook?hub.mode=subscribe'))).status, 403);
  assert.equal((await gate(request('whatsapp-flow-endpoint'))).status, 405);
});

Deno.test('preflight is restricted and never dispatches application code', async () => {
  const noDispatch = createGateway(config, async () => { throw new Error('Must not dispatch'); });
  assert.equal((await noDispatch(request('invite-barber', { method: 'OPTIONS', headers: { origin: 'https://staging-barber.malabdullah.cloud' } }))).status, 204);
  assert.equal((await noDispatch(request('invite-barber', { method: 'OPTIONS', headers: { origin: 'https://example.invalid' } }))).status, 403);
});

Deno.test('worker exceptions do not disclose secrets', async () => {
  const broken = createGateway(config, async () => { throw new Error(secret); });
  const response = await broken(request('invite-barber', { headers: { authorization: `Bearer ${await jwt()}` } }));
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes(secret));
});
