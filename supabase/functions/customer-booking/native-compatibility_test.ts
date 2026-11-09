import { createCustomerBookingHandler } from './handler.ts';
import { bookingRPC, recoveredServiceNames } from './native-compatibility.ts';
const assert = (value: unknown) => { if (!value) throw Error('Assertion failed'); };
const secret = 'synthetic-native-backend-test-key-over-thirty-two-characters';
const origin = 'https://www.barberplusplus.com';
const request = (body: unknown) => new Request(origin, { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body) });
const config = { environment: 'production', productionEnabled: true, appUrl: origin, publicUrl: 'https://srv1073968.hstgr.cloud', secret,
  catalog: async () => ({}), booking: async () => ({}) };
async function proof(expires = Date.now() + 60_000) {
  const data = { purpose: 'verified', id: 'a0000000-0000-4000-8000-000000000001', name: 'QA', phone: '50009911', country_code: '+965', expires };
  const encode = (v: Uint8Array) => btoa(String.fromCharCode(...v)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const payload = encode(new TextEncoder().encode(JSON.stringify(data)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`customer-booking-test-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${payload}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))))}`;
}
Deno.test('native receipt recovery works on production and keeps original guest claim deadline', async () => {
  const created = Date.now() - 10 * 60_000;
  const handler = createCustomerBookingHandler({ ...config, recover: async () => ({ id: 'receipt', created_at: new Date(created).toISOString(), package: { name: 'Purchased package' } }) });
  const response = await handler(request({ action: 'recover-booking', verification: await proof() }));
  const body = await response.json();
  const payload = JSON.parse(atob(body.receipt.claimToken.split('.')[0].replaceAll('-', '+').replaceAll('_', '/')));
  assert(response.status === 200 && body.found && body.receipt.package.name === 'Purchased package');
  assert(payload.expires === created + 60 * 60_000 && !('created_at' in body.receipt));
});
Deno.test('recovery can show committed result after claim expires, without renewing claim', async () => {
  const handler = createCustomerBookingHandler({ ...config, recover: async () => ({ id: 'receipt', created_at: new Date(Date.now() - 2 * 3600_000).toISOString() }) });
  const response = await handler(request({ action: 'recover-booking', verification: await proof(Date.now() - 3600_000) }));
  const body = await response.json();
  assert(response.status === 200 && body.found && !('claimToken' in body.receipt));
});
Deno.test('forged and expired recovery capabilities cannot close attempts', async () => {
  let calls = 0;
  const handler = createCustomerBookingHandler({ ...config, close: async () => { calls++; return { found: false, closed: true }; } });
  for (const verification of ['forged', await proof(Date.now() - 25 * 3600_000)]) {
    assert((await handler(request({ action: 'resolve-booking', verification }))).status === 403);
  }
  assert(calls === 0);
});
Deno.test('resolve returns closed only for an absent booking, otherwise recovers receipt', async () => {
  let found = false;
  const handler = createCustomerBookingHandler({ ...config, close: async () => ({ found, closed: !found }),
    recover: async () => ({ id: 'receipt', created_at: new Date().toISOString() }) });
  const verification = await proof();
  let body = await (await handler(request({ action: 'resolve-booking', verification }))).json();
  assert(body.closed && !body.found);
  found = true;
  body = await (await handler(request({ action: 'resolve-booking', verification }))).json();
  assert(body.found && body.receipt.id === 'receipt');
});
Deno.test('purchased names stay authoritative and malformed snapshots fail closed', async () => {
  let lookups = 0;
  const lookup = async () => { lookups++; return [{ id: 's', name: 'Renamed service', name_ar: null }]; };
  const result = await recoveredServiceNames([{ name: 'Purchased name', name_ar: null }], ['s'], lookup);
  assert(result[0].name === 'Purchased name' && lookups === 0);
  try { await recoveredServiceNames([{ name: '' }], ['s'], lookup); throw Error('Expected rejection'); }
  catch (error) { assert((error as Error).message === 'Recovery unavailable'); }
  assert(lookups === 0);
});
Deno.test('only booking writes use the closure and canonical quote guard in every environment', () => {
  assert(bookingRPC('book') === 'native_customer_booking' && bookingRPC('slots') === 'customer_booking');
});
