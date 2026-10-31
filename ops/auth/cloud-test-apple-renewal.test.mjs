import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import worker, { createCredential, renew, validateCredential } from '../cloud-test/apple-renewal.js';

const DAY = 86400;
const NOW = 1793466000;
const key = () => generateKeyPairSync('ec', { namedCurve: 'P-256', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
function fixture() {
  let state = null;
  let config = { external_apple_enabled: true, external_apple_client_id: 'com.barberplusplus.authentication.test.web', external_apple_secret: 'old-fingerprint', site_url: 'https://barber-test.alabdullah-cs.workers.dev', mailer_autoconfirm: false, external_google_secret: 'other-secret' };
  const calls = [];
  const env = { SUPABASE_PROJECT_REF: 'qvkucvcjmojjbphlzlks', APPLE_CLIENT_ID: config.external_apple_client_id, APPLE_KEY_ID: 'SPT3287JRA', APPLE_SIGNING_KEY: key(), SUPABASE_AUTH_CONFIG_TOKEN: 'sbp_fc_synthetic', RENEWAL_STATE: {
    async get() { return structuredClone(state); },
    async put(_key, value) { state = JSON.parse(value); },
  } };
  const request = async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, 'https://api.supabase.com/v1/projects/qvkucvcjmojjbphlzlks/config/auth');
    if (options.method === 'PATCH') {
      const payload = JSON.parse(options.body);
      assert.deepEqual(Object.keys(payload), ['external_apple_secret']);
      config.external_apple_secret = createHash('sha256').update(payload.external_apple_secret).digest('hex');
      return new Response(null, { status: 204 });
    }
    return Response.json(config);
  };
  return { env, request, calls, config, get state() { return state; }, set state(value) { state = value; } };
}

test('Test Apple JWT uses its own registration, a valid signature and 180-day lifetime', async () => {
  const pem = key();
  const result = await createCredential(pem, NOW);
  assert.equal(result.expiresAt, NOW + 180 * DAY);
  assert.equal((await validateCredential(result.jwt, pem)).sub, 'com.barberplusplus.authentication.test.web');
  await assert.rejects(validateCredential(result.jwt, key()), /signature/);
});
test('initial renewal updates only Test Apple secret and an ordinary check is a no-op', async () => {
  const f = fixture();
  assert.equal((await renew(f.env, { now: NOW, request: f.request })).status, 'renewed');
  assert.equal((await renew(f.env, { now: NOW + DAY, request: f.request })).status, 'not-due');
  assert.equal(f.calls.filter(c => c.options.method === 'PATCH').length, 1);
  assert.equal(f.config.mailer_autoconfirm, false);
  assert.equal(f.state.checkedAt, NOW + DAY);
});
test('renews exactly at the 30-day boundary', async () => {
  const f = fixture();
  await renew(f.env, { now: NOW, request: f.request });
  assert.equal((await renew(f.env, { now: NOW + 150 * DAY - 1, request: f.request })).status, 'not-due');
  assert.equal((await renew(f.env, { now: NOW + 150 * DAY, request: f.request })).status, 'renewed');
});
test('rejects production registration, broad legacy tokens and changed provider before writing', async () => {
  for (const replacement of [{ SUPABASE_PROJECT_REF: 'production' }, { APPLE_CLIENT_ID: 'com.barberplusplus.authentication.prod.web' }, { APPLE_KEY_ID: 'G2ANJ69763' }, { SUPABASE_AUTH_CONFIG_TOKEN: 'sbp_legacy' }]) {
    const f = fixture();
    await assert.rejects(renew({ ...f.env, ...replacement }, { now: NOW, request: f.request }));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.config.external_apple_enabled = false;
  await assert.rejects(renew(f.env, { now: NOW, request: f.request }));
  assert.equal(f.calls.length, 1);
});
test('recovers an accepted PATCH whose response timed out, with the exact journaled JWT', async () => {
  const f = fixture();
  await renew(f.env, { now: NOW, request: f.request });
  const request = async (url, options) => {
    const response = await f.request(url, options);
    if (options.method === 'PATCH') throw new Error('network timeout after acceptance');
    return response;
  };
  await assert.rejects(renew(f.env, { now: NOW + 150 * DAY, request }));
  const pending = f.state.pending.jwt;
  assert.equal((await renew(f.env, { now: NOW + 150 * DAY + 3600, request: f.request })).status, 'renewed');
  assert.equal(f.state.current.jwt, pending);
  assert.equal(f.state.pending, undefined);
});
test('detects external secret changes and unrelated configuration drift', async () => {
  const f = fixture();
  await renew(f.env, { now: NOW, request: f.request });
  f.config.external_apple_secret = 'externally-changed';
  await assert.rejects(renew(f.env, { now: NOW + DAY, request: f.request }), /outside the renewal job/);
  const g = fixture();
  const request = async (url, options) => {
    const result = await g.request(url, options);
    if (options.method === 'PATCH') g.config.mailer_autoconfirm = true;
    return result;
  };
  await assert.rejects(renew(g.env, { now: NOW, request }), /settings changed/);
  assert.ok(g.state.pending);
});
test('never logs upstream credentials/errors and exposes no HTTP trigger', async () => {
  const f = fixture();
  await assert.rejects(renew(f.env, { now: NOW, request: async () => new Response('secret-value', { status: 403 }) }), /^Error: Test Auth configuration GET failed \(403\)$/);
  assert.equal(worker.fetch().status, 404);
});
