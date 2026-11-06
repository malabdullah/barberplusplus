import { registrationReceipt } from './registration.ts';
type Data = Record<string, unknown>;
export type EmailManagementDependencies = {
  correct: (input: { email: string; newEmail: string; password: string; audience: string }) => Promise<{ id: string; email: string; verified: boolean }>;
  deliver: (email: string, audience: string, returnTo: string) => Promise<void>;
  admin: (token: string, action: string, data: Data) => Promise<unknown>;
};
const address = (input: unknown) => typeof input === 'string' ? input.trim().toLowerCase() : '';
const valid = (email: string) => email.length<=254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
export async function emailManagementAction(c: { action: string; body: Data; token: string; ip: string; secret: string; appUrl: string; deps: EmailManagementDependencies; limit: (key:string,max:number)=>Promise<boolean> }) {
  const reply = (status:number,body:unknown)=>({status,body});
  try {
    if (c.action==='correct-registration-email') {
      const email=address(c.body.email);const newEmail=address(c.body.newEmail);
      const audience=c.body.audience;const password=c.body.password;
      if (!valid(email) || !valid(newEmail) || email===newEmail || !['customer','team'].includes(String(audience)) || typeof password!=='string' || password.length<8 || new TextEncoder().encode(password).length>72) return reply(400,{error:'INVALID_DETAILS'});
      if (!await c.limit(`email-correction:${email}`,5) || !await c.limit(`email-correction-ip:${c.ip}`,20)) return reply(429,{error:'RATE_LIMITED'});
      const changed=await c.deps.correct({email,newEmail,password,audience:String(audience)});
      let delivered=true;
      try { await c.deps.deliver(changed.email,String(audience),c.body.returnTo==='/book'?'/book':'/customer/account'); } catch { delivered=false; }
      return reply(200,{success:true,email:changed.email,confirmationRequired:true,delivered,
        ...(audience==='team' ? await registrationReceipt(changed.id,changed.email,c.secret,c.appUrl) : {})});
    }
    if (c.action==='admin-email-list' || c.action==='admin-email-change') {
      if (!c.token) return reply(401,{error:'AUTH_REQUIRED'});
      if (c.action==='admin-email-list') {
        if (!Number.isSafeInteger(c.body.page) || Number(c.body.page)<1 || Number(c.body.page)>10000) return reply(400,{error:'INVALID_DETAILS'});
        return reply(200,await c.deps.admin(c.token,'list',{page:c.body.page}));
      }
      const newEmail=address(c.body.newEmail);
      if (!valid(newEmail) || typeof c.body.userId!=='string' || !/^[a-f0-9-]{36}$/i.test(c.body.userId) || typeof c.body.reason!=='string' || c.body.reason.trim().length<8 || c.body.reason.length>500) return reply(400,{error:'INVALID_DETAILS'});
      return reply(200,await c.deps.admin(c.token,'change',{userId:c.body.userId,expectedEmail:address(c.body.expectedEmail),newEmail,reason:c.body.reason.trim()}));
    }
    return reply(400,{error:'INVALID_REQUEST'});
  } catch (failure) {
    const message=failure instanceof Error?failure.message:'';
    const code=['EMAIL_IN_USE','EMAIL_UNCHANGED','EMAIL_CHANGED_REFRESH','EMAIL_ADMIN_ONLY','REGISTRATION_CANNOT_CORRECT','FORBIDDEN','AUTH_REQUIRED','ADMIN_MFA_REQUIRED','SESSION_ENDED','INVALID_EMAIL'].find(code=>message.includes(code));
    return reply(code && ['FORBIDDEN','ADMIN_MFA_REQUIRED','EMAIL_ADMIN_ONLY'].includes(code)?403:code && ['AUTH_REQUIRED','SESSION_ENDED'].includes(code)?401:code?400:503,{error:code || 'UNAVAILABLE'});
  }
}
