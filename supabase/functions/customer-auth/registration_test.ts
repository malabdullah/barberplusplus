const assertEquals = (actual: unknown, expected: unknown) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); };
const assertRejects = async (run: () => Promise<unknown>, _type: unknown, message: string) => { let error: unknown; try { await run(); } catch (failure) { error = failure; } if (!(error instanceof Error) || !error.message.includes(message)) throw Error('Expected rejection: '+message); };
import { managerRegistrationAction, registrationUser, type RegistrationDependencies } from './registration.ts';
const id='d0000000-0000-4000-8000-000000000001';
const email='pending@example.test';
const start=1793966400000;
function setup() {
  let now=start; let verified=false; let emailMatch=true; let failSend=false; let allow=true; let sends=0; let creates=0;
  const deps:RegistrationDependencies={signup:async()=>{creates++;return{id,email,verified:false};},user:async()=>({id,email:emailMatch?email:'changed@example.test',verified}),resend:async()=>{sends++;if(failSend)throw Error('PRIVATE_PROVIDER_ERROR');}};
  const call=(action:string,body:Record<string,unknown>={},secret='a'.repeat(40),appUrl='https://test.example')=>managerRegistrationAction({action,body,secret,appUrl,ip:'127.0.0.1',deps,limit:()=>Promise.resolve(allow),now:()=>now});
  const signup=()=>call('manager-signup',{name:'QA Manager',email,phone:'+965 59998741',password:'Synthetic12!'});
  return{call,signup,setTime:(time:number)=>{now=time;},verify:()=>{verified=true;},changeEmail:()=>{emailMatch=false;},fail:()=>{failSend=true;},deny:()=>{allow=false;},counts:()=>({sends,creates})};
}
Deno.test('registration receipt checks real confirmation and never returns an Auth session',async()=>{
 const t=setup();const created=await t.signup();assertEquals(created?.status,200);assertEquals(created?.body.confirmationRequired,true);assertEquals('session' in created!.body,false);
 const pending=await t.call('manager-registration-status',{receipt:created!.body.receipt,email:'someone-else@example.test'});assertEquals(pending?.body,{verified:false});
 t.verify();assertEquals((await t.call('manager-registration-status',{receipt:created!.body.receipt}))?.body,{verified:true});
 assertEquals((await t.call('manager-registration-resend',{receipt:created!.body.receipt}))?.body,{verified:true});assertEquals(t.counts().sends,0);
});
Deno.test('registration status rejects missing, tampered, expired, cross-origin and cross-secret receipts',async()=>{
 const t=setup();const r=(await t.signup())!.body.receipt as string;
 for(const receipt of [undefined,'bad',r.slice(0,-4)+'aaaa'])assertEquals((await t.call('manager-registration-status',{receipt}))?.body.error,'REGISTRATION_EXPIRED');
 assertEquals((await t.call('manager-registration-status',{receipt:r},'b'.repeat(40)))?.body.error,'REGISTRATION_EXPIRED');
 assertEquals((await t.call('manager-registration-status',{receipt:r},'a'.repeat(40),'https://production.example'))?.body.error,'REGISTRATION_EXPIRED');
 t.setTime(start+86400001);assertEquals((await t.call('manager-registration-status',{receipt:r}))?.body.error,'REGISTRATION_EXPIRED');
});
Deno.test('resend respects initial cooldown, renews its receipt and sanitizes delivery failures',async()=>{
 const t=setup();const r=(await t.signup())!.body.receipt;
 assertEquals((await t.call('manager-registration-resend',{receipt:r}))?.status,429);assertEquals(t.counts().sends,0);
 t.setTime(start+61000);const resent=await t.call('manager-registration-resend',{receipt:r});assertEquals(resent?.body.resent,true);assertEquals(t.counts().sends,1);
 assertEquals((await t.call('manager-registration-resend',{receipt:resent!.body.receipt}))?.status,429);
 t.setTime(start+122000);t.fail();assertEquals((await t.call('manager-registration-resend',{receipt:resent!.body.receipt}))?.body,{error:'UNAVAILABLE'});
});
Deno.test('changed signup address and server limits cannot be bypassed by caller fields',async()=>{
 const t=setup();const r=(await t.signup())!.body.receipt;t.changeEmail();assertEquals((await t.call('manager-registration-status',{receipt:r,email}))?.body.error,'REGISTRATION_EXPIRED');
 const other=setup();const receipt=(await other.signup())!.body.receipt;other.deny();assertEquals((await other.call('manager-registration-status',{receipt}))?.status,429);
});
Deno.test('invalid manager registration is rejected before creating or sending anything',async()=>{
 const t=setup();for(const body of [{name:'X',email,phone:'+96559998741',password:'Synthetic12!'},{name:'QA',email,phone:'123',password:'Synthetic12!'},{name:'QA',email,phone:'+96559998741',password:'weak'}]) assertEquals((await t.call('manager-signup',body))?.status,400);
 assertEquals(t.counts(),{sends:0,creates:0});
});
Deno.test('fake signup and non-manager users never receive a registration receipt',async()=>{
 await assertRejects(()=>Promise.resolve().then(()=>registrationUser({id,email,identities:[]})),Error,'SIGNUP_EMAIL_EXISTS');
 await assertRejects(()=>Promise.resolve().then(()=>registrationUser({id,email,identities:[{}],app_metadata:{role:'customer'}})),Error,'SIGNUP_EMAIL_EXISTS');
 assertEquals(registrationUser({id,email,identities:[{}],app_metadata:{role:'manager'}}),{id,email,verified:false});
});
