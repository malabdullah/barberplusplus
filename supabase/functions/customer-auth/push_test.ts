import {assertEquals,assertRejects} from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {customerPushAction} from './push.ts';
const device='10000000-0000-4000-8000-000000000001';
const secret='d'.repeat(64);
const serverSecret='server-only-secret'.repeat(4);
const registration={action:'push-register',deviceId:device,deviceSecret:secret,version:1,environment:'sandbox',token:'a'.repeat(64),language:'en',permission:true};
function fixture(identity: {user_id:string;session_id:string}|null=null) {
  const calls:Record<string,unknown>[]=[];
  return {calls,deps:{secret:serverSecret,identity:async()=>identity,rpc:async(_action:string,data:Record<string,unknown>)=>{calls.push(data);return {success:true};}}};
}
Deno.test('registration never trusts client-supplied account/session IDs',async()=>{
  const f=fixture({user_id:'trusted',session_id:'live'});
  await customerPushAction(f.deps,new Request('https://test',{headers:{authorization:'Bearer verified'}}),{...registration,user_id:'victim',session_id:'forged'});
  assertEquals(f.calls[0].user_id,'trusted');assertEquals(f.calls[0].session_id,'live');
  const guest=fixture();await customerPushAction(guest.deps,new Request('https://test'),{...registration,user_id:'victim'});
  assertEquals(guest.calls[0].user_id,undefined);
});
Deno.test('invalid identity, unsupported environment, token, version and preferences fail closed',async()=>{
  const f=fixture();
  await assertRejects(()=>customerPushAction(f.deps,new Request('https://test',{headers:{authorization:'Bearer invalid'}}),registration),Error,'AUTH_REQUIRED');
  for(const body of [{...registration,environment:'production'},{...registration,token:'f'.repeat(33)},{...registration,version:0},
    {...registration,action:'push-preferences',preferences:{updates:true,reminder24:true,reminder2:true,reviews:'yes'}}]) {
    await assertRejects(()=>customerPushAction(f.deps,new Request('https://test'),body),Error,'INVALID_REQUEST');
  }
  assertEquals(f.calls.length,0);
});
const encode=(data:Uint8Array)=>btoa(String.fromCharCode(...data)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
async function proof(value:Record<string,unknown>) {
  const payload=encode(new TextEncoder().encode(JSON.stringify(value)));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('customer-booking-test-v1:'+serverSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return payload+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))));
}
Deno.test('guest subscription requires an unexpired signed guest receipt, never a phone or booking ID alone',async()=>{
  const f=fixture();
  const receipt={purpose:'receipt',id:device,name:'Guest',phone:'55501234',country_code:'+965',expires:Date.now()+60000};
  for(const token of ['forged',await proof({...receipt,expires:Date.now()-1}),await proof({...receipt,purpose:'verified'}),await proof({...receipt,user_id:'account'})]) {
    await assertRejects(()=>customerPushAction(f.deps,new Request('https://test'),{...registration,action:'push-guest-subscribe',claimToken:token}),Error,'FORBIDDEN');
  }
  await customerPushAction(f.deps,new Request('https://test'),{...registration,action:'push-guest-subscribe',claimToken:await proof(receipt),bookingId:'victim',receiptPhone:'wrong'});
  assertEquals(f.calls.length,1);assertEquals(f.calls[0].bookingId,device);assertEquals(f.calls[0].receiptPhone,'55501234');
});

Deno.test('master notification pause accepts only a boolean and preserves legacy category payloads',async()=>{
  const prefs={updates:true,reminder24:false,reminder2:true,reviews:false};
  const f=fixture();const body={...registration,action:'push-preferences',preferences:prefs};
  await customerPushAction(f.deps,new Request('https://test'),body);
  assertEquals(f.calls[0].notificationsEnabled,undefined);
  for(const enabled of [false,true]) {
    await customerPushAction(f.deps,new Request('https://test'),{...body,notificationsEnabled:enabled});
    assertEquals(f.calls.at(-1)?.notificationsEnabled,enabled);assertEquals(f.calls.at(-1)?.preferences,prefs);
  }
  for(const value of [null,0,'false',{},[]]) {
    await assertRejects(()=>customerPushAction(f.deps,new Request('https://test'),{...body,notificationsEnabled:value}),Error,'INVALID_REQUEST');
  }
  assertEquals(f.calls.length,3);
});
