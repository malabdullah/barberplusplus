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

Deno.test('guest receipt claims require a successful booking, signed receipt and matching live account', async () => {
  let phone = '50000099'; let active = true; let claims = 0; let claimedId = '';
  const handler = make({ customer: async (token: string) => active && token === 'live' ? { id: 'account', session_id: 'session', name: 'Customer', phone, countryCode: '+965' } : null,
    claim: async (data: Record<string, unknown>) => { claims++; claimedId = String(data.booking_id); assert(data.account_user_id === 'account' && data.session_id === 'session'); return { saved: true }; } });
  const authorized = (body: unknown) => { const r = request(body); const h = new Headers(r.headers); h.set('authorization', 'Bearer live'); return new Request(r, { headers: h }); };
  const proof = await (await handler(request({ action: 'guest-proof', name: 'Guest', phone, countryCode: '+965' }))).json();
  assert((await handler(authorized({ action: 'claim-booking', claimToken: proof.verification }))).status === 403);
  const receipt = await (await handler(request({ action: 'book', ...selection, verification: proof.verification }))).json();
  assert(typeof receipt.claimToken === 'string');
  assert((await handler(request({ action: 'claim-booking', claimToken: receipt.claimToken }))).status === 401);
  assert((await handler(authorized({ action: 'claim-booking', claimToken: receipt.claimToken + 'tampered' }))).status === 403);
  phone = '50000100';
  assert((await handler(authorized({ action: 'claim-booking', claimToken: receipt.claimToken }))).status === 403);
  assert(claims === 0);
  phone = '50000099';
  assert((await handler(authorized({ action: 'claim-booking', claimToken: receipt.claimToken, bookingId: selection.branchId }))).status === 200);
  assert(claims === 1 && claimedId === receipt.id);
  active = false;
  assert((await handler(authorized({ action: 'claim-booking', claimToken: receipt.claimToken }))).status === 401);
  active = true; const now = Date.now; Date.now = () => now() + 3600001;
  try { assert((await handler(authorized({ action: 'claim-booking', claimToken: receipt.claimToken }))).status === 403); } finally { Date.now = now; }
  assert(claims === 1);
});

Deno.test('hosted website requires Google proof while gated legacy native Test calls still work', async () => {
  const appUrl = 'https://app.example.test';
  const ref = 'abcdefghijklmnopqrst';
  const cloudAccessKey = 'test-gateway-secret-with-enough-characters';
  const details = { name: 'Guest Customer', phone: '50000099', countryCode: '+965' };
  const bookings: unknown[] = [];
  const handler = make({
    environment: 'cloud-test', appUrl, publicUrl: 'https://' + ref + '.supabase.co', cloudTestProjectRef: ref, cloudAccessKey,
    phone: { projectId: 'google-test', apiKey: 'public-key', appId: 'web', testPhones: ['+96550000099'] },
    startTestPhone: async (phone: string) => { assert(phone === '+96550000099'); return 'challenge'; },
    confirmPhone: async (session: string, code: string, phone: string) => session === 'challenge' && code === '123456' && phone === '+96550000099',
    booking: async (_: string, data: Record<string, unknown>) => { bookings.push(data.id); return { id: data.id }; },
  });
  const call = (body: unknown, web = true, gate = true) => handler(new Request(appUrl, {
    method: 'POST',
    headers: { Origin: appUrl, ...(gate ? { 'x-cloud-test-key': cloudAccessKey } : {}), ...(web ? { 'x-barber-test-web': '1' } : {}) },
    body: JSON.stringify(body),
  }));
  const config = await (await call({ action: 'phone-config' })).json();
  assert(config.phone.testPhones.length === 1 && !('apiKey' in config.phone));
  assert((await call({ action: 'phone-start', phone: '+96550000100' })).status === 400);
  assert((await call({ action: 'phone-start', phone: '+96550000099' }, true, false)).status === 403);
  assert((await call({ action: 'phone-start', phone: '+96550000099' }, false)).status === 404);
  const session = await (await call({ action: 'phone-start', phone: '+96550000099' })).json();
  assert(session.session === 'challenge');
  const legacy = await (await call({ action: 'guest-proof', ...details }, false)).json();
  assert(typeof legacy.verification === 'string');
  assert((await call({ action: 'guest-proof', ...details })).status === 428);
  assert((await call({ action: 'book', ...selection, verification: legacy.verification })).status === 428);
  const confirm = { action: 'phone-confirm', ...details, session: 'challenge', code: '123456' };
  assert((await call(confirm, true, false)).status === 403);
  assert((await call({ ...confirm, code: '654321' })).status === 400);
  assert((await call({ ...confirm, phone: '50000100' })).status === 400);
  for (let i = 0; i < 2; i++) {
    const proof = await (await call(confirm)).json();
    const result = await call({ action: 'book', ...selection, verification: proof.verification });
    assert(result.status === 200);
  }
  assert(bookings.length === 2 && bookings[0] === bookings[1]);
});

Deno.test('checkout persists only verified account numbers and rejects stale proofs', async () => {
  let phone = '';
  let verified = false;
  const handler = make({
    phone: { projectId: 'google-test', apiKey: 'public-key', appId: 'web' },
    customer: async () => ({ id: 'account', customerId: 'canonical', session_id: 'session', name: 'Account Customer', phone, countryCode: '+965' }),
    confirmPhone: async () => true,
    accountPhone: async (id: string, country: string, number: string, mark: boolean) => {
      assert(id === 'canonical' && country === '+965');
      if (mark) { phone = number; verified = true; }
      return verified && number === phone;
    },
  });
  const call = (body: unknown) => {
    const req = request(body);
    req.headers.set('Authorization', 'Bearer session');
    return handler(req);
  };
  assert((await call({ action: 'account-proof' })).status === 428);
  const confirm = { action: 'phone-confirm', phone: '50000099', countryCode: '+965', session: 'session-info', code: '123456' };
  assert((await call(confirm)).status === 200);
  const proof = await (await call({ action: 'account-proof' })).json();
  assert((await call({ action: 'book', ...selection, verification: proof.verification })).status === 200);
  phone = '50000100'; verified = false;
  assert((await call({ action: 'book', ...selection, verification: proof.verification })).status === 428);
  assert((await call(confirm)).status === 409);
  phone = '50000099';
  assert((await call({ action: 'account-proof' })).status === 428);
});

Deno.test('discovery validates ranges and pagination and derives identity from the live session', async () => {
  const identity = { id: '10000000-0000-4000-8000-000000000099', session_id: '20000000-0000-4000-8000-000000000099' };
  let received: Record<string,unknown> = {};
  const handler = make({ customer: async () => identity, discovery: async (_action: string, data: Record<string,unknown>) => { received=data; return {items:[]}; } });
  const input = {action:'discovery-search',mode:'time',date:'2026-11-09',rangeStart:'09:00',rangeEnd:'10:00',city:'Sharq'};
  assert((await handler(request(input))).status === 200);
  for (const patch of [{rangeEnd:'08:00'},{rangeStart:'25:00'},{query:'a'.repeat(121)},{cursor:[]},{barberId:'invalid'}]) {
    assert((await handler(request({...input,...patch}))).status === 400);
  }
  const req = request({...input,account_user_id:'forged',session_id:'forged'}); req.headers.set('Authorization','Bearer verified');
  const rejectedReq = req.clone();
  assert((await handler(req)).status === 200);
  assert(received.account_user_id === identity.id && received.session_id === identity.session_id);
  const invalid = make({customer:async()=>null, discovery:async()=>{throw Error('must not reach database');}});
  assert((await invalid(rejectedReq)).status === 401);
});

Deno.test('expired booking proofs recover only their own receipt and never write', async () => {
  const now = Date.now; const started = now(); let writes = 0; let recoveredID = '';
  const handler = make({
    booking: async () => { writes++; return {}; },
    recover: async (proof: {id: string}) => { recoveredID = proof.id; return { id: proof.id, reference: 'RECOVERED', created_at: new Date(started).toISOString() }; },
  });
  const signed = await (await handler(request({action:'guest-proof',name:'Guest',countryCode:'+965',phone:'50000099'}))).json();
  try {
    Date.now = () => started + 11 * 60_000;
    assert((await handler(request({action:'book',...selection,verification:signed.verification}))).status === 401);
    const response = await handler(request({action:'recover-booking',verification:signed.verification,bookingId:'untrusted-id'}));
    const value = await response.json();
    assert(response.status === 200 && value.found && value.receipt.id === recoveredID);
    assert(typeof value.receipt.claimToken === 'string' && !('created_at' in value.receipt));
    assert(writes === 0);
    assert((await handler(request({action:'recover-booking',verification:signed.verification+'tampered'}))).status === 403);
    Date.now = () => started + 61 * 60_000;
    const late = await (await handler(request({action:'recover-booking',verification:signed.verification}))).json();
    assert(late.found && !late.receipt.claimToken, 'Recovery cannot extend the guest claim window');
    Date.now = () => started + 25 * 60 * 60_000;
    assert((await handler(request({action:'recover-booking',verification:signed.verification}))).status === 403);
  } finally { Date.now = now; }
});

Deno.test('account result recovery requires a live session for the same account', async () => {
  let identity = 'first'; let reads = 0;
  const handler = make({customer: async () => ({id:identity,session_id:'new-session',name:'Customer',phone:'50000099',countryCode:'+965'}),
    recover: async () => {reads++;return null;}});
  const authorized = (body: unknown) => {const r=request(body);r.headers.set('Authorization','Bearer live');return r;};
  const signed = await (await handler(authorized({action:'account-proof'}))).json();
  identity = 'other';
  assert((await handler(authorized({action:'recover-booking',verification:signed.verification}))).status === 401);
  assert(reads === 0);
  identity = 'first';
  const r = await handler(authorized({action:'recover-booking',verification:signed.verification}));
  assert(r.status === 200 && (await r.json()).found === false && reads === 1);
});

Deno.test('native price guards are optional for web clients and validated before booking', async () => {
  const handler = make({booking: async (_action: string, data: Record<string,unknown>) => {
    if (data.expected_price === '1') throw Error('PRICE_CHANGED');
    return {id:data.id};
  }});
  const p = await (await handler(request({action:'guest-proof',name:'Guest',countryCode:'+965',phone:'50000099'}))).json();
  const base = {action:'book',...selection,verification:p.verification};
  assert((await handler(request({...base,expectedPrice:'1',expectedDuration:'30'}))).status === 409);
  assert((await handler(request({...base,expectedPrice:'NaN',expectedDuration:'30'}))).status === 400);
  assert((await handler(request(base))).status === 200);
});

Deno.test('repeated successful guest responses keep the original receipt deadline', async () => {
  const createdAt = Date.now() - 20 * 60_000;
  const handler = make({ recover: async (proof: { id: string }) => ({ id: proof.id, created_at: new Date(createdAt).toISOString() }) });
  const proof = await (await handler(request({ action: 'guest-proof', name: 'Native Guest', phone: '55501234', countryCode: '+965' }))).json();
  const first = await (await handler(request({ action: 'book', ...selection, verification: proof.verification }))).json();
  const repeated = await (await handler(request({ action: 'book', ...selection, verification: proof.verification }))).json();
  const payload = (token: string) => JSON.parse(atob(token.split('.')[0].replaceAll('-', '+').replaceAll('_', '/')));
  assert(payload(first.claimToken).expires === createdAt + 60 * 60_000);
  assert(payload(repeated.claimToken).expires === payload(first.claimToken).expires);
});

Deno.test('resolution closes only the signed absent key and returns an existing receipt instead of closing it', async () => {
  let closed = '';
  let found = false;
  const handler = make({ close: async (id: string) => { closed = id; return { found, closed: !found }; },
    recover: async (proof: { id: string }) => ({ id: proof.id, reference: 'ORIGINAL', created_at: new Date().toISOString() }) });
  const proof = await (await handler(request({ action: 'guest-proof', name: 'Native Guest', phone: '55501234', countryCode: '+965' }))).json();
  const absent = await (await handler(request({ action: 'resolve-booking', ...proof, bookingId: 'attacker-choice' }))).json();
  assert(absent.closed === true && absent.found === false);
  const original = JSON.parse(atob(proof.verification.split('.')[0].replaceAll('-', '+').replaceAll('_', '/')));
  assert(closed === original.id);
  found = true;
  const committed = await (await handler(request({ action: 'resolve-booking', ...proof }))).json();
  assert(committed.found === true && committed.receipt.id === original.id && committed.receipt.claimToken);
  assert((await handler(request({ action: 'resolve-booking', verification: proof.verification + 'bad' }))).status === 403);
});

Deno.test('account resolution requires a live session for the original account and closed attempts have a stable error', async () => {
  let account = { id: 'account-a', session_id: 'session-a', name: 'Account', phone: '55501234', countryCode: '+965' };
  let calls = 0;
  const handler = make({ customer: async () => account, close: async () => { calls++; return { found: false, closed: true }; },
    booking: async () => { throw Error('P0001 ATTEMPT_CLOSED'); } });
  const auth = (body: unknown) => new Request('http://127.0.0.1:55321/functions/v1/customer-booking', { method: 'POST', headers: { Origin: 'http://localhost:5173', Authorization: 'Bearer live', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const proof = await (await handler(auth({ action: 'account-proof' }))).json();
  account = { ...account, id: 'different-account' };
  assert((await handler(auth({ action: 'resolve-booking', ...proof }))).status === 401 && calls === 0);
  account = { ...account, id: 'account-a', session_id: 'new-live-session' };
  assert((await handler(auth({ action: 'resolve-booking', ...proof }))).status === 200 && calls === 1);
  const guest = await (await handler(request({ action: 'guest-proof', name: 'Guest', phone: '55501234', countryCode: '+965' }))).json();
  const rejected = await handler(request({ action: 'book', ...selection, ...guest }));
  assert(rejected.status === 409 && (await rejected.json()).error === 'ATTEMPT_CLOSED');
});
