import assert from 'node:assert/strict';
import { myfatoorahBooking, bookingProviderRouter } from './myfatoorah.ts';
const id = '11111111-1111-4111-8111-111111111111';
const capability = '22222222-2222-4222-8222-222222222222';
const invoice = '1234567';
const payment = '07071234567890123456';
function fixture(change: { invoice?: any; detail?: any; url?: string; noTransactions?: boolean; declined?: boolean; expired?: boolean; cancelled?: boolean; transport?: (url: string, options: RequestInit | undefined, response: Response) => Promise<Response> } = {}) {
  let state = 'creating'; let claimed = false; let captures = 0;
  const calls: any[] = [];
  const view = () => ({ id, state, totalFils: 5000, holdUntil: new Date(Date.now() + 7 * 60000).toISOString() });
  const adapter = myfatoorahBooking({ token: 'test-only', rpc: async (action, _id, data) => {
    calls.push({ action, data });
    if (action === 'route') return true;
    if (action === 'start') return { ...view(), create: state === 'creating' };
    if (action === 'claim-create') { if (claimed) return false; claimed = true; return true; }
    if (action === 'attach') state = 'pending';
    if (action === 'read' && data.capability !== capability) return null;
    if (action === 'inquire') return { ...view(), sessionId: invoice };
    if (action === 'capture') { captures++; state = 'paid'; }
    if (action === 'failed') state = 'failed';
    return view();
  }, fetcher: async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(String(url)).origin, 'https://apitest.myfatoorah.com');
    if (options?.method === 'POST') { const response = Response.json({ IsSuccess: true, Data: { InvoiceId: invoice, PaymentURL: change.url || 'https://demo.myfatoorah.com/KWT/ie/demo' } }); return change.transport ? await change.transport(String(url), options, response) : response; }
    if (String(url).includes('/invoices/')) {
      if (change.noTransactions) return Response.json({ IsSuccess: false, Message: 'No invoices match this InvoiceId' });
      const response = Response.json({ IsSuccess: true, Data: {
        Invoice: { Id: invoice, ExternalIdentifier: id, Status: change.expired ? 'EXPIRED' : change.declined || change.cancelled ? 'PENDING' : 'PAID' },
        Amount: { BaseCurrency: 'KWD', ValueInBaseCurrency: '5.000' },
        Transactions: change.expired ? [] : [{ PaymentId: payment, Status: change.declined ? 'FAILED' : change.cancelled ? 'CANCELED' : 'SUCCESS' }], ...change.invoice,
      } }); return change.transport ? await change.transport(String(url), options, response) : response;
    }
    return Response.json({ IsSuccess: true, Data: {
      Invoice: { Id: invoice, ExternalIdentifier: id, Status: 'PAID' },
      Transaction: { PaymentId: payment, Status: 'SUCCESS' }, Amount: { BaseCurrency: 'KWD', ValueInBaseCurrency: '5.000' }, ...change.detail,
    } });
  } });
  return { adapter, calls, get captures() { return captures; } };
}
Deno.test('MyFatoorah booking creates one canonical KWD hosted invoice without customer/card details', async () => {
  const f = fixture();
  await f.adapter.start({ id, language: 'en', email: 'guest@example.test' }, capability);
  await f.adapter.start({ id }, capability);
  const creates = f.calls.filter(c => c.options?.method === 'POST');
  assert.equal(creates.length, 1);
  const body = JSON.parse(creates[0].options.body);
  assert.deepEqual(body.Order, { Amount: 5, Currency: 'KWD', ExternalIdentifier: id });
  assert.deepEqual(body.DisplayPaymentMethods, ['knet', 'card']);
  assert.equal(body.Customer, undefined);
  assert.equal(body.IntegrationUrls.Redirection, 'https://barber-test.alabdullah-cs.workers.dev/book?payment=return');
  assert.equal(creates[0].options.headers['Idempotency-Key'], 'barber-test-booking-' + id);
  assert.equal(f.captures, 0);
});
Deno.test('stored invoice and verified payment confirm once without any browser payment hint', async () => {
  const f = fixture(); await f.adapter.start({ id }, capability);
  assert.equal(await f.adapter.check(id), null);
  assert.equal((await f.adapter.check(capability)).state, 'paid');
  await f.adapter.check(capability); assert.equal(f.captures, 1);
});
for (const change of [
  { invoice: { Invoice: { Id: '999', ExternalIdentifier: id } } },
  { invoice: { Amount: { BaseCurrency: 'USD', ValueInBaseCurrency: '5.000' } } },
  { detail: { Invoice: { Id: invoice, ExternalIdentifier: capability, Status: 'PAID' } } },
  { detail: { Amount: { BaseCurrency: 'KWD', ValueInBaseCurrency: '4.999' } } },
  { detail: { Transaction: { PaymentId: payment, Status: 'FAILED' } } },
]) Deno.test('MyFatoorah booking rejects mismatched invoice/payment evidence ' + JSON.stringify(change), async () => {
  const f = fixture(change); await f.adapter.start({ id }, capability);
  await assert.rejects(() => f.adapter.check(capability)); assert.equal(f.captures, 0);
});
Deno.test('declined card remains retryable on the same invoice, while terminal expiry fails', async () => {
  const f = fixture({ declined: true }); await f.adapter.start({ id }, capability);
  assert.equal((await f.adapter.check(capability)).retryableFailure, true);
  assert.equal(f.captures, 0);
  const expired = fixture({ expired: true }); await expired.adapter.start({ id }, capability);
  assert.equal((await expired.adapter.check(capability)).state, 'failed');
});
Deno.test('unopened invoice is pending and a foreign checkout origin is refused', async () => {
  const f = fixture({ noTransactions: true }); await f.adapter.start({ id }, capability);
  assert.equal((await f.adapter.check(capability)).state, 'pending');
  const bad = fixture({ url: 'https://evil.example/pay' });
  await assert.rejects(() => bad.adapter.start({ id }, capability));
});
Deno.test('MyFatoorah adapter refuses wallet funds and native checkout', async () => {
  const f = fixture();
  await assert.rejects(() => f.adapter.start({ id }, capability, 1));
  await assert.rejects(() => f.adapter.start({ id }, capability, 0, true));
  assert.equal(f.calls.length, 0);
});
Deno.test('website provider routing preserves the existing UPayments adapter', async () => {
  let myf = false;
  const adapter: any = { route: () => Promise.resolve(myf), slots: () => Promise.resolve('myfatoorah') };
  const router = bookingProviderRouter({ slots: () => Promise.resolve('upayments') }, adapter);
  assert.equal(await router.slots({}), 'upayments'); myf = true;
  assert.equal(await router.slots({}), 'myfatoorah');
});

Deno.test('UPayments parity: cancelled bank transaction remains retryable on its pending MyFatoorah invoice', async () => {
  const f=fixture({cancelled:true});await f.adapter.start({id},capability);
  const result=await f.adapter.check(capability);
  assert.equal(result.state,'pending');assert.equal(result.retryableFailure,true);assert.equal(f.captures,0);
});
Deno.test('UPayments parity: simultaneous starts issue one invoice', async () => {
  const f=fixture();await Promise.all([f.adapter.start({id},capability),f.adapter.start({id},capability)]);
  assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,1);
});
Deno.test('UPayments parity: uncertain create is not repeated after a lost connection', async () => {
  const f=fixture({transport:async(_url,options,response)=>{if(options?.method==='POST')throw Error('simulated network interruption');return response;}});
  await assert.rejects(()=>f.adapter.start({id},capability));
  await f.adapter.start({id},capability);
  assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,1);assert.equal(f.captures,0);
});
Deno.test('UPayments parity: explicit creation rejection never confirms a booking', async () => {
  const f=fixture({transport:async(_url,options,response)=>options?.method==='POST'?Response.json({IsSuccess:false},{status:422}):response});
  assert.equal((await f.adapter.start({id},capability)).state,'failed');assert.equal(f.captures,0);
});
for(const mode of ['http-error','network','invalid-json'] as const) Deno.test('UPayments parity: inquiry '+mode+' cannot capture or create another invoice', async()=>{
  const f=fixture({transport:async(_url,options,response)=>{
    if(options?.method==='POST')return response;
    if(mode==='network')throw Error('simulated timeout');
    return mode==='invalid-json'?new Response('not JSON'):Response.json({IsSuccess:false},{status:503});
  }});
  await f.adapter.start({id},capability);await assert.rejects(()=>f.adapter.check(capability));
  assert.equal(f.captures,0);assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,1);
});
for(const status of ['INPROGRESS','AUTHORIZE','CANCELED']) Deno.test('MyFatoorah '+status+' transaction is never treated as captured money',async()=>{
  const f=fixture({invoice:{Invoice:{Id:invoice,ExternalIdentifier:id,Status:'PENDING'},Transactions:[{PaymentId:payment,Status:status}]}});
  await f.adapter.start({id},capability);assert.equal((await f.adapter.check(capability)).state,'pending');assert.equal(f.captures,0);
});
Deno.test('UPayments parity: a successful retry among failed transactions confirms once',async()=>{
  const f=fixture({invoice:{Transactions:[{PaymentId:'123',Status:'FAILED'},{PaymentId:payment,Status:'SUCCESS'},{PaymentId:'456',Status:'CANCELED'}]}});
  await f.adapter.start({id},capability);assert.equal((await f.adapter.check(capability)).state,'paid');assert.equal(f.captures,1);
});
Deno.test('UPayments parity: provider link expires inside the booking hold and respects Arabic',async()=>{
  const f=fixture();const started=await f.adapter.start({id,language:'ar'},capability);
  const body=JSON.parse(f.calls.find(c=>c.options?.method==='POST').options.body);
  assert.equal(body.Language,'AR');assert(Date.parse(body.PaymentExpiry)<Date.parse(started.holdUntil));
});
Deno.test('UPayments parity: sweep recovers without a browser return and defers failures',async()=>{
  const calls:string[]=[];let inquiries=0;
  const adapter=myfatoorahBooking({token:'test-only',rpc:async action=>{
    calls.push(action);
    if(action==='sweep')return [id];
    if(action==='inquire')return {id,state:'pending',sessionId:invoice};
    return null;
  },fetcher:async()=>{inquiries++;throw Error('simulated provider timeout');}});
  await adapter.sweep('synthetic-only');assert.deepEqual(calls,['sweep','inquire','defer']);assert.equal(inquiries,1);
});
