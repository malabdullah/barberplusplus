// Exercises the real local Auth/session and account gateway with synthetic
// provider identities. It does not authenticate with Google or Apple servers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { localDockerProbe } from './local-docker-probe.mjs';
const env = loadEnv('development', process.cwd(), 'VITE_');
assert.equal(env.VITE_SUPABASE_URL, 'http://127.0.0.1:55321');
execFileSync('node', ['scripts/local-test.mjs', 'status'], { stdio: 'pipe' });
const docker = localDockerProbe();
const sql = text => docker(['exec', '-i', 'supabase_db_barber-local-test', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-U', 'supabase_admin', '-d', 'postgres'], { input: text });
const status = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
assert.equal(status.API_URL, env.VITE_SUPABASE_URL);
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const phone = `5${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
assert.equal(sql(`select count(*) from public.customers where phone='${phone}'`), '0');
assert.equal(sql(`select count(*) from auth.users where ltrim(phone,'+')='965${phone}'`), '0');
const users = [];
const clients = [];
async function call(action, data, token) {
  const response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/customer-auth`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(20000) });
  return { status: response.status, data: await response.json() };
}
async function identity(provider) {
  const email = `social-probe-${crypto.randomUUID()}@customer.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'SocialProbe123!', email_confirm: true, app_metadata: { role: 'customer' } });
  assert.ifError(error); const id = data.user.id; users.push(id); assert.match(id, /^[a-f0-9-]{36}$/);
  sql(`insert into auth.identities(user_id,provider,provider_id,identity_data,created_at,updated_at,last_sign_in_at) values('${id}','${provider}','${id}','{"sub":"${id}"}',now(),now(),now());`);
  const client = createClient(status.API_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  clients.push(client);
  const signedIn = await client.auth.signInWithPassword({ email, password: 'SocialProbe123!' });
  assert.ifError(signedIn.error);
  return { id, token: signedIn.data.session.access_token };
}
async function complete(user) {
  const missing = await call('email-ensure', {}, user.token);
  assert.equal(missing.status, 200); assert.equal(missing.data.profile.needsName, true);
  const result = await call('email-ensure', { name: 'Social Probe Customer' }, user.token);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.profile.phone, null);
  for (const action of ['social-code', 'social-complete']) assert.equal((await call(action, {}, user.token)).status, 404);
  return result.data.profile;
}
try {
  const google = await identity('google');
  const initialStatus = await call('social-status', {}, google.token);
  assert.equal(initialStatus.status, 200, JSON.stringify(initialStatus.data));
  assert.equal(initialStatus.data.profile, null);
  const first = await complete(google);
  assert.equal(first.id, google.id); assert.equal(first.name, 'Social Probe Customer');
  assert.equal((await call('social-status', {}, google.token)).data.profile.id, first.id);
  const apple = await identity('apple');
  const second = await complete(apple);
  assert.notEqual(second.id, first.id, 'separate provider identities keep separate accounts');
  for (const user of [google, apple]) {
    const updated = await call('update-profile', { name: 'Social Probe Customer', countryCode: '+965', phone, email: 'untrusted@customer.test' }, user.token);
    assert.equal(updated.status, user.id === google.id ? 200 : 409);
    if (user.id === google.id) {
      assert.equal(updated.data.profile.phone, phone);
      assert.notEqual(updated.data.profile.email, 'untrusted@customer.test');
    } else assert.equal(updated.data.error, 'PHONE_IN_USE');
    assert.deepEqual((await call('bookings', {}, user.token)).data.bookings, []);
  }
  assert.equal(sql(`select count(*) from private.customer_account_profiles where phone='${phone}'`), '1');
  assert.equal(sql(`select count(*) from public.customers where phone='${phone}'`), '1');
  assert.equal((await call('logout', {}, apple.token)).status, 200);
  assert.equal((await call('profile', {}, apple.token)).status, 401);
  assert.equal((await call('profile', {}, google.token)).status, 200);
  console.log('CUSTOMER_SOCIAL_GATEWAY_PASS: synthetic Google/Apple identities, missing-name completion, phone-optional accounts, duplicate-phone rejection, trusted email, private history and session-scoped logout. Provider OAuth not exercised.');
} finally {
  for (const client of clients) await client.auth.signOut({ scope: 'local' }).catch(() => {});
  for (const id of users.reverse()) { assert.match(id, /^[a-f0-9-]{36}$/); sql(`delete from auth.users where id='${id}' and raw_app_meta_data->>'role'='customer';`); }
  sql(`delete from public.customers where phone='${phone}';`);
}
