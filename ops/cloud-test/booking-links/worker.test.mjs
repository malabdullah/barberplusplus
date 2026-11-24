import { test } from 'node:test';import assert from 'node:assert/strict';
import worker,{HANDOFF_ORIGIN,TEST_ORIGIN}from'./worker.js';
const id='10000000-0000-4000-8000-000000000011';
test('only exact public catalog selections redirect to gated Test, never credentials or arbitrary hosts',()=>{
 for(const kind of['shop','barber'])for(const method of['GET','HEAD']){
  const r=worker.fetch(new Request(HANDOFF_ORIGIN+'/book?'+kind+'='+id,{method,headers:{Cookie:'private',Authorization:'private'}}));
  assert.equal(r.status,307);assert.equal(r.headers.get('location'),TEST_ORIGIN+'/book?'+kind+'='+id);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('cache-control'),'no-store');
 }
});
test('invalid selections, paths, methods and open redirects fail closed',()=>{
 for(const path of['/','/booking/share#'+'a'.repeat(64),'/book','/book?shop=bad','/book?shop='+id+'&barber='+id,'/book?shop='+id+'&shop='+id,'/book?shop='+id+'&next=https://foreign.example','/book?barber='+id+'#token'])assert.equal(worker.fetch(new Request(HANDOFF_ORIGIN+path)).status,404);
 assert.equal(worker.fetch(new Request(HANDOFF_ORIGIN+'/book?shop='+id,{method:'POST'})).status,405);
 assert.equal(worker.fetch(new Request('https://foreign.example/book?shop='+id)).status,404);
});
test('public association documents contain only exact Test identities and approved booking/signup routes',async()=>{
 const a=worker.fetch(new Request(HANDOFF_ORIGIN+'/.well-known/apple-app-site-association'));
 assert.equal(a.status,200);assert.equal(a.headers.get('content-type'),'application/json');assert.equal(a.headers.get('location'),null);assert.equal(a.headers.get('set-cookie'),null);
 const body=await a.json();assert.deepEqual(body.applinks.details[0].appIDs,['D49RFZQ6BT.com.barberplusplus.customer.test']);
 assert.deepEqual(body.applinks.details[0].components,[{'/':'/book','?':{shop:'*'}},{'/':'/book','?':{barber:'*'}},{'/':'/auth/email','?':{client:'ios',state:'*'}},{'/':'/payments/return'}]);assert(!JSON.stringify(body).includes('/booking/share'));
 const b=worker.fetch(new Request(HANDOFF_ORIGIN+'/.well-known/assetlinks.json'));assert.equal(b.status,200);const records=await b.json();assert(records.every(x=>x.target.package_name==='com.barberplusplus.customer.test'&&x.target.sha256_cert_fingerprints.every(v=>/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(v))));
});

test('native payment return discards provider query and uses a fixed neutral destination', async()=>{
 const callback = '/payments/provider-return?result=CAPTURED&payment_id=private&next=https://foreign.example';
 for (const method of ['GET','HEAD']) {
  const r=worker.fetch(new Request(HANDOFF_ORIGIN+callback,{method,headers:{Cookie:'private',Authorization:'private'}}));
  assert.equal(r.status,303);assert.equal(r.headers.get('location'),HANDOFF_ORIGIN+'/payments/return');
  assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  assert.equal(r.headers.get('cache-control'),'no-store');
 }
 const page=worker.fetch(new Request(HANDOFF_ORIGIN+'/payments/return'));
 const html=await page.text();
 assert.equal(page.status,200);
 assert.match(html,/Check your payment/);
 assert(!/confirmed|payment_id|private|foreign\.example/.test(html));
 for(const path of ['/payments/return?result=CAPTURED','/payments/return#token','/payments/return/'])
  assert.equal(worker.fetch(new Request(HANDOFF_ORIGIN+path)).status,404);
 assert.equal(worker.fetch(new Request(HANDOFF_ORIGIN+callback,{method:'POST'})).status,405);
});
