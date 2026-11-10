import {bookingEmail,type BookingEmailJob,type Email} from './message.ts';
type Configuration={enabled:boolean;apiUrl:string;secret:string};
type Dependencies={environment:string;appUrl:string;apiUrl:string;configuration:()=>Promise<Configuration|null>;
 claim:()=>Promise<BookingEmailJob[]>;validate:(job:BookingEmailJob)=>Promise<boolean>;
 finish:(job:BookingEmailJob,status:number,providerId:string)=>Promise<void>;
 capture:(id:string,email:Email)=>Promise<string>;send:(id:string,email:Email)=>Promise<{status:number;id:string}>};
async function equal(a:string,b:string){
 const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const[x,y]=await Promise.all([hash(a),hash(b)]);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0;
}
export function createBookingEmailHandler(deps:Dependencies){return async(req:Request)=>{
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 const secret=req.headers.get('x-booking-email-secret')||'';
 if(req.method!=='POST'||!/^[0-9a-f]{64}$/.test(secret))return reply(403,{error:'FORBIDDEN'});
 const test=deps.environment==='cloud-test'&&deps.apiUrl==='https://qvkucvcjmojjbphlzlks.supabase.co'&&deps.appUrl==='https://barber-test.alabdullah-cs.workers.dev';
 const prod=deps.environment==='production'&&deps.apiUrl==='https://srv1073968.hstgr.cloud'&&deps.appUrl==='https://www.barberplusplus.com';
 if(!test&&!prod)return reply(503,{error:'NOT_CONFIGURED'});
 try{
  const cfg=await deps.configuration();
  if(!cfg||!await equal(secret,cfg.secret||''))return reply(403,{error:'FORBIDDEN'});
  if(!cfg.enabled||cfg.apiUrl!==deps.apiUrl)return reply(503,{error:'NOT_CONFIGURED'});
  const jobs=await deps.claim();let accepted=0,failed=0;
  for(const job of jobs){
   if(!await deps.validate(job)){await deps.finish(job,410,'');continue;}
   const email=bookingEmail(job,deps.appUrl);
   let result;
   try{result=test?{status:200,id:await deps.capture(job.id,email)}:await deps.send(job.id,email);}
   catch{result={status:503,id:''};}
   await deps.finish(job,result.status,result.id);
   if(result.status===200)accepted++;else failed++;
  }
  return reply(200,{claimed:jobs.length,accepted,failed});
 }catch{return reply(503,{error:'EMAIL_UNAVAILABLE'});}
};}
