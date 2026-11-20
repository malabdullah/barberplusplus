import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { AUTH_ORIGIN, TEST_ORIGIN } from './worker.js';
const id='00000000-0000-4000-8000-000000000001';
const email=`/auth/email?requestId=${id}&state=${id}&delivery=${id}`;
const oauth=`/auth/oauth?state=${id}&code=${id}`;
for(const path of [email,oauth])test(`fixed credential-free fallback ${path.split('?')[0]}`,()=>{
 for(const method of ['GET','HEAD']){
  const r=worker.fetch(new Request(AUTH_ORIGIN+path,{method}));assert.equal(r.status,307);
  assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('cache-control'),'no-store');
  const target=r.headers.get('location');assert(target.startsWith(TEST_ORIGIN));assert(!target.includes(id));assert(!target.includes('code='));assert(!target.includes('delivery='));assert.equal(r.headers.get('set-cookie'),null);
 }
});
for(const path of ['/auth/email','/auth/oauth',email+'&state='+id,email+'&next=https://evil.test',email.replace('delivery='+id,'delivery=no'),oauth+'&code='+id,oauth+'&access_token=secret','/auth/oauth?state='+id+'&error=access_denied&code='+id,'/book?shop='+id,'/.well-known/apple-app-site-association'])test(`deny malformed or unsupported ${path.split('?')[0]} ${path.length}`,()=>assert.equal(worker.fetch(new Request(AUTH_ORIGIN+path)).status,404));
test('only the accepted Test Android signer is associated',async()=>{
 const r=worker.fetch(new Request(AUTH_ORIGIN+'/.well-known/assetlinks.json'));assert.equal(r.status,200);
 const body=await r.json();assert.equal(body.length,1);assert.equal(body[0].target.package_name,'com.barberplusplus.customer.test');assert.equal(body[0].target.sha256_cert_fingerprints.length,1);
 assert.equal(worker.fetch(new Request('https://www.barberplusplus.com'+email)).status,404);
 assert.equal(worker.fetch(new Request(AUTH_ORIGIN+email,{method:'POST'})).status,405);
});
test('bounded OAuth denial has no error or identity forwarding',()=>{
 const r=worker.fetch(new Request(AUTH_ORIGIN+`/auth/oauth?state=${id}&error=access_denied&error_description=Declined`));assert.equal(r.status,307);assert.equal(r.headers.get('location'),TEST_ORIGIN+'/customer/sign-in');
});
