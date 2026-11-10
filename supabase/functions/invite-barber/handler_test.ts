const assertEquals=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Values differ');};
const assert=(value:unknown)=>{if(!value)throw Error('Assertion failed');};
import { createInviteHandler, type InviteDependencies } from './handler.ts';
const id='fa140000-0000-4000-8000-000000000001'; const secret='a'.repeat(64);
function setup(overrides:Partial<InviteDependencies>={}) {
 const calls:{action:string;data:Record<string,unknown>}[]=[];const mails:string[]=[];let created=0;
 const deps:InviteDependencies={appUrl:'https://test.example',identity:async t=>t==='valid'?{user_id:'trusted-user',session_id:'trusted-session'}:null,limit:async()=>true,
 rpc:async(action,data)=>{calls.push({action,data});if(action==='resolve')return {kind:'new',email:'new@example.test',shop:'Shop'};return {id,email:'new@example.test',shop:'Shop'};},
 createUser:async()=>{created++;return 'new-user';},mail:async(_email,_shop,link)=>{mails.push(link);},...overrides};
 const handler=createInviteHandler(deps);
 return {calls,mails,created:()=>created,call:async(body:unknown,auth='valid',origin='https://test.example')=>{
 const r=await handler(new Request('https://edge.example',{method:'POST',headers:{Origin:origin,...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}};
}
Deno.test('managed profile invitations pass only a validated target with trusted actor',async()=>{
 const s=setup();
 assertEquals((await s.call({action:'send',branchId:id,email:'new@example.test',managedBarberId:'invalid'})).status,400);
 assertEquals(s.calls.length,0);
 assertEquals((await s.call({action:'send',branchId:id,email:'new@example.test',managedBarberId:id,actor:'forged'})).status,200);
 assertEquals(s.calls[0].data.managed_barber_id,id);assertEquals(s.calls[0].data.actor,'trusted-user');assertEquals(s.created(),0);
});
Deno.test('manager identities are derived from the token, not supplied actor/session fields',async()=>{
 const s=setup();const r=await s.call({action:'send',branchId:id,email:' NEW@example.test ',actor:'forged',session:'forged'});assertEquals(r.status,200);
 assertEquals(s.calls[0].data.actor,'trusted-user');assertEquals(s.calls[0].data.session,'trusted-session');assertEquals(s.calls[0].data.email,'new@example.test');assertEquals(s.created(),0);
 assertEquals(s.mails.length,1);const link=new URL(s.mails[0]);assertEquals(link.pathname,'/accept-invite');assert(!link.search.includes('token'));assertEquals(new URLSearchParams(link.hash.slice(1)).get('token')?.length,64);
 assert(!JSON.stringify(r.body).includes(s.calls[0].data.token_hash as string));
});
Deno.test('anonymous send/list actions and untrusted origins fail closed',async()=>{
 const s=setup();for(const action of ['list','check','send','resend','cancel'])assertEquals((await s.call({action,branchId:id,email:'new@example.test',id},'')).status,401);
 assertEquals((await s.call({action:'resolve',id,token:secret},'','https://evil.example')).status,403);assertEquals(s.calls.length,0);
});
Deno.test('invalid contacts and weak passwords fail before creating any identity',async()=>{
 for(const [patch,code] of [[{name:'X'},'INVALID_NAME'],[{phone:'123'},'INVALID_PHONE'],[{password:'weak'},'WEAK_PASSWORD']] as const) {
 const s=setup();const r=await s.call({action:'accept',id,token:secret,name:'New Barber',phone:'59997321',countryCode:'+965',password:'Synthetic12!',...patch},'');assertEquals(r.body.error,code);assertEquals(s.created(),0);
 }
});
Deno.test('acceptance sends only a hashed token and new identity to the atomic routine',async()=>{
 const s=setup();const r=await s.call({action:'accept',id,token:secret,name:'New Barber',phone:'59997321',countryCode:'+965',password:'Synthetic12!'},'');assertEquals(r.status,200);assertEquals(s.created(),1);
 const accept=s.calls.find(x=>x.action==='accept')!;assertEquals(accept.data.new_user,'new-user');assert(!JSON.stringify(s.calls).includes(secret));
});
Deno.test('existing customers require their live session and are never recreated',async()=>{
 const s=setup({rpc:async action=>action==='resolve'?{kind:'customer',signed_in:false,email:'customer@example.test'}:{}});
 assertEquals((await s.call({action:'accept',id,token:secret},'')).status,401);assertEquals(s.created(),0);
 const accepted=setup({rpc:async action=>action==='resolve'?{kind:'customer',signed_in:true,email:'customer@example.test'}:{accepted:true}});
 assertEquals((await accepted.call({action:'accept',id,token:secret})).status,200);assertEquals(accepted.created(),0);
});
Deno.test('delivery failures are visible and resend never recreates an account',async()=>{
 const s=setup({mail:async()=>{throw Error('private transport error');}});const r=await s.call({action:'resend',id});assertEquals(r.body.delivered,false);assertEquals(s.created(),0);assertEquals(s.calls[1].data.delivery,'failed');
 assert(!JSON.stringify(r.body).includes('private transport'));
});
Deno.test('private failures, stale tokens and old destructive calls are bounded',async()=>{
 const s=setup({rpc:async()=>{throw Error('PRIVATE_SQL_OR_SECRET');}});assertEquals((await s.call({action:'resolve',id,token:secret},'')).body.error,'UNAVAILABLE');
 assertEquals((await s.call({barberId:id,email:'legacy@example.test'})).body.error,'LEGACY_INVITE');
 const limited=setup({limit:async()=>false});assertEquals((await limited.call({action:'resolve',id,token:secret},'')).status,429);
});
Deno.test('interrupted setup retries the original identity without creating or resetting it',async()=>{
 const actions:string[]=[];
 const s=setup({rpc:async(action,data)=>{actions.push(action);if(action==='resolve')return{kind:'new',setup_user:'existing-setup-user',email:'new@example.test'};assertEquals(data.new_user,'existing-setup-user');return{accepted:true};}});
 assertEquals((await s.call({action:'accept',id,token:secret,name:'New Barber',phone:'59997321',countryCode:'+965',password:'Synthetic12!'},'')).status,200);assertEquals(s.created(),0);assertEquals(actions,['resolve','accept']);
});
Deno.test('a competing signup is reconciled only when the server returns that invitation setup identity',async()=>{
 let resolveCount=0;
 const s=setup({createUser:async()=>{throw Error('conflict');},rpc:async action=>action==='resolve'?{kind:'new',email:'new@example.test',...(++resolveCount>2?{setup_user:'competing-setup'}:{})}:{accepted:true}});
 assertEquals((await s.call({action:'accept',id,token:secret,name:'New Barber',phone:'59997321',countryCode:'+965',password:'Synthetic12!'},'')).status,200);
});
