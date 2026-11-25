import assert from 'node:assert/strict';
const assertEquals: typeof assert.deepEqual = assert.deepEqual;
const assertRejects = assert.rejects;
import { checkoutUrl, createHandler, fils, testSite } from './handler.ts';

const id = '11111111-1111-4111-8111-111111111111';
const invoice = '1234567';
const payment = '07071234567890123456';
function fixture(overrides: Record<string, unknown> = {}) {
  let captures = 0;
  let claimed = false;
  let attempt: any = { id, state: 'creating', createdAt: new Date().toISOString(),
    quote: { totalFils: 22500, paymentMethod: 'KNET' } };
  const calls: any[] = [];
  const provider = (action: string, _id: string, data: any) => {
    calls.push({ action, id: _id, data });
    if (action === 'claim-create') { if (claimed) return Promise.resolve(false); claimed = true; return Promise.resolve(true); }
    if (action === 'attach') attempt = { ...attempt, state: 'pending', checkoutUrl: data.checkoutUrl };
    if (action === 'inquire') return Promise.resolve({ sessionId: invoice });
    if (action === 'capture') { captures++; attempt = { ...attempt, state: 'paid' }; }
    return Promise.resolve(attempt);
  };
  const config: any = { token: 'sandbox-only', allowsStaff: () => Promise.resolve(true), provider,
    manager: () => Promise.resolve({ eligible: true, attempt }),
    fetcher: (url: string, options: any) => {
      calls.push({ url, options });
      return Promise.resolve(Response.json(options.method === 'POST'
        ? { IsSuccess: true, Data: { InvoiceId: invoice, PaymentURL: 'https://demo.myfatoorah.com/KWT/ie/demo' } }
        : { IsSuccess: true, Data: { Invoice: { Id: invoice, Status: 'PAID', ExternalIdentifier: id },
          Transaction: { Status: 'SUCCESS', PaymentId: payment }, Amount: { BaseCurrency: 'KWD', ValueInBaseCurrency: '22.500' } } }));
    }, ...overrides };
  const handler = createHandler(config);
  return { config, calls, get captures() { return captures; },
    send: (data: any) => handler(new Request(testSite + '/myfatoorah-subscription', {
      method: 'POST', headers: { authorization: 'Bearer test-token' },
      body: JSON.stringify({ businessId: id, ...data }),
    })) };
}

Deno.test('fils uses exact three-place KWD amounts', () => {
  assertEquals([fils('22.500'), fils('1.001'), fils('1.0001'), fils(-1), fils(null)], [22500, 1001, null, null, null]);
});
Deno.test('checkout rejects non-sandbox destinations and embedded credentials', async () => {
  for (const url of ['https://api.myfatoorah.com/pay', 'https://evil.test', 'https://x:y@demo.myfatoorah.com/']) {
    await assertRejects(async () => checkoutUrl(url));
  }
});
Deno.test('create uses pinned sandbox API, canonical amount and idempotency key', async () => {
  const f = fixture();
  assertEquals((await f.send({ action: 'start' })).status, 200);
  const call = f.calls.find(c => c.url);
  assertEquals(call.url, 'https://apitest.myfatoorah.com/v3/payments');
  const body = JSON.parse(call.options.body);
  assertEquals(body.Order, { Amount: 22.5, Currency: 'KWD', ExternalIdentifier: id });
  assertEquals(call.options.headers['Idempotency-Key'], 'barber-test-' + id);
  assertEquals(body.NotificationOption, 'LINK');
  assertEquals(f.captures, 0);
});
Deno.test('a duplicate create cannot issue a second checkout', async () => {
  const f = fixture();
  await f.send({ action: 'start' });
  await f.send({ action: 'start' });
  assertEquals(f.calls.filter(c => c.url && c.options.method === 'POST').length, 1);
});
Deno.test('check captures only API-verified invoice and exact amount', async () => {
  const f = fixture();
  await f.send({ action: 'start' });
  const result = await f.send({ action: 'check', paymentId: payment, attemptId: id });
  assertEquals(result.status, 200);
  assertEquals(f.captures, 1);
  assertEquals(f.calls.find(c => c.action === 'capture').data.totalFils, 22500);
});
for (const [label, change] of [
  ['invoice', (d: any) => { d.Invoice.Id = '999999'; }],
  ['reference', (d: any) => { d.Invoice.ExternalIdentifier = 'wrong'; }],
  ['currency', (d: any) => { d.Amount.BaseCurrency = 'USD'; }],
  ['amount', (d: any) => { d.Amount.ValueInBaseCurrency = '0.001'; }],
  ['payment', (d: any) => { d.Transaction.PaymentId = '123'; }],
] as const) {
  Deno.test('check rejects mismatched ' + label, async () => {
    const f = fixture();
    await f.send({ action: 'start' });
    const fetcher = f.config.fetcher;
    f.config.fetcher = async (...args: any[]) => {
      const result = await fetcher(...args); const body = await result.json(); change(body.Data); return Response.json(body);
    };
    assertEquals((await f.send({ action: 'check', paymentId: payment })).status, 503);
    assertEquals(f.captures, 0);
  });
}
Deno.test('declined card stays pending for a same-invoice retry', async () => {
  const f = fixture(); await f.send({ action: 'start' });
  const fetcher = f.config.fetcher;
  f.config.fetcher = async (...args: any[]) => {
    const result = await fetcher(...args); const body = await result.json();
    body.Data.Invoice.Status = 'PENDING'; body.Data.Transaction.Status = 'FAILED'; return Response.json(body);
  };
  assertEquals((await (await f.send({ action: 'check', paymentId: payment })).json()).attempt.state, 'pending');
  assertEquals(f.captures, 0);
});
Deno.test('return hints cannot authorize another attempt', async () => {
  const f = fixture(); await f.send({ action: 'start' });
  assertEquals((await f.send({ action: 'check', paymentId: payment, attemptId: 'other' })).status, 503);
  assertEquals(f.captures, 0);
});
Deno.test('gateway and bearer are both required', async () => {
  const f = fixture({ allowsStaff: () => Promise.resolve(false) });
  assertEquals((await f.send({ action: 'read' })).status, 403);
  const handler = createHandler(fixture().config);
  assertEquals((await handler(new Request(testSite + '/myfatoorah-subscription', { method: 'POST', body: '{}' }))).status, 401);
});

Deno.test('check can recover payment after the browser return was lost', async () => {
  const f = fixture(); await f.send({ action: 'start' });
  const fetcher = f.config.fetcher;
  f.config.fetcher = async (...args: any[]) => {
    const result = await fetcher(...args); const body = await result.json();
    if (String(args[0]).includes('/invoices/')) {
      body.Data.Transactions = [body.Data.Transaction]; delete body.Data.Transaction;
    }
    return Response.json(body);
  };
  assertEquals((await f.send({ action: 'check' })).status, 200);
  assertEquals(f.captures, 1);
  assertEquals(f.calls.filter(c => c.url?.includes('/payments/' + payment)).length, 1);
});
Deno.test('no transactions is pending, not paid or failed', async () => {
  const f = fixture(); await f.send({ action: 'start' });
  f.config.fetcher = () => Promise.resolve(Response.json({ IsSuccess: false, Message: 'No invoices match this InvoiceId' }));
  assertEquals((await (await f.send({ action: 'check' })).json()).attempt.state, 'pending');
  assertEquals(f.captures, 0);
});
Deno.test('expired invoice only closes after matching API evidence', async () => {
  const f = fixture(); await f.send({ action: 'start' });
  const fetcher = f.config.fetcher;
  f.config.fetcher = async (...args: any[]) => {
    const result = await fetcher(...args); const body = await result.json();
    body.Data.Invoice.Status = 'EXPIRED'; body.Data.Transactions = []; return Response.json(body);
  };
  await f.send({ action: 'check' });
  assertEquals(f.calls.some(c => c.action === 'failed'), true);
  assertEquals(f.captures, 0);
});

Deno.test('UPayments parity: simultaneous subscription starts create only one invoice',async()=>{
 const f=fixture();await Promise.all([f.send({action:'start'}),f.send({action:'start'})]);
 assertEquals(f.calls.filter(c=>c.options?.method==='POST').length,1);
});
Deno.test('UPayments parity: uncertain creation is held rather than charging again',async()=>{
 const f=fixture();let creates=0;f.config.fetcher=()=>{creates++;throw Error('simulated connection loss');};
 assertEquals((await f.send({action:'start'})).status,503);
 assertEquals((await f.send({action:'start'})).status,200);assertEquals(creates,1);assertEquals(f.captures,0);
});
Deno.test('UPayments parity: explicit create rejection does not issue paid capacity',async()=>{
 const f=fixture();f.config.fetcher=()=>Promise.resolve(Response.json({IsSuccess:false},{status:422}));
 await f.send({action:'start'});assertEquals(f.calls.some(c=>c.action==='create-rejected'),true);assertEquals(f.captures,0);
});
Deno.test('UPayments parity: capacity creation uses exact prorated fils and cannot outlive the term',async()=>{
 const f=fixture();const end=new Date(Date.now()+360000).toISOString();
 f.config.manager=()=>Promise.resolve({attempt:{id,state:'creating',createdAt:new Date().toISOString(),quote:{kind:'capacity',totalFils:5001,periodEnd:end,paymentMethod:'CARD'}}});
 assertEquals((await f.send({action:'start'})).status,200);
 const body=JSON.parse(f.calls.find(c=>c.url).options.body);
 assertEquals(body.Order.Amount,5.001);assertEquals(Date.parse(body.PaymentExpiry)<=Date.parse(end),true);
});
Deno.test('UPayments parity: a capacity term too close to expiry creates no invoice',async()=>{
 const f=fixture();f.config.manager=()=>Promise.resolve({attempt:{id,state:'creating',createdAt:new Date().toISOString(),quote:{kind:'capacity',totalFils:5001,periodEnd:new Date(Date.now()+30000).toISOString()}}});
 await f.send({action:'start'});assertEquals(f.calls.some(c=>c.url),false);assertEquals(f.calls.some(c=>c.action==='create-rejected'),true);
});
Deno.test('UPayments parity: cancelling a bank transaction keeps the subscription invoice retryable',async()=>{
 const f=fixture();await f.send({action:'start'});const original=f.config.fetcher;
 f.config.fetcher=async(...args:any[])=>{const r=await original(...args);const data=await r.json();data.Data.Invoice.Status='PENDING';data.Data.Transaction.Status='CANCELED';return Response.json(data);};
 const result=await(await f.send({action:'check',paymentId:payment})).json();
 assertEquals(result.attempt.state,'pending');assertEquals(result.attempt.paymentOutcome,'cancelled');assertEquals(f.captures,0);
 assertEquals(f.calls.some(c=>c.action==='failed'),false);
});
for(const status of ['INPROGRESS','AUTHORIZE']) Deno.test('MyFatoorah '+status+' cannot activate a subscription',async()=>{
 const f=fixture();await f.send({action:'start'});const original=f.config.fetcher;
 f.config.fetcher=async(...args:any[])=>{const r=await original(...args);const data=await r.json();data.Data.Invoice.Status='PENDING';data.Data.Transaction.Status=status;return Response.json(data);};
 assertEquals((await(await f.send({action:'check',paymentId:payment})).json()).attempt.state,'pending');assertEquals(f.captures,0);
});
for(const mode of ['network','http-error','invalid-json']) Deno.test('UPayments parity: subscription inquiry '+mode+' never fulfils',async()=>{
 const f=fixture();await f.send({action:'start'});
 f.config.fetcher=()=>{if(mode==='network')throw Error('simulated timeout');return Promise.resolve(mode==='invalid-json'?new Response('not JSON'):Response.json({IsSuccess:false},{status:503}));};
 assertEquals((await f.send({action:'check',paymentId:payment})).status,503);assertEquals(f.captures,0);
});
Deno.test('UPayments parity: unconfigured, invalid-method and forged webhook requests cannot fulfil',async()=>{
 const f=fixture({token:''});assertEquals((await f.send({action:'read'})).status,503);
 const g=fixture();const handler=createHandler(g.config);
 assertEquals((await handler(new Request(testSite+'/myfatoorah-subscription'))).status,405);
 assertEquals((await handler(new Request(testSite+'/myfatoorah-subscription/webhook',{method:'POST',body:'{"status":"paid"}'}))).status,403);
 assertEquals(g.captures,0);assertEquals(g.calls.length,0);
});
Deno.test('null or oversized subscription request bodies are invalid requests',async()=>{
 const f=fixture();const handler=createHandler(f.config);
 for(const raw of ['null','x'.repeat(9000)]) assertEquals((await handler(new Request(testSite+'/myfatoorah-subscription',{method:'POST',headers:{authorization:'Bearer test'},body:raw}))).status,400);
 assertEquals(f.captures,0);
});
