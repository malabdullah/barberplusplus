import { customerPasswordAction } from './password.ts';
const assert=(value:unknown,message='Assertion failed')=>{if(!value)throw Error(message);};
const uid='af220000-0000-4000-8000-000000000001';
const sid='af220000-0000-4000-8000-000000000002';
const request='af220000-0000-4000-8000-000000000003';
const proof='af220000-0000-4000-8000-000000000004';
const password='Different12!';
const session={access_token:`e30.${btoa(JSON.stringify({session_id:sid}))}.sig`,refresh_token:'private-refresh',user:{id:uid,app_metadata:{role:'customer'}}};
type Context=Parameters<typeof customerPasswordAction>[0];
function fixture(overrides:Partial<Context>={}){
  const calls:{action:string;data:Record<string,unknown>}[]=[];const writes:unknown[][]=[];const mail:string[]=[];
  let applied=false;
  const c:Context={action:'password-change',body:{currentPassword:'Current12!',password,confirmPassword:password},token:'validated-token',ip:'fixture-ip',environment:'cloud-test',appUrl:'https://barber-test.alabdullah-cs.workers.dev',identity:async()=>({user_id:uid,session_id:sid}),limit:async()=>true,
    deps:{rpc:async(action,data)=>{
      calls.push({action,data});
      if(action==='status')return{hasPassword:true,providers:['email','google']};
      if(action==='invite-start')return{operation:proof,userId:uid};
      if(action==='current-begin'||action==='prepare')return{operation:proof};
      if(action==='operation-result')return{applied};
      if(action==='request-start')return{requestId:request,email:'fixture@example.test',deliver:true};
      if(action==='request-load')return{userId:uid,email:'fixture@example.test',tokenHash:'a'.repeat(64)};
      if(action==='request-verified'||action==='invite-verified')return{proof,expiresIn:300};
      return{success:true};
    },reauthenticate:async()=>({sessionId:'af220000-0000-4000-8000-000000000005',token:'ephemeral-reauth-token'}),discardReauthentication:async()=>{},sendRecovery:async(_email,callback)=>{mail.push(callback);},verifyRecovery:async()=>session,writePassword:async(...args)=>{writes.push(args);applied=true;return{ok:true,definitive:true};}},...overrides};
  return{c,calls,writes,mail,run:()=>customerPasswordAction(c),setApplied:(value:boolean)=>{applied=value;}};
}
async function rejects(run:()=>Promise<unknown>,message:string){try{await run();}catch(error){assert(error instanceof Error&&error.message===message,`Expected ${message}`);return;}throw Error(`Expected ${message}`);}
Deno.test('password change derives identity from the validated session and reconciles the committed write',async()=>{
  const f=fixture();f.c.body.user_id='victim';f.c.body.session_id='victim-session';
  const result=await f.run();assert(result?.status===200&&result.body.signInRequired===true);
  assert(f.writes[0][0]===uid&&f.writes[0][2]===proof);
  assert(f.calls.every(call=>!('user_id'in call.data)||call.data.user_id===uid));
});
Deno.test('wrong current password never prepares or writes a credential',async()=>{
  const f=fixture();f.c.deps.reauthenticate=async()=>null;
  await rejects(f.run,'WRONG_CURRENT_PASSWORD');assert(!f.calls.some(call=>call.action==='current-begin')&&f.writes.length===0);
});
Deno.test('a Google-linked account with a password still uses current password verification',async()=>{
  const f=fixture();await f.run();assert(f.calls.some(call=>call.action==='current-begin'));
});
Deno.test('a provider-only account is never asked to verify a nonexistent current password',async()=>{
  const f=fixture();f.c.deps.rpc=async()=>({hasPassword:false,providers:['google']});
  await rejects(f.run,'PASSWORD_NOT_SET');assert(f.writes.length===0);
});
Deno.test('weak, mismatched and unchanged passwords fail before reauthentication',async()=>{
  for(const [body,error]of [[{password:'weak',confirmPassword:'weak'},'WEAK_PASSWORD'],[{confirmPassword:'mismatch'},'PASSWORD_MISMATCH'],[{currentPassword:password},'SAME_PASSWORD']]as const){const f=fixture();f.c.body={...f.c.body,...body};await rejects(f.run,error);assert(f.calls.length===0);}
});
Deno.test('a normal authenticated session cannot call the former reset action without a proof',async()=>{
  const f=fixture({action:'email-reset',body:{password,confirmPassword:password}});
  await rejects(f.run,'PASSWORD_PROOF_REQUIRED');assert(f.writes.length===0);
});
Deno.test('proof expiry, reuse and changed credential state are enforced by the service gate',async()=>{
  const f=fixture({action:'email-reset',body:{password,confirmPassword:password,proof}});
  f.c.deps.rpc=async()=>{throw Error('PASSWORD_PROOF_REQUIRED');};
  await rejects(f.run,'PASSWORD_PROOF_REQUIRED');assert(f.writes.length===0);
});
Deno.test('a lost Auth reply is successful only when the database proves the write committed',async()=>{
  const f=fixture();f.c.deps.writePassword=async()=>{f.setApplied(true);throw Error('Lost reply');};
  assert((await f.run())?.body.success===true);
});
Deno.test('an unknown Auth outcome retains the guard and never retries a credential write',async()=>{
  const f=fixture();let attempts=0;f.c.deps.writePassword=async()=>{attempts++;throw Error('Network error');};
  await rejects(f.run,'PASSWORD_UPDATE_UNCERTAIN');assert(attempts===1&&!f.calls.some(call=>call.action==='abort'));
});
Deno.test('a definitive rejected Auth write aborts only its unchanged operation',async()=>{
  const f=fixture();f.c.deps.writePassword=async()=>({ok:false,definitive:true,code:'weak_password'});
  await rejects(f.run,'WEAK_PASSWORD');assert(f.calls.some(call=>call.action==='abort'&&call.data.operation===proof));
});
Deno.test('provider password setup derives its email and identity from the session',async()=>{
  const f=fixture({action:'password-setup-request',body:{email:'attacker@example.test',user_id:'victim'}});
  const result=await f.run();assert(result?.status===200&&result.body.email==='fixture@example.test');
  const call=f.calls.find(call=>call.action==='request-start');assert(call?.data.user_id===uid&&call.data.purpose==='set');
});
Deno.test('recovery links are bound to the issued request before Auth consumes the token',async()=>{
  const f=fixture({action:'password-recovery-verify',body:{requestId:request,tokenHash:'b'.repeat(64)}});let verified=false;f.c.deps.verifyRecovery=async()=>{verified=true;return session;};
  await rejects(f.run,'INVALID_CODE');assert(!verified);
});
Deno.test('verified recovery returns a one-use proof and session without exposing the stored token hash',async()=>{
  const f=fixture({action:'password-recovery-verify',body:{requestId:request,code:'123456'}});
  const result=await f.run();assert(result?.body.proof===proof&&result.body.session===session&&!('tokenHash'in result.body));
});
Deno.test('native recovery requires device binding and never puts its verifier into the link',async()=>{
  const f=fixture({action:'email-recovery',body:{email:'fixture@example.test',client:'ios',nativeState:request}});
  await rejects(f.run,'NATIVE_CLIENT_UPDATE_REQUIRED');
  f.c.body.nativeChallenge='a'.repeat(43);const result=await f.run();assert(result?.status===200);
  const link=new URL(f.mail[0]);assert(link.origin===f.c.appUrl&&link.searchParams.get('client')==='ios');
  assert(!link.href.includes('nativeVerifier')&&!link.href.includes('nativeChallenge'));
});
Deno.test('native verification uses the verifier hash, not a caller-provided challenge',async()=>{
  const f=fixture({action:'password-recovery-verify',body:{requestId:request,client:'ios',nativeState:request,nativeVerifier:'v'.repeat(43),nativeChallenge:'forged',code:'123456'}});
  await f.run();const call=f.calls.find(call=>call.action==='request-load');assert(String(call?.data.native_challenge).length===43&&call?.data.native_challenge!=='forged');
});
Deno.test('native recovery is unavailable on an unapproved environment or host',async()=>{
  const f=fixture({environment:'production',appUrl:'https://unapproved.example',action:'email-recovery',body:{email:'fixture@example.test',client:'ios',nativeState:request,nativeChallenge:'a'.repeat(43)}});
  await rejects(f.run,'INVALID_REQUEST');assert(f.mail.length===0);
});
Deno.test('rate limiting runs before a password reauthentication or email delivery',async()=>{
  const f=fixture({limit:async()=>false});await rejects(f.run,'RATE_LIMITED');assert(f.calls.length===0&&f.writes.length===0);
});
Deno.test('a failed reconciliation never aborts a possibly committed credential write',async()=>{
 const f=fixture();const rpc=f.c.deps.rpc;f.c.deps.rpc=(action,data)=>action==='operation-result'?Promise.reject(Error('offline')):rpc(action,data);
 await rejects(f.run,'PASSWORD_UPDATE_UNCERTAIN');assert(f.writes.length===1&&!f.calls.some(call=>call.action==='abort'));
});
Deno.test('native delivery accepts the emailed token but returns no Auth secret',async()=>{
 const f=fixture({action:'password-native-delivery',body:{requestId:request,nativeState:request,tokenHash:'a'.repeat(64)}});
 f.c.deps.rpc=async(action,data)=>{assert(action==='request-delivery'&&data.token_hash==='a'.repeat(64));return{deliveryToken:proof};};
 const result=await f.run();assert(result?.body.deliveryToken===proof&&!('tokenHash'in result.body));
});

Deno.test('invitation verification starts a token-bound bootstrap and requires a separate password proof',async()=>{
 const f=fixture({action:'password-invite-verify',body:{tokenHash:'a'.repeat(64)}});f.c.deps.verifyRecovery=async()=>({...session,user:{...session.user,app_metadata:{role:'barber'}}});
 const result=await f.run();assert(result?.body.proof===proof);assert(f.calls.map(x=>x.action).join(',')==='invite-start,abort,invite-verified');assert(f.writes.length===0);
});
Deno.test('an invalid invitation does not authorize a password write and clears only its unchanged bootstrap',async()=>{
 const f=fixture({action:'password-invite-verify',body:{tokenHash:'a'.repeat(64)}});f.c.deps.verifyRecovery=async()=>null;
 await rejects(f.run,'INVALID_CODE');assert(f.calls.some(x=>x.action==='abort'&&x.data.operation===proof)&&f.writes.length===0);
});
