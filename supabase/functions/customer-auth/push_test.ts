import { customerPushAction } from './push.ts';
const assert = (value: unknown) => { if (!value) throw Error('Assertion failed'); };
const device = { deviceId: 'a0000000-0000-4000-8000-000000000001', deviceSecret: 'a'.repeat(64) };
const runtime = { environment: 'cloud-test', appUrl: 'https://barber-test.alabdullah-cs.workers.dev', publicUrl: 'https://qvkucvcjmojjbphlzlks.supabase.co', secret: 'synthetic-private-signing-key-over-thirty-two-characters' };
const request = (token = '') => new Request(runtime.appUrl, { headers: token ? { authorization: `Bearer ${token}` } : {} });
Deno.test('push identity comes only from a live bearer, ignoring supplied account and topic', async () => {
  let data: Record<string, unknown> = {};
  await customerPushAction({ ...runtime, identity: async () => null, rpc: async (_, value) => { data = value; } }, request(),
    { action: 'push-register', ...device, version: 1, token: 'b'.repeat(64), environment: 'sandbox', permission: false, language: 'en',
      user_id: 'forged-account', session_id: 'forged-session', topic: 'another.bundle' });
  assert(!('user_id' in data) && !('session_id' in data) && !('topic' in data));
});
Deno.test('revoked bearer never becomes an anonymous push request', async () => {
  let calls = 0;
  try {
    await customerPushAction({ ...runtime, identity: async () => null, rpc: async () => { calls++; } }, request('revoked'), { action: 'push-status', ...device });
    throw Error('Expected failure');
  } catch (error) { assert((error as Error).message === 'AUTH_REQUIRED'); }
  assert(calls === 0);
});
Deno.test('Test registration rejects production APNs before SQL', async () => {
  let calls = 0;
  try {
    await customerPushAction({ ...runtime, identity: async () => null, rpc: async () => { calls++; } }, request(),
      { action: 'push-register', ...device, version: 1, token: 'b'.repeat(64), environment: 'production', permission: false, language: 'en' });
    throw Error('Expected failure');
  } catch (error) { assert((error as Error).message === 'INVALID_REQUEST'); }
  assert(calls === 0);
});
Deno.test('live development registration allows sandbox with server-selected live topic', async () => {
  let data: Record<string, unknown> = {};
  await customerPushAction({ ...runtime, environment: 'production', appUrl: 'https://www.barberplusplus.com', publicUrl: 'https://srv1073968.hstgr.cloud',
    identity: async () => ({ user_id: 'live-account', session_id: 'live-session' }), rpc: async (_, value) => { data = value; } }, request('live'),
    { action: 'push-register', ...device, version: 2, token: 'b'.repeat(64), environment: 'sandbox', permission: false, language: 'ar' });
  assert(data.user_id === 'live-account' && data.environment === 'sandbox' && !('topic' in data));
});
Deno.test('extra preference keys and unsigned guest capabilities are rejected', async () => {
  let calls = 0;
  const deps = { ...runtime, identity: async () => null, rpc: async () => { calls++; } };
  for (const body of [
    { action: 'push-preferences', preferences: { updates: true, reminder24: true, reminder2: true, reviews: false, untrusted: true } },
    { action: 'push-guest-subscribe', claimToken: 'forged.signature' }]) {
    try { await customerPushAction(deps, request(), { ...device, ...body }); throw Error('Expected failure'); }
    catch (error) { assert(['INVALID_REQUEST', 'FORBIDDEN'].includes((error as Error).message)); }
  }
  assert(calls === 0);
});

const signedReceipt = async (fields: Record<string,unknown> = {}) => {
  const bytes = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const payload=bytes(new TextEncoder().encode(JSON.stringify({purpose:'receipt',id:'a0000000-0000-4000-8000-000000000501',phone:'',country_code:'+965',guest_contact:'email',email:'guest@example.test',expires:Date.now()+60_000,...fields})));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(`customer-booking-test-v1:${runtime.secret}`),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return payload+'.'+bytes(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))));
};
Deno.test('email guest push derives booking and contact only from its signed receipt, phone may be blank', async()=>{
 let data:Record<string,unknown>={};
 await customerPushAction({...runtime,identity:async()=>null,rpc:async(_,value)=>{data=value;}},request(),
  {action:'push-guest-subscribe',...device,claimToken:await signedReceipt(),bookingId:'forged',receiptContact:'phone',receiptEmail:'attacker@example.test',receiptPhone:'59999999'});
 assert(data.bookingId==='a0000000-0000-4000-8000-000000000501'&&data.receiptContact==='email'&&data.receiptEmail==='guest@example.test'&&data.receiptPhone===''&&!('user_id'in data));
});
Deno.test('legacy phone receipts stay phone-bound and never adopt client email claims',async()=>{
 let data:Record<string,unknown>={};
 await customerPushAction({...runtime,identity:async()=>null,rpc:async(_,value)=>{data=value;}},request(),
  {action:'push-guest-subscribe',...device,claimToken:await signedReceipt({guest_contact:undefined,email:undefined,phone:'50000099'}),receiptContact:'email',receiptEmail:'attacker@example.test'});
 assert(data.receiptPhone==='50000099'&&!('receiptContact'in data)&&!('receiptEmail'in data));
});
Deno.test('expired, account-bound, unknown-mode and malformed-email guest receipts are denied before SQL',async()=>{
 let calls=0;
 for(const fields of [{expires:Date.now()-1000},{user_id:'account'},{guest_contact:'unknown'},{email:undefined},{email:'invalid'},{email:'guest\r\n@example.test'}]){
  try{await customerPushAction({...runtime,identity:async()=>null,rpc:async()=>{calls++;}},request(),{action:'push-guest-subscribe',...device,claimToken:await signedReceipt(fields)});throw Error('Expected failure');}
  catch(error){assert((error as Error).message==='FORBIDDEN');}
 }
 assert(calls===0);
});
Deno.test('altered email receipt signatures cannot reach subscription SQL',async()=>{
 const token=await signedReceipt();const [payload,signature]=token.split('.');
 // Flip significant bits, rather than unused base64 padding bits.
 const tampered=payload+'.'+(signature[0]==='A'?'B':'A')+signature.slice(1);let calls=0;
 try{await customerPushAction({...runtime,identity:async()=>null,rpc:async()=>{calls++;}},request(),{action:'push-guest-subscribe',...device,claimToken:tampered});throw Error('Expected failure');}
 catch(error){assert((error as Error).message==='FORBIDDEN');}
 assert(calls===0);
});
