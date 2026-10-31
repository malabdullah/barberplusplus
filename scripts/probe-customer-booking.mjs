import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { execFileSync } from 'node:child_process';
import { localDockerProbe } from './local-docker-probe.mjs';

const env = loadEnv('development', process.cwd(), 'VITE_');
assert.equal(env.VITE_SUPABASE_URL, 'http://127.0.0.1:55321', 'local Test only');
const url = env.VITE_SUPABASE_URL;
const headers = { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' };
async function request(action, data = {}) {
  const response = await fetch(`${url}/functions/v1/customer-booking`, { method: 'POST', headers, body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(20000) });
  return { status: response.status, data: await response.json() };
}
const client = createClient(url, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const denied = await client.rpc('customer_booking', { p_action: 'slots', p_data: {} });
assert.ok(denied.error, 'anonymous direct RPC denied');
const catalogue = await request('catalog');
assert.equal(catalogue.status, 200);
assert.ok(catalogue.data.branches.length >= 4);
assert.ok(catalogue.data.branches.every(branch => !('manager_id' in branch)));
assert.ok(catalogue.data.barbers.every(barber => !('phone' in barber) && !('email' in barber) && !('user_id' in barber)));
const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const selection = { branchId: '10000000-0000-4000-8000-000000000012', barberId: '30000000-0000-4000-8000-000000000121', serviceIds: ['20000000-0000-4000-8000-000000000121'], date };
const slots = await request('slots', selection);
assert.equal(slots.status, 200, JSON.stringify(slots.data));
assert.ok(slots.data.slots.length > 0);
assert.equal(slots.data.price, 5);
assert.equal(slots.data.duration, 30);
assert.equal((await request('slots', { ...selection, branchId: '10000000-0000-4000-8000-000000000013' })).status, 400);
assert.equal((await request('slots', { ...selection, serviceIds: ['20000000-0000-4000-8000-000000000123'] })).status, 400, 'unassigned service denied');
assert.equal((await request('book', { ...selection, time: slots.data.slots[0] })).status, 401);
execFileSync('node', ['scripts/local-test.mjs', 'status'], { stdio: 'pipe' });
const docker = localDockerProbe();
const sql = statement => docker(['exec', '-i', 'supabase_db_barber-local-test', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-U', 'supabase_admin', '-d', 'postgres'], { input: statement });
const phones = ['5' + String(Math.floor(Math.random() * 10000000)).padStart(7, '0'), '9' + String(Math.floor(Math.random() * 10000000)).padStart(7, '0')];
assert.equal(sql(`select count(*) from public.customers where phone in ('${phones[0]}','${phones[1]}')`), '0', 'probe phones must be new');
const ids = [];
try {
  const proofs = [];
  for (const phone of phones) {
    const proof = await request('guest-proof', { name: 'Customer Booking Probe', countryCode: '+965', phone });
    assert.equal(proof.status, 200);
    assert.equal('testCode' in proof.data, false);
    proofs.push(proof.data.verification);
  }
  const bookings = await Promise.all(proofs.map(verification => request('book', { ...selection, time: slots.data.slots[0], verification, price: 0, duration: 5 })));
  bookings.forEach(result => { if (result.data.id) ids.push(result.data.id); });
  assert.deepEqual(bookings.map(result => result.status).sort(), [200, 409], JSON.stringify(bookings));
  const winner = bookings.findIndex(result => result.status === 200);
  assert.equal(bookings[winner].data.price, 5);
  assert.equal(bookings[winner].data.duration, 30);
  const retry = await request('book', { ...selection, time: slots.data.slots[0], verification: proofs[winner] });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.id, bookings[winner].data.id, 'retry is idempotent');
  assert.match(retry.data.id, /^[0-9a-f-]{36}$/);
  const saved = JSON.parse(sql(`select row_to_json(b) from (select id,price,duration,status from public.bookings where id='${retry.data.id}') b`));
  assert.equal(saved.status, 'confirmed'); assert.equal(saved.price, 5);
  const visible = sql(`begin; set local role authenticated; select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-4000-8000-000000000002\",\"app_metadata\":{\"role\":\"manager\"}}',true); select count(*) from public.bookings where id='${retry.data.id}'; rollback;`);
  assert.ok(visible.includes('\n1\n'), 'owning manager sees confirmed booking');
  const after = await request('slots', selection);
  assert.ok(!after.data.slots.includes(slots.data.slots[0]), 'confirmed slot removed');
  const other = sql(`begin; set local role authenticated; select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-4000-8000-000000000002\",\"app_metadata\":{\"role\":\"manager\"}}',true); select count(*) from public.bookings where branch_id='10000000-0000-4000-8000-000000000002'; rollback;`);
  assert.ok(other.includes('\n0\n'), 'cross-tenant bookings remain private');
  console.log('CUSTOMER_BOOKING_PASS: catalogue privacy, assigned services, slots, direct guest confirmation, concurrent conflict, server prices, idempotency, manager visibility and tenant denial');
} finally {
  for (const id of ids) {
    assert.match(id, /^[0-9a-f-]{36}$/);
    sql(`delete from public.bookings where id='${id}';`);
  }
  sql(`delete from public.customers where name='Customer Booking Probe' and phone in ('${phones[0]}','${phones[1]}');`);
}
