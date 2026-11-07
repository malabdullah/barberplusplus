type Data = Record<string, unknown>;
export type InviteDependencies = {
 appUrl: string;
 rpc: (action: string, data: Data) => Promise<Data>;
 identity: (token: string) => Promise<{user_id:string;session_id:string} | null>;
 limit: (key:string,max:number) => Promise<boolean>;
 createUser: (data:{email:string;password:string;name:string;phone:string;invitation:string}) => Promise<string>;
 mail: (email:string,shop:string,link:string) => Promise<void>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const phonePattern = /^\+(965[569]\d{7}|9665\d{8}|9715\d{8}|973\d{8}|974[3567]\d{7}|968[79]\d{7})$/;
const known = new Set(['AUTH_REQUIRED','FORBIDDEN','INVALID_EMAIL','EMAIL_UNAVAILABLE','CUSTOMER_CONFIRMATION_REQUIRED','INVITE_EXISTS','RATE_LIMITED','INVITE_INVALID','INVITE_USED','INVITE_CANCELLED','INVITE_EXPIRED','INVALID_REQUEST','INVALID_NAME','INVALID_PHONE','WEAK_PASSWORD','INVALID_LOGIN','ACCOUNT_CHANGED','PHONE_IN_USE','PHONE_REGISTRATION_CONFLICT','EMAIL_DELIVERY_FAILED','LEGACY_INVITE']);
export const digest = async (s:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');

export function createInviteHandler(deps:InviteDependencies) {
 return async (req:Request) => {
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':deps.appUrl,'Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  const reply=(status:number,body:Data)=>Response.json(body,{status,headers});
  if(req.headers.get('origin') && req.headers.get('origin')!==deps.appUrl)return reply(403,{error:'FORBIDDEN'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'INVALID_REQUEST'});
  try {
   const reader=req.body?.getReader();if(!reader)return reply(400,{error:'INVALID_REQUEST'});
   let text='';const decoder=new TextDecoder();let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();return reply(413,{error:'INVALID_REQUEST'});}text+=decoder.decode(value,{stream:true});}
   let body:Data;try{body=JSON.parse(text);}catch{return reply(400,{error:'INVALID_REQUEST'});}
   if(!body || typeof body!=='object' || Array.isArray(body))return reply(400,{error:'INVALID_REQUEST'});
   if(body.barberId)return reply(409,{error:'LEGACY_INVITE'});
   const action=String(body.action || '');
   if(!['check','send','resend','cancel','list','resolve','accept'].includes(action))return reply(400,{error:'INVALID_REQUEST'});
   const ip=req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
   if(!await deps.limit(await digest('barber-invite:'+ip+':'+action),action==='resolve'?100:30))return reply(429,{error:'RATE_LIMITED'});
   const bearer=req.headers.get('authorization')?.replace(/^Bearer /i,'') || '';
   const identity=bearer?await deps.identity(bearer):null;
   const actor={actor:identity?.user_id,session:identity?.session_id};
   if(['check','send','resend','cancel','list'].includes(action)) {
    if(!identity)return reply(401,{error:'AUTH_REQUIRED'});
    const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
    const branch=String(body.branchId || '');const id=String(body.id || '');
    if(['check','send'].includes(action) && (!emailPattern.test(email) || email.length>254))return reply(400,{error:'INVALID_EMAIL'});
    if(['check','send','list'].includes(action) && !uuid.test(branch))return reply(400,{error:'INVALID_REQUEST'});
    if(['resend','cancel'].includes(action) && !uuid.test(id))return reply(400,{error:'INVALID_REQUEST'});
    const secret=['send','resend'].includes(action)?token():'';
    const hash=secret?await digest(secret):undefined;
    const result=await deps.rpc(action,{...actor,branch_id:branch || undefined,id:id || undefined,email,confirm_customer:body.confirmCustomer===true,offset:Math.max(0,Math.min(Math.trunc(Number(body.offset))||0,10000)),token_hash:hash});
    if(hash) {
     const link=new URL('/accept-invite',deps.appUrl);link.searchParams.set('invitation',String(result.id));link.hash=new URLSearchParams({token:secret}).toString();
     let delivered=true;
     try {await deps.mail(String(result.email),String(result.shop),link.href);}catch {delivered=false;}
     await deps.rpc('delivery',{id:result.id,token_hash:hash,delivery:delivered?'sent':'failed'});
     return reply(200,{id:result.id,delivered,expiresAt:result.expires_at});
    }
    return reply(200,result);
   }
   const id=String(body.id || '');const secret=String(body.token || '');
   if(!uuid.test(id) || !/^[0-9a-f]{64}$/.test(secret))return reply(400,{error:'INVITE_INVALID'});
   const hash=await digest(secret);
   const invitation=await deps.rpc('resolve',{...actor,id,token_hash:hash});
   if(action==='resolve') {
    const {setup_user:_setup,...safe}=invitation;return reply(200,safe);
   }
   let newUser:string | undefined;
   if(invitation.kind==='new') {
    const name=typeof body.name==='string'?body.name.trim():'';
    const phone=String(body.countryCode || '')+String(body.phone || '').replace(/[\s()-]/g,'');
    const password=body.password;
    if(name.length<2 || name.length>120)return reply(400,{error:'INVALID_NAME'});
    if(!phonePattern.test(phone))return reply(400,{error:'INVALID_PHONE'});
    if(typeof password!=='string' || password.length<8 || new TextEncoder().encode(password).length>72 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^\w\s]/.test(password))return reply(400,{error:'WEAK_PASSWORD'});
    newUser=invitation.setup_user?String(invitation.setup_user):undefined;
    if(!newUser) {
     await deps.rpc('resolve',{...actor,id,token_hash:hash,phone:body.phone,country_code:body.countryCode});
     try {newUser=await deps.createUser({email:String(invitation.email),password,name,phone,invitation:id});}
     catch {
      // Reconcile a competing submission; never replace or reset an account.
      const current=await deps.rpc('resolve',{...actor,id,token_hash:hash});
      if(!current.setup_user)throw Error('ACCOUNT_CHANGED');newUser=String(current.setup_user);
     }
    }
   } else if(!identity || !invitation.signed_in) return reply(401,{error:'AUTH_REQUIRED'});
   return reply(200,await deps.rpc('accept',{...actor,id,token_hash:hash,new_user:newUser,name:body.name,phone:body.phone,country_code:body.countryCode,password:newUser?body.password:undefined}));
  } catch(failure) {
   const raw=failure instanceof Error?failure.message:'';
   const code=raw.includes('PHONE_IN_USE')?'PHONE_IN_USE':known.has(raw)?raw:'UNAVAILABLE';
   const status=code==='AUTH_REQUIRED'?401:code==='FORBIDDEN'?403:code==='RATE_LIMITED'?429:code==='UNAVAILABLE'?503:409;
   return reply(status,{error:code});
  }
 };
}
