import {createBookingShareHandler, tokenHash} from './handler.ts';
const assert=(v:unknown,message='Assertion failed')=>{if(!v)throw Error(message);};
const origin='http://localhost:5173',secret='only-a-synthetic-test-secret-not-a-credential';
const bookingId='bb110000-0000-4000-8000-000000000001';
function setup(){
 const calls:{action:string;data:Record<string,unknown>}[]=[];let saved:Record<string,unknown>|null=null;
 const handler=createBookingShareHandler({environment:'test',appUrl:origin,publicUrl:'http://localhost:55321',secret,
  identity:token=>Promise.resolve(token==='owner'?{user_id:'owner-id',session_id:'live-session'}:null),
  rpc:(action,data)=>{calls.push({action,data});if(action==='create'){saved||=data;return Promise.resolve({...saved,expiresAt:'2027-01-02T12:00:00Z'});}if(action==='view'){if(!saved||data.hash!==saved.hash)throw Error('LINK_UNAVAILABLE');return Promise.resolve({date:'2027-01-01',time:'12:00',status:'confirmed'});}saved=null;return Promise.resolve({sharing:false});}});
 const request=(body:unknown,token='owner',headers={})=>handler(new Request(origin,{method:'POST',headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify(body)}));
 return {request,calls,handler};
}
Deno.test('share URL uses a stable independent token fragment; no booking identity or contacts in URL',async()=>{
 const s=setup();const result=await(await s.request({action:'create',bookingId,email:'secret@example.test',notes:'private',user_id:'forged'})).json();
 const url=new URL(result.url);assert(url.pathname==='/booking/share'&&!url.search&&/^#[a-f0-9]{64}$/.test(url.hash));
 assert(!result.url.includes(bookingId)&&!result.url.includes('secret'));assert(s.calls[0].data.user_id==='owner-id');
 assert(!('email'in s.calls[0].data)&&!('notes'in s.calls[0].data));
 const again=await(await s.request({action:'create',bookingId})).json();assert(again.url===result.url);
 const viewed=await s.request({action:'view',token:url.hash.slice(1)},'');assert(viewed.status===200);
 assert(viewed.headers.get('cache-control')==='private, no-store');assert(viewed.headers.get('referrer-policy')==='no-referrer');
 assert(s.calls.at(-1)?.data.hash===await tokenHash(url.hash.slice(1)));
});
Deno.test('revoke invalidates old URL; new sharing creates an independent token',async()=>{
 const s=setup();const old=await(await s.request({action:'create',bookingId})).json();
 assert((await s.request({action:'revoke',bookingId})).status===200);
 assert((await s.request({action:'view',token:new URL(old.url).hash.slice(1)},'')).status===404);
 const next=await(await s.request({action:'create',bookingId})).json();assert(next.url!==old.url);
});
Deno.test('anonymous or stale customer cannot mint or revoke a link, body cannot impersonate identity',async()=>{
 for(const action of ['create','revoke'])for(const token of ['', 'expired']){
  const s=setup();assert((await s.request({action,bookingId,user_id:'owner-id',session_id:'live-session'},token)).status===401);assert(!s.calls.length);
 }
});
Deno.test('bad origins, unsupported methods, invalid tokens, oversize and malformed bodies fail before database',async()=>{
 const s=setup();assert((await s.request({action:'create',bookingId},'owner',{Origin:'https://foreign.example'})).status===403);
 assert((await s.handler(new Request(origin,{method:'GET'}))).status===405);
 for(const token of ['short','g'.repeat(64),'0'.repeat(65)])assert((await s.request({action:'view',token},'')).status===404);
 assert((await s.request({action:'create',bookingId,padding:'x'.repeat(7000)})).status===413);
 assert((await s.handler(new Request(origin,{method:'POST',headers:{Origin:origin},body:'broken'}))).status===400);assert(!s.calls.length);
});
async function sealed(proof:Record<string,unknown>){
 const encode=(a:Uint8Array)=>btoa(String.fromCharCode(...a)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 const e=new TextEncoder();const payload=encode(e.encode(JSON.stringify(proof)));
 const key=await crypto.subtle.importKey('raw',e.encode('customer-booking-test-v1:'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return payload+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,e.encode(payload))));
}
Deno.test('guest sharing accepts only valid original sealed receipt and forwards whitelisted bound fields',async()=>{
 const s=setup(),proof={purpose:'receipt',id:bookingId,expires:Date.now()+60000,guest_contact:'email',email:'guest@example.test',phone:'',country_code:'+965',name:'PRIVATE',notes:'PRIVATE'};
 const receipt=await sealed(proof);assert((await s.request({action:'create',bookingId,receipt},'')).status===200);
 const forwarded=s.calls[0].data.receipt as Record<string,unknown>;assert(forwarded.email===proof.email&&!('name'in forwarded)&&!('notes'in forwarded));
 for(const changed of [{...proof,purpose:'verified'},{...proof,expires:Date.now()-1},{...proof,user_id:'owner'},{...proof,id:'bb110000-0000-4000-8000-000000000002'}]){
  assert((await setup().request({action:'create',bookingId,receipt:await sealed(changed)},'')).status===403);
 }
 assert((await setup().request({action:'create',bookingId,receipt:receipt.slice(0,-8)+'tampered'},'')).status===403);
});
Deno.test('SQL ownership denial is generic and operational errors do not echo secrets',async()=>{
 for(const message of ['LINK_UNAVAILABLE','AUTH_REQUIRED','private SQL failure with secret']){
  const handler=createBookingShareHandler({environment:'test',appUrl:origin,publicUrl:'http://localhost:55321',secret,identity:()=>Promise.resolve({user_id:'id',session_id:'id'}),rpc:()=>{throw Error(message);}});
  const response=await handler(new Request(origin,{method:'POST',headers:{Origin:origin,Authorization:'Bearer owner'},body:JSON.stringify({action:'create',bookingId})}));
  assert(response.status===(message==='LINK_UNAVAILABLE'?404:message==='AUTH_REQUIRED'?401:503));assert(!(await response.text()).includes('secret'));
 }
});
