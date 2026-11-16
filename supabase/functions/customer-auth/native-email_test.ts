import { nativeEmailAction } from './native-email.ts';
const assert=(v:unknown,m='Assertion failed')=>{if(!v)throw Error(m);};
const uid='af230000-0000-4000-8000-000000000001',sid='af230000-0000-4000-8000-000000000002',rid='af230000-0000-4000-8000-000000000003',state='af230000-0000-4000-8000-000000000004',handle='af230000-0000-4000-8000-000000000005';
const session={access_token:`header.${btoa(JSON.stringify({session_id:sid}))}.signature`,refresh_token:'synthetic-refresh',user:{id:uid,email:'fixture@example.test',email_confirmed_at:'2026-11-16',app_metadata:{role:'customer'},user_metadata:{name:'Fixture'}}};
const signup={client:'android',email:'fixture@example.test',name:'Fixture',password:'SyntheticPass1!',nativeState:state,nativeChallenge:'a'.repeat(43)};
const verify={client:'android',requestId:rid,nativeState:state,nativeVerifier:'v'.repeat(43),code:'123456'};
function fixture(action='email-native-verify',body:Record<string,unknown>=verify){
 const calls:{action:string;data:Record<string,unknown>}[]=[],mail:{email:string;callback:string}[]=[],discarded:string[]=[];let providerCalls=0;
 const c:Parameters<typeof nativeEmailAction>[0]={action,body,environment:'cloud-test',appUrl:'https://barber-test.alabdullah-cs.workers.dev',publicUrl:'https://qvkucvcjmojjbphlzlks.supabase.co',ip:'synthetic',limit:async()=>true,deps:{
  rpc:async(action,data)=>{calls.push({action,data});if(action==='reserve')return{operation:handle,userId:uid,email:'fixture@example.test',tokenHash:'a'.repeat(64)};if(action==='delivery')return{deliveryToken:handle};if(action==='status')return{status:'ready',expiresIn:120,email:'fixture@example.test'};if(action==='resend')return{deliver:true,email:'fixture@example.test',expiresIn:120};return{success:true};},
  account:async()=>uid,send:async(email,callback)=>{mail.push({email,callback});},verify:async()=>{providerCalls++;return session;},discard:async(token)=>{discarded.push(token);},profile:async()=>({id:uid,name:'Fixture'}),
 }};
 return{c,calls,mail,discarded,run:()=>nativeEmailAction(c),providerCalls:()=>providerCalls};
}
async function rejects(run:()=>Promise<unknown>,error:string){try{await run();}catch(e){assert(e instanceof Error&&e.message===error,`Expected ${error}`);return;}throw Error(`Expected ${error}`);}
Deno.test('Android signup binding is denied before writes outside the exact hosted Test identity',async()=>{
 for(const override of [{environment:'production',appUrl:'https://www.barberplusplus.com'},{publicUrl:'https://other.supabase.co'},{appUrl:'https://other.example'}]){
  const f=fixture('email-signup',signup);Object.assign(f.c,override);let accounts=0;f.c.deps.account=async()=>{accounts++;return uid;};await rejects(f.run,'INVALID_REQUEST');assert(accounts===0&&f.calls.length===0&&f.mail.length===0);
 }
});
Deno.test('signup stores no password in a binding and exposes no credentials in its callback',async()=>{
 const f=fixture('email-signup',{...signup,user_id:'forged',role:'admin'});const result=await f.run();assert(result?.body.success===true&&result.body.expiresIn===3600);
 const started=f.calls.find(x=>x.action==='start')!;assert(started.data.user_id===uid&&started.data.client==='android');assert(!JSON.stringify(started.data).includes(signup.password));
 const callback=new URL(f.mail[0].callback);assert(callback.origin===f.c.appUrl&&callback.pathname==='/customer/email-callback');assert(callback.searchParams.get('client')==='android');
 assert(!callback.href.includes('fixture')&&!callback.href.includes('nativeChallenge')&&!callback.href.includes(signup.password));assert(result?.body.pendingHandle&&result.body.requestId);
});
Deno.test('rate limiting occurs before account creation or email dispatch',async()=>{
 const f=fixture('email-signup',signup);f.c.limit=async()=>false;f.c.deps.account=()=>{throw Error('Must not create');};await rejects(f.run,'RATE_LIMITED');assert(f.calls.length===0&&f.mail.length===0);
});
Deno.test('signup has a generic result for an occupied or ineligible identity without sending mail',async()=>{
 const f=fixture('email-signup',signup);f.c.deps.account=async()=>null;const result=await f.run();assert(result?.body.success===true&&f.mail.length===0);assert(f.calls.find(x=>x.action==='start')?.data.user_id===null);
});
Deno.test('code verification uses device verifier hash and server-bound identity, not supplied email/challenge',async()=>{
 const f=fixture('email-native-verify',{...verify,email:'forged@example.test',nativeChallenge:'forged'});const result=await f.run();assert(result?.body.session===session);
 const reserve=f.calls.find(x=>x.action==='reserve')!;assert(reserve.data.client==='android'&&String(reserve.data.native_challenge).length===43&&reserve.data.native_challenge!=='forged');
 assert(f.calls.find(x=>x.action==='verified')?.data.user_id===uid);assert(!JSON.stringify(result?.body).includes('tokenHash'));
});
Deno.test('verification requires exactly code or opaque delivery, never raw token or both',async()=>{
 for(const extra of [{tokenHash:'a'.repeat(64)},{deliveryToken:handle},{code:'bad'},{code:undefined}]){
  const f=fixture('email-native-verify',{...verify,...extra});await rejects(f.run,'INVALID_CODE');assert(!f.calls.some(x=>x.action==='reserve')&&f.providerCalls()===0);
 }
});
Deno.test('wrong code releases only its lease without returning a session',async()=>{
 const f=fixture();f.c.deps.verify=async()=>null;await rejects(f.run,'INVALID_CODE');assert(f.calls.find(x=>x.action==='invalid-code')?.data.operation===handle);assert(!f.calls.some(x=>x.action==='verified'));
});
Deno.test('uncertain provider verification is terminal and is never automatically retried',async()=>{
 const f=fixture();let attempts=0;f.c.deps.verify=async()=>{attempts++;throw Error('Lost reply');};await rejects(f.run,'UNAVAILABLE');assert(attempts===1&&f.calls.some(x=>x.action==='uncertain')&&!f.calls.some(x=>x.action==='invalid-code'));
});
Deno.test('replayed or mismatched reservation fails before consuming an Auth code',async()=>{
 const f=fixture();f.c.deps.rpc=async()=>{throw Error('INVALID_CODE');};await rejects(f.run,'INVALID_CODE');assert(f.providerCalls()===0);
});
Deno.test('mismatched and staff identities are discarded without customer profile creation',async()=>{
 for(const [user,error]of [[{...session.user,id:rid},'INVALID_CODE'],[{...session.user,email:'different@example.test'},'INVALID_CODE'],[{...session.user,app_metadata:{role:'manager'}},'STAFF_ACCOUNT']]as const){
  const f=fixture();f.c.deps.verify=async()=>({...session,user});f.c.deps.profile=()=>{throw Error('Must not profile');};await rejects(f.run,error);assert(f.discarded.length===1&&f.calls.some(x=>x.action==='uncertain'));
 }
});
Deno.test('profile completion failure discards the transient session and does not expose it',async()=>{
 const f=fixture();f.c.deps.profile=async()=>{throw Error('UNAVAILABLE');};await rejects(f.run,'UNAVAILABLE');assert(f.discarded.length===1);
});
Deno.test('delivery returns only an opaque handle and status omits the stored email',async()=>{
 const delivery=fixture('email-native-delivery',{client:'android',requestId:rid,nativeState:state,tokenHash:'a'.repeat(64)});assert(JSON.stringify((await delivery.run())?.body)===JSON.stringify({deliveryToken:handle}));
 const status=fixture('email-native-status',{client:'android',requestId:rid,nativeState:state,nativeChallenge:'a'.repeat(43),pendingHandle:handle});assert(JSON.stringify((await status.run())?.body)===JSON.stringify({status:'ready',expiresIn:120}));
});
Deno.test('resend retains the stored identity and expiry, and denied email rate does not invalidate its current code',async()=>{
 const body={client:'android',requestId:rid,nativeState:state,nativeChallenge:'a'.repeat(43),pendingHandle:handle,email:'forged@example.test'};
 const f=fixture('email-resend',body);assert((await f.run())?.body.expiresIn===120&&f.mail[0].email==='fixture@example.test');
 const denied=fixture('email-resend',body);denied.c.limit=async(key)=>!key.startsWith('email:email-resend:');await rejects(denied.run,'RATE_LIMITED');assert(!denied.calls.some(x=>x.action==='resend')&&denied.mail.length===0);
});
