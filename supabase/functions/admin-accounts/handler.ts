import {digest} from '../invite-barber/handler.ts';
type Data=Record<string,unknown>;
export type Dependencies={
 appUrl:string;
 manage:(token:string,action:string,data:Data)=>Promise<Data>;
 service:(action:string,data:Data)=>Promise<Data>;
 create:(data:{email:string;name:string;password:string;invitation:string})=>Promise<string>;
 remove:(id:string)=>Promise<void>;
 mail:(email:string,name:string,link:string,key:string)=>Promise<void>;
 limit:(key:string,max:number)=>Promise<boolean>;
};
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const codes=['SUPER_ADMIN_REQUIRED','AUTH_REQUIRED','ADMIN_MFA_REQUIRED','SESSION_ENDED','PROTECTED_ADMIN_ACCOUNT','EMAIL_IN_USE','INVALID_DETAILS','INVITE_EXISTS','RATE_LIMITED','INVITE_PROCESSING','INVITE_INVALID','INVITE_USED','INVITE_CANCELLED','INVITE_EXPIRED','WEAK_PASSWORD','ADMIN_DELETION_PENDING'];
export function createAdminAccountsHandler(deps:Dependencies){
 return async(req:Request)=>{
  const headers={'Cache-Control':'no-store','Content-Type':'application/json','Access-Control-Allow-Origin':deps.appUrl,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
  const reply=(status:number,data:Data)=>Response.json(data,{status,headers});
  if(req.headers.get('origin')&&req.headers.get('origin')!==deps.appUrl)return reply(403,{error:'FORBIDDEN'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'INVALID_REQUEST'});
  try{
   const reader=req.body?.getReader();if(!reader)return reply(400,{error:'INVALID_REQUEST'});
   let size=0;const chunks:Uint8Array[]=[];while(true){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>8192){await reader.cancel();return reply(413,{error:'INVALID_REQUEST'});}chunks.push(v.value);}
   const bytes=new Uint8Array(size);let at=0;for(const v of chunks){bytes.set(v,at);at+=v.length;}
   let body:Data;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply(400,{error:'INVALID_REQUEST'});}
   if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'INVALID_REQUEST'});
   const action=String(body.action||'');
   if(!['invite','resend','resolve','accept','delete'].includes(action))return reply(400,{error:'INVALID_REQUEST'});
   const ip=req.headers.get('x-real-ip')||'unknown';
   if(!await deps.limit(await digest('admin-accounts:'+ip+':'+action),action==='resolve'?60:20))return reply(429,{error:'RATE_LIMITED'});
   const token=req.headers.get('authorization')?.replace(/^Bearer /i,'')||'';
   if(['invite','resend','delete'].includes(action)){
    if(!token)return reply(401,{error:'AUTH_REQUIRED'});
    if(action==='delete'){
     if(!uuid.test(String(body.userId)))return reply(400,{error:'INVALID_REQUEST'});
     const job=await deps.manage(token,'delete-prepare',{userId:body.userId});
     if(job.finished)return reply(200,{success:true});
     if(job.authDeleted)return reply(200,await deps.service('delete-finish',job));
     try{await deps.remove(String(job.userId));}
     catch{
      // A response may be lost after Auth completed. Verify instead of deleting twice.
      try{return reply(200,await deps.service('delete-finish',job));}catch{return reply(503,{error:'ADMIN_DELETION_PENDING'});}
     }
     return reply(200,await deps.service('delete-finish',job));
    }
    if(action==='resend'&&!uuid.test(String(body.id)))return reply(400,{error:'INVALID_REQUEST'});
    const secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
    const hash=await digest(secret);
    const invitation=await deps.manage(token,action,{id:body.id,name:body.name,email:body.email,tokenHash:hash});
    const link=new URL('/accept-admin-invite',deps.appUrl);link.searchParams.set('invitation',String(invitation.id));link.hash=new URLSearchParams({token:secret}).toString();
    let delivered=true;
    try{await deps.mail(String(invitation.email),String(invitation.name),link.href,String(invitation.id)+'/'+hash);}catch{delivered=false;}
    await deps.service('delivery',{id:invitation.id,tokenHash:hash,delivery:delivered?'sent':'failed'});
    return reply(200,{success:true,delivered});
   }
   const id=String(body.id||''),secret=String(body.token||'');
   if(!uuid.test(id)||!/^[a-f0-9]{64}$/.test(secret))return reply(400,{error:'INVITE_INVALID'});
   const data={id,tokenHash:await digest(secret)};
   if(action==='resolve')return reply(200,await deps.service('resolve',data));
   const password=body.password;
   if(typeof password!=='string'||password.length<12||new TextEncoder().encode(password).length>72||!/[A-Z]/.test(password)||!/[a-z]/.test(password)||!/[0-9]/.test(password)||!/[!@#$%^&*(),.?":{}|<>]/.test(password))return reply(400,{error:'WEAK_PASSWORD'});
   const setup=await deps.service('prepare',data);
   try{
    let userId=setup.setupUser?String(setup.setupUser):'';
    if(!userId)userId=await deps.create({email:String(setup.email),name:String(setup.name),password,invitation:id});
    return reply(200,await deps.service('finish',{...data,operation:setup.operation,userId,password}));
   }catch(error){
    try{await deps.service('release',{...data,operation:setup.operation});}catch{/* The short lease also bounds interrupted attempts. */}
    throw error;
   }
  }catch(error){
   const raw=error instanceof Error?error.message:'';
   const code=codes.find(c=>raw.includes(c))||'UNAVAILABLE';
   return reply(['AUTH_REQUIRED','SESSION_ENDED'].includes(code)?401:['SUPER_ADMIN_REQUIRED','ADMIN_MFA_REQUIRED','PROTECTED_ADMIN_ACCOUNT'].includes(code)?403:code==='RATE_LIMITED'?429:code==='UNAVAILABLE'?503:409,{error:code});
  }
 };
}
