import { createCustomerBookingHandler } from './handler.ts';
const assert = (condition: unknown, message = 'Assertion failed') => { if (!condition) throw Error(message); };
const make = (overrides = {}) => createCustomerBookingHandler({ environment: 'test', appUrl: 'http://localhost:5173', publicUrl: 'http://127.0.0.1:55321', secret: 'local-test-secret-which-is-over-thirty-two-characters', catalog: async () => ({ branches: [] }), booking: async (_action, data) => ({ id: data.id, price: 5 }), ...overrides });
const request = (body: unknown, origin = 'http://localhost:5173') => new Request('http://127.0.0.1:55321/functions/v1/customer-booking', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const selection = { branchId: '10000000-0000-4000-8000-000000000011', barberId: '30000000-0000-4000-8000-000000000111', serviceIds: ['20000000-0000-4000-8000-000000000111'], date: '2026-11-01', time: '10:00' };

Deno.test('booking rejects a phone owned by staff or a shop with a stable contact error', async () => {
  const handler=make({booking:async()=>{throw Error('23505 PHONE_IN_USE');}});
  const response=await handler(request({action:'slots',...selection}));
  assert(response.status===409);assert(JSON.stringify(await response.json())===JSON.stringify({error:'PHONE_IN_USE'}));
});

Deno.test('public statistics project only nonnegative counts and keep origin protection', async () => {
  const handler = make({ statistics: async () => ({shops:0,monthlyBookings:18,barbers:9,privateRows:['not public']}) });
  const response = await handler(request({action:'statistics'}));
  assert(response.status === 200);
  assert(JSON.stringify(await response.json()) === JSON.stringify({shops:0,monthlyBookings:18,barbers:9}));
  assert((await handler(request({action:'statistics'},'https://foreign.example'))).status === 403);
});
Deno.test('failed or invalid statistics never fabricate zero counts or expose errors', async () => {
  for (const statistics of [async () => {throw Error('private database details');}, async () => ({shops:-1,monthlyBookings:0,barbers:0})]) {
    const response = await make({statistics})(request({action:'statistics'}));
    assert(response.status === 503);
    assert(JSON.stringify(await response.json()) === JSON.stringify({error:'UNAVAILABLE'}));
  }
});

Deno.test('customer booking is disabled in production and for nonlocal backends', async () => {
  for (const config of [{ environment: 'production' }, { publicUrl: 'https://backend.example.test' }, { appUrl: '' }, { publicUrl: '' }]) {
    assert((await make(config)(request({ action: 'catalog' }))).status === 404);
  }
});
Deno.test('customer booking rejects foreign origins, invalid requests, and oversized bodies', async () => {
  const handler = make();
  assert((await handler(request({ action: 'catalog' }, 'https://foreign.example.test'))).status === 403);
  assert((await handler(request({ action: 'book', ...selection, serviceIds: ['bad'] }))).status === 400);
  assert((await handler(request({ action: 'catalog', padding: 'a'.repeat(9000) }))).status === 413);
});
Deno.test('activated production supports guest details proof without exposing the Test phone-code simulator', async () => {
  const handler = make({ environment: 'production', productionEnabled: true, appUrl: 'https://shop.example.test', publicUrl: 'https://auth.example.test' });
  const proof = await handler(request({ action: 'guest-proof', name: 'Customer', phone: '50000099', countryCode: '+965' }, 'https://shop.example.test'));
  assert(proof.status === 200);
  const body = await proof.json();
  assert(typeof body.verification === 'string' && !('testCode' in body));
  for (const action of ['request-code', 'verify-code']) assert((await handler(request({ action }, 'https://shop.example.test'))).status === 404);
  assert((await handler(request({ action: 'catalog' }, 'http://localhost:5173'))).status === 403);
});
Deno.test('verification binds the booking to the verified name and phone, never client prices', async () => {
  let received: Record<string, unknown> = {};
  const handler = make({ booking: async (_action: string, data: Record<string, unknown>) => { received = data; return { id: data.id }; } });
  assert((await handler(request({ action: 'book', ...selection }))).status === 401);
  const challenge = await (await handler(request({ action: 'request-code', name: 'Test Customer', countryCode: '+965', phone: '50000099' }))).json();
  assert(typeof challenge.testCode === 'string');
  assert((await handler(request({ action: 'verify-code', challenge: challenge.challenge, code: '000000' }))).status === 400);
  const proof = await (await handler(request({ action: 'verify-code', challenge: challenge.challenge, code: challenge.testCode }))).json();
  assert((await handler(request({ action: 'book', ...selection, verification: proof.verification + 'tampered' }))).status === 401);
  assert((await handler(request({ action: 'book', ...selection, verification: proof.verification, phone: '99999999', name: 'Forged', price: 0, duration: 5 }))).status === 200);
  assert(received.phone === '50000099' && received.name === 'Test Customer');
  assert(!('price' in received) && !('duration' in received));
});
Deno.test('slot conflicts get a recoverable response', async () => {
  const handler = make({ booking: async () => { throw Error('23P01 overlapping appointments'); } });
  assert((await handler(request({ action: 'slots', ...selection }))).status === 409);
});

const verifiedRequest = async (handler: ReturnType<typeof make>) => {
  const challenge = await (await handler(request({ action: 'request-code', name: 'Test Customer', countryCode: '+965', phone: '50000099' }))).json();
  const proof = await (await handler(request({ action: 'verify-code', challenge: challenge.challenge, code: challenge.testCode }))).json();
  return () => request({ action: 'book', ...selection, verification: proof.verification });
};
for (const code of ['40P01', '40001']) {
  Deno.test(`rolled-back ${code} booking retries once with the same verified identity`, async () => {
    const attempts: string[] = [];
    const handler = make({ booking: async (_action: string, data: Record<string, unknown>) => {
      attempts.push(JSON.stringify(data));
      if (attempts.length === 1) throw Error(`${code} transaction aborted`);
      return { id: data.id };
    } });
    const book = await verifiedRequest(handler);
    const response = await handler(book());
    assert(response.status === 200);
    assert(attempts.length === 2 && attempts[0] === attempts[1]);
  });
}
Deno.test('a conflict after transaction retry follows normal slot recovery', async () => {
  let attempts = 0;
  const handler = make({ booking: async () => { attempts++; throw Error(attempts === 1 ? '40P01 deadlock detected' : '23P01 overlapping appointments'); } });
  const book = await verifiedRequest(handler);
  const response = await handler(book());
  assert(response.status === 409 && attempts === 2);
  assert((await response.json()).error === 'SLOT_UNAVAILABLE');
});
Deno.test('persistent rollback is bounded and unrelated errors never replay a booking', async () => {
  for (const code of ['40P01', 'UNAVAILABLE']) {
    let attempts = 0;
    const handler = make({ booking: async () => { attempts++; throw Error(code); } });
    const book = await verifiedRequest(handler);
    assert((await handler(book())).status === 503);
    assert(attempts === (code === '40P01' ? 2 : 1));
  }
});
Deno.test('account booking uses live customer identity and rejects proofs after session revocation', async () => {
  let active = true; let writes = 0;
  const handler = make({ customer: async (token: string) => active && token === 'customer-token' ? {id:'customer',session_id:'session',name:'Account Name',phone:'50000099',countryCode:'+965'} : null,
    booking: async (_action: string, data: Record<string,unknown>) => {writes++;assert(data.name==='Account Name' && data.phone==='50000099');assert(data.account_user_id==='customer' && data.session_id==='session');return {id:data.id};} });
  const authorized = (body: unknown) => { const original=request(body); const headers=new Headers(original.headers);headers.set('authorization','Bearer customer-token');return new Request(original,{headers}); };
  assert((await handler(request({action:'account-proof'}))).status===401);
  const proof=await(await handler(authorized({action:'account-proof'}))).json();
  assert((await handler(authorized({action:'book',...selection,verification:proof.verification,name:'Forged',phone:'99999999'}))).status===200);
  active=false;
  assert((await handler(authorized({action:'book',...selection,verification:proof.verification}))).status===401);
  assert(writes===1);
});

Deno.test('guest proof requires valid contact details and binds them without a code', async () => {
  let received: Record<string,unknown> = {};
  const handler=make({booking:async (_action:string,data:Record<string,unknown>)=>{received=data;return {id:data.id};}});
  assert((await handler(request({action:'guest-proof',name:'X',countryCode:'+965',phone:'50000099'}))).status===400);
  assert((await handler(request({action:'guest-proof',name:'Guest Name',countryCode:'+965',phone:'123'}))).status===400);
  const proof=await (await handler(request({action:'guest-proof',name:'Guest Name',countryCode:'+965',phone:'50000099'}))).json();
  assert(typeof proof.verification==='string' && !('testCode' in proof));
  assert((await handler(request({action:'book',...selection,verification:proof.verification,name:'Forged',phone:'99999999'}))).status===200);
  assert(received.name==='Guest Name' && received.phone==='50000099');
});
