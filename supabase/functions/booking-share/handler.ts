import {customerRuntime} from '../_shared/customer-runtime.ts';
type Data=Record<string,unknown>;
type Dependencies={environment:string;appUrl:string;publicUrl:string;secret:string;productionEnabled?:boolean;
 cloudTestProjectRef?:string;cloudAccessKey?:string;
 identity:(token:string)=>Promise<{user_id:string;session_id:string}|null>;
 rpc:(action:string,data:Data)=>Promise<Data>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
export async function tokenHash(value:string){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
export function createBookingShareHandler(deps:Dependencies){
 const runtime=customerRuntime(deps);
 const key=crypto.subtle.importKey('raw',encoder.encode('booking-share-link-v1:'+deps.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const tokenFor=async(id:string,nonce:string)=>hex(await crypto.subtle.sign('HMAC',await key,encoder.encode(id+':'+nonce)));
 async function receipt(value:unknown):Promise<Data|null>{
  if(typeof value!=='string'||value.length>3000)return null;
  try{
   const[payload,signature,extra]=value.split('.');if(!payload||!signature||extra)return null;
   const decode=(s:string)=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
   const signing=await crypto.subtle.importKey('raw',encoder.encode('customer-booking-test-v1:'+deps.secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
   if(!await crypto.subtle.verify('HMAC',signing,decode(signature),encoder.encode(payload)))return null;
   const p=JSON.parse(new TextDecoder().decode(decode(payload)));
   if(p.purpose!=='receipt'||p.user_id||!Number.isFinite(p.expires)||p.expires<=Date.now()||!uuid.test(p.id))return null;
   return {id:p.id,guest_contact:p.guest_contact,email:p.email,phone:p.phone,country_code:p.country_code};
  }catch{return null;}
 }
 return async(req:Request)=>{
  const allowed=await runtime.allows(req);const origin=req.headers.get('origin');
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive',
   'Access-Control-Allow-Origin':allowed&&origin?origin:deps.appUrl,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  const reply=(status:number,data:unknown)=>Response.json(data,{status,headers});
  if(!runtime.enabled)return reply(404,{error:'NOT_AVAILABLE'});
  if(!allowed)return reply(403,{error:'FORBIDDEN'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'INVALID_REQUEST'});
  try{
   // Bounded parsing; never log request bodies, bearers, receipts or link tokens.
   const reader=req.body?.getReader();if(!reader)return reply(400,{error:'INVALID_REQUEST'});
   const chunks:Uint8Array[]=[];let size=0;
   while(true){const{value,done}=await reader.read();if(done)break;size+=value.length;if(size>6144){await reader.cancel();return reply(413,{error:'INVALID_REQUEST'});}chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
   let body:Data;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply(400,{error:'INVALID_REQUEST'});}
   if(!body||Array.isArray(body)||!['create','revoke','view'].includes(String(body.action)))return reply(400,{error:'INVALID_REQUEST'});
   const action=String(body.action);
   if(action==='view'){
    if(typeof body.token!=='string'||!/^[0-9a-f]{64}$/.test(body.token))return reply(404,{error:'LINK_UNAVAILABLE'});
    return reply(200,{booking:await deps.rpc('view',{hash:await tokenHash(body.token)})});
   }
   if(!uuid.test(String(body.bookingId)))return reply(400,{error:'INVALID_REQUEST'});
   let auth:Data;
   if(body.receipt){const proof=await receipt(body.receipt);if(!proof||proof.id!==body.bookingId)return reply(403,{error:'LINK_UNAVAILABLE'});auth={receipt:proof};}
   else{const bearer=req.headers.get('authorization')?.replace(/^Bearer /i,'')||'';const identity=bearer?await deps.identity(bearer):null;if(!identity)return reply(401,{error:'AUTH_REQUIRED'});auth=identity;}
   const id=crypto.randomUUID(),nonce=crypto.randomUUID(),candidate=await tokenFor(id,nonce);
   const result=await deps.rpc(action,{...auth,booking_id:body.bookingId,id,nonce,hash:await tokenHash(candidate)});
   if(action==='revoke')return reply(200,{sharing:false});
   if(!uuid.test(String(result.id))||!uuid.test(String(result.nonce)))throw Error('UNAVAILABLE');
   const token=await tokenFor(String(result.id),String(result.nonce));if(await tokenHash(token)!==result.hash)throw Error('UNAVAILABLE');
   // Fragment tokens never enter page access logs, HTTP referrers or chat metadata.
   return reply(200,{url:new URL('/booking/share#'+token,deps.appUrl).href,expiresAt:result.expiresAt});
  }catch(error){
   const name=error instanceof Error?error.message:'';
   if(/LINK_UNAVAILABLE/.test(name))return reply(404,{error:'LINK_UNAVAILABLE'});
   if(/AUTH_REQUIRED/.test(name))return reply(401,{error:'AUTH_REQUIRED'});
   return reply(503,{error:'UNAVAILABLE'});
  }
 };
}
