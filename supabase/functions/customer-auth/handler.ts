import { customerPushAction } from './push.ts';
import { customerPasswordAction, type PasswordDependencies } from './password.ts';
import { customerRuntime } from '../_shared/customer-runtime.ts';
import { managerRegistrationAction, type RegistrationDependencies } from './registration.ts';
import { emailManagementAction, type EmailManagementDependencies } from './email-management.ts';
type Data = Record<string, unknown>;
type Identity = { user_id: string; session_id: string };
type Dependencies = {
  environment: string; appUrl: string; publicUrl: string; secret: string;
  productionEnabled?: boolean;
  cloudTestProjectRef?: string; cloudAccessKey?: string;
  rpc: (action: string, data: Data) => Promise<unknown>;
  createUser: (data: Data) => Promise<string>;
  deleteUser: (id: string) => Promise<void>;
  signIn: (phone: string, password: string) => Promise<{ session: unknown; identity: Identity } | null>;
  identity: (token: string) => Promise<Identity | null>;
  emailSignup?: (name: string, email: string, password: string, returnTo: string) => Promise<void>;
  emailLink?: (email: string, purpose: 'confirm' | 'recovery', returnTo: string) => Promise<void>;
  emailSignIn?: (email: string, password: string) => Promise<{ session: unknown; identity: Identity; name: string } | null>;
  emailName?: (token: string) => Promise<string>;
  socialIdentity?: (token: string) => Promise<(Identity & { name?: string }) | null>;
  resetPassword: (id: string, password: string, guardId?: string) => Promise<void>;
  passwords?: PasswordDependencies;
  registration?: RegistrationDependencies;
  emailManagement?: EmailManagementDependencies;
};
const patterns: Record<string, RegExp> = { '+965': /^[569]\d{7}$/, '+966': /^5\d{8}$/, '+971': /^5\d{8}$/, '+973': /^\d{8}$/, '+974': /^[3567]\d{7}$/, '+968': /^[79]\d{7}$/ };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validRating = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
const strong = (s: unknown): s is string => typeof s === 'string' && s.length >= 8 && new TextEncoder().encode(s).length <= 72 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[^\w\s]/.test(s);
const contact = (body: Data) => {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  return name.length >= 2 && name.length <= 120 && email.length <= 254 && (!email || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) ? {name,email} : null;
};
export function createCustomerAuthHandler(deps: Dependencies) {
  const runtime = customerRuntime(deps);
  const enabled = runtime.enabled;
  const key = enabled ? crypto.subtle.importKey('raw', new TextEncoder().encode(`customer-auth-test-v1:${deps.secret}`), {name:'HMAC',hash:'SHA-256'},false,['sign']) : null;
  const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',await key!,new TextEncoder().encode(value))), x=>x.toString(16).padStart(2,'0')).join('');
  return async (req: Request) => {
    const origin = req.headers.get('origin');
    const allowed = await runtime.allows(req);
    const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':allowed && origin ? origin : deps.appUrl,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
    const reply = (status: number, data: unknown) => new Response(JSON.stringify(data),{status,headers});
    if (!enabled) return reply(404,{error:'NOT_AVAILABLE'});
    if (!allowed) return reply(403,{error:'FORBIDDEN'});
    if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
    if (req.method!=='POST') return reply(405,{error:'INVALID_REQUEST'});
    try {
      const reader=req.body?.getReader(); if (!reader) return reply(400,{error:'INVALID_REQUEST'});
      const chunks: Uint8Array[]=[]; let size=0;
      while (true) {const {value,done}=await reader.read(); if(done) break; size+=value.length; if(size>8192) {await reader.cancel();return reply(413,{error:'INVALID_REQUEST'});} chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      let body: Data;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply(400,{error:'INVALID_REQUEST'});}
      if(!body || typeof body!=='object' || Array.isArray(body)) return reply(400,{error:'INVALID_REQUEST'});
      const action=String(body.action);
      if (['correct-registration-email','admin-email-list','admin-email-change'].includes(action)) {
        if (!deps.emailManagement) return reply(404,{error:'NOT_AVAILABLE'});
        const result=await emailManagementAction({action,body,token:req.headers.get('authorization')?.replace(/^Bearer /i,'') || '',ip:req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'local',secret:deps.secret,appUrl:deps.appUrl,deps:deps.emailManagement,
          limit:async(value,max)=>Boolean(await deps.rpc('limit',{key:await hash(value),max}))});
        return reply(result.status,result.body);
      }
      if (action.startsWith('manager-')) {
        if (!deps.registration) return reply(404, { error: 'NOT_AVAILABLE' });
        const result = await managerRegistrationAction({ action, body, ip: req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'local', secret: deps.secret, appUrl: deps.appUrl,
          limit: async (value, max) => Boolean(await deps.rpc('limit', { key: await hash(value), max })), deps: deps.registration });
        return result ? reply(result.status, result.body) : reply(400, { error: 'INVALID_REQUEST' });
      }
      if (action.startsWith('push-')) {
        const ip=req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
        if (!await deps.rpc('limit',{key:await hash(`push:${ip}`),max:100})) return reply(429,{error:'RATE_LIMITED'});
        return reply(200,await customerPushAction(deps,req,body));
      }
      if (deps.passwords) {
        const result = await customerPasswordAction({
          action,body,token:req.headers.get('authorization')?.replace(/^Bearer /i,'') || '',
          ip:req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'local',
          environment:deps.environment,appUrl:deps.appUrl,identity:deps.identity,
          limit:async(value,max)=>Boolean(await deps.rpc('limit',{key:await hash(value),max})),deps:deps.passwords,
        });
        if (result) return reply(result.status,result.body);
      }
      if (action==='email-reset' || action.startsWith('password-')) return reply(400,{error:'PASSWORD_PROOF_REQUIRED'});

      if (['email-signup','email-resend','email-recovery','email-login'].includes(action)) {
        const email=typeof body.email==='string' ? body.email.trim().toLowerCase() : '';
        if (email.length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return reply(400,{error:'INVALID_DETAILS'});
        const ip=req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
        if(!await deps.rpc('limit',{key:await hash(`email:${action}:${email}`),max:action==='email-login'?10:5}) || !await deps.rpc('limit',{key:await hash(`ip:${action}:${ip}`),max:100}))return reply(429,{error:'RATE_LIMITED'});
        if(action==='email-login') {
          if(typeof body.password!=='string' || !body.password || new TextEncoder().encode(body.password).length>72)return reply(401,{error:'INVALID_LOGIN'});
          const result=await deps.emailSignIn?.(email,body.password);
          if(!result)return reply(401,{error:'INVALID_LOGIN'});
          const profile=await deps.rpc('email-ensure',{...result.identity,name:result.name});
          if(!profile || (profile as Data).needsName)return reply(400,{error:'ACCOUNT_UNAVAILABLE'});
          return reply(200,{session:result.session,profile});
        }
        if(action==='email-signup') {
          const name=typeof body.name==='string' ? body.name.trim() : '';
          if(name.length<2 || name.length>120)return reply(400,{error:'INVALID_DETAILS'});
          if(!strong(body.password))return reply(400,{error:'WEAK_PASSWORD'});
          if(!deps.emailSignup)throw Error('UNAVAILABLE');
          if(body.client==='ios' && (!uuid.test(String(body.nativeState)) || !['production','cloud-test'].includes(deps.environment))) return reply(400,{error:'INVALID_REQUEST'});
          await deps.emailSignup(name,email,body.password,body.client==='ios'?`native:${body.nativeState}`:body.returnTo==='/book'?'book':'account');
        } else {
          if(!deps.emailLink)throw Error('UNAVAILABLE');
          if(body.client==='ios' && (!uuid.test(String(body.nativeState)) || !['production','cloud-test'].includes(deps.environment))) return reply(400,{error:'INVALID_REQUEST'});
          await deps.emailLink(email,action==='email-resend'?'confirm':'recovery',body.client==='ios'?`native:${body.nativeState}`:body.returnTo==='/book'?'book':'account');
        }
        return reply(200,{success:true});
      }
      if (action==='email-ensure') {
        const token=req.headers.get('authorization')?.replace(/^Bearer /i,'') || '';
        const identity=await deps.identity(token);
        if(!identity)return reply(401,{error:'AUTH_REQUIRED'});
        if(action==='email-ensure') {
          const supplied=typeof body.name==='string'?body.name.trim():'';
          const name=supplied || await deps.emailName?.(token) || '';
          return reply(200,{profile:await deps.rpc('email-ensure',{...identity,name})});
        }
      }
      if (['social-code','social-complete'].includes(action)) return reply(404,{error:'NOT_AVAILABLE'});
      let social: (Identity & {name?: string}) | null = null;
      if (['social-status','social-code','social-complete'].includes(action)) {
        const token=req.headers.get('authorization')?.replace(/^Bearer /i,'') || '';
        social=await deps.socialIdentity?.(token) || null;
        if (!social) return reply(401,{error:'AUTH_REQUIRED'});
        const status=await deps.rpc('social-status',social) as Data;
        if (action==='social-status') return reply(200,{...status,name:social.name || ''});
      }
      if (['favourites-list','favourites-save','favourites-remove'].includes(action)) {
        const token=req.headers.get('authorization')?.replace(/^Bearer /i,'') || '';
        const identity=await deps.identity(token);
        if(!identity)return reply(401,{error:'AUTH_REQUIRED'});
        if(action!=='favourites-list' && (!['shop','barber'].includes(String(body.kind)) || !uuid.test(String(body.targetId))))return reply(400,{error:'INVALID_REQUEST'});
        return reply(200,{favourites:await deps.rpc(action,{...identity,kind:body.kind,target_id:body.targetId})});
      }
      if (['appointment-slots', 'reschedule-booking', 'cancel-booking'].includes(action)) {
        const identity = await deps.identity(req.headers.get('authorization')?.replace(/^Bearer /i, '') || '');
        if (!identity) return reply(401, { error: 'AUTH_REQUIRED' });
        const { bookingId, date, time, expectedDate, expectedTime } = body;
        const validDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
        const validTime = (value: unknown) => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
        if (typeof bookingId !== 'string' || !uuid.test(bookingId)
          || (action !== 'cancel-booking' && !validDate(date))
          || (action !== 'appointment-slots' && (!validDate(expectedDate) || !validTime(expectedTime)))
          || (action === 'reschedule-booking' && !validTime(time))) return reply(400, { error: 'INVALID_REQUEST' });
        return reply(200, await deps.rpc(action, {
          ...identity, booking_id: bookingId, date, time, expected_date: expectedDate, expected_time: expectedTime,
        }));
      }
      if (action === 'rate-booking') {
        const token = req.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
        const identity = await deps.identity(token);
        if (!identity) return reply(401, { error: 'AUTH_REQUIRED' });
        const { bookingId, shopRating, barberRating, review } = body;
        if (typeof bookingId !== 'string' || !uuid.test(bookingId) ||
          !validRating(shopRating) || !validRating(barberRating) ||
          (review !== undefined && review !== null && (typeof review !== 'string' || Array.from(review.trim()).length > 1000))) {
          return reply(400, { error: 'INVALID_RATING' });
        }
        return reply(200, await deps.rpc(action, {
          ...identity, booking_id: bookingId, shop_rating: shopRating, barber_rating: barberRating,
          ...(review !== undefined ? { review: typeof review === 'string' ? review.trim() : null } : {}),
        }));
      }
      if(['profile','update-profile','bookings','logout'].includes(action)) {
        const token=req.headers.get('authorization')?.replace(/^Bearer /i,'') || '';
        const identity=await deps.identity(token);
        if(!identity) return reply(401,{error:'AUTH_REQUIRED'});
        const profile=await deps.rpc('profile',identity);
        if(action==='profile')return reply(200,{profile});
        if(action==='logout')return reply(200,await deps.rpc('logout',identity));
        if(action==='bookings')return reply(200,{bookings:await deps.rpc('bookings',identity)});
        if (typeof body.email==='string' && body.email.trim().toLowerCase()!==String((profile as Data)?.email || '').toLowerCase()) return reply(403,{error:'EMAIL_ADMIN_ONLY'});
        const details=contact(body);if(!details)return reply(400,{error:'INVALID_DETAILS'});
        let phoneDetails={};
        if ('phone' in body) {
          const phone=typeof body.phone==='string' ? body.phone.replace(/[\s()-]/g,'') : '';
          const countryCode=String(body.countryCode || '');
          if(phone && !patterns[countryCode]?.test(phone))return reply(400,{error:'INVALID_PHONE'});
          phoneDetails={phone,country_code:phone ? countryCode : ''};
        }
        return reply(200,{profile:await deps.rpc('update-profile',{...identity,...details,...phoneDetails})});
      }
      if (!runtime.localTest) return reply(404,{error:'NOT_AVAILABLE'});
      if(['signup-code','recovery-code','social-code','login'].includes(action)) {
        const countryCode=String(body.countryCode || '');const phone=typeof body.phone==='string' ? body.phone.replace(/[\s()-]/g,'') : '';
        if(!patterns[countryCode]?.test(phone))return reply(400,{error:'INVALID_PHONE'});
        const phoneE164=countryCode+phone;
        const limit=action==='login' ? 10 : 5;
        if(!await deps.rpc('limit',{key:await hash(`phone:${action}:${phoneE164}`),max:limit}))return reply(429,{error:'RATE_LIMITED'});
        const ip=req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
        if(!await deps.rpc('limit',{key:await hash(`ip:${action}:${ip}`),max:100}))return reply(429,{error:'RATE_LIMITED'});
        if(action==='login') {
          if(typeof body.password!=='string' || !body.password || new TextEncoder().encode(body.password).length>72)return reply(401,{error:'INVALID_LOGIN'});
          const result=await deps.signIn(phoneE164,body.password);
          if(!result)return reply(401,{error:'INVALID_LOGIN'});
          const profile=await deps.rpc('profile',result.identity);
          return reply(200,{session:result.session,profile});
        }
        const details=action!=='recovery-code' ? contact({...body,email:''}) : {};
        if(!details)return reply(400,{error:'INVALID_DETAILS'});
        const id=crypto.randomUUID();const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000);
        const purpose=action==='social-code' ? 'social' : action==='signup-code' ? 'signup' : 'recovery';
        await deps.rpc('issue',{id,purpose,phone_e164:phoneE164,code_hash:await hash(`${id}:${purpose}:${code}`),payload:{...details,phone,country_code:countryCode,phone_e164:phoneE164,...(social ? {social_user_id:social.user_id,social_session_id:social.session_id} : {})}});
        // Explicitly Test-only. Production must never expose verification codes.
        return reply(200,{challenge:id,testCode:code,expiresIn:300});
      }
      if(!['signup','reset-password','social-complete'].includes(action) || !uuid.test(String(body.challenge)) || typeof body.code!=='string' || !/^\d{6}$/.test(body.code))return reply(400,{error:'INVALID_CODE'});
      const password=typeof body.password==='string' ? body.password : '';
      if(action!=='social-complete' && !strong(password))return reply(400,{error:'WEAK_PASSWORD'});
      const purpose=action==='social-complete' ? 'social' : action==='signup' ? 'signup' : 'recovery';
      const payload=await deps.rpc('consume',{id:body.challenge,purpose,code_hash:await hash(`${body.challenge}:${purpose}:${body.code}`),...(social || {})}) as Data | null;
      if(!payload)return reply(400,{error:'INVALID_CODE'});
      if(payload.unavailable)return reply(400,{error:'ACCOUNT_UNAVAILABLE'});
      if(action==='social-complete') {
        if(!social || payload.social_user_id!==social.user_id || payload.social_session_id!==social.session_id) return reply(400,{error:'INVALID_CODE'});
        return reply(200,{profile:await deps.rpc('social-link',{...payload,user_id:social.user_id,session_id:social.session_id})});
      }
      if(action==='reset-password') {
        // consume creates a role-change guard. Keep it on uncertain failure;
        // completion revokes sessions and releases it only after Auth succeeds.
        await deps.resetPassword(String(payload.user_id),password,String(payload.guard_id));
        await deps.rpc('finish-reset',{user_id:payload.user_id,guard_id:payload.guard_id});
        return reply(200,{success:true});
      }
      let id: string;
      try { id=await deps.createUser({...payload,password}); }
      catch { return reply(400,{error:'ACCOUNT_UNAVAILABLE'}); }
      try { await deps.rpc('link',{...payload,user_id:id}); }
      catch(failure) {await deps.deleteUser(id);throw failure;}
      const result=await deps.signIn(String(payload.phone_e164),password);
      if(!result)return reply(503,{error:'SIGN_IN_REQUIRED'});
      return reply(200,{session:result.session,profile:await deps.rpc('profile',result.identity)});
    } catch(failure) {
      const message=failure instanceof Error ? failure.message : '';
      if (['INVALID_CODE','INVALID_DETAILS','INVALID_REQUEST','WEAK_PASSWORD','PASSWORD_MISMATCH','SAME_PASSWORD','CURRENT_PASSWORD_REQUIRED','PASSWORD_NOT_SET','PASSWORD_ALREADY_SET','NATIVE_CLIENT_UPDATE_REQUIRED'].includes(message)) return reply(400,{error:message});
      if (message==='FORBIDDEN') return reply(403,{error:'FORBIDDEN'});
      if (['DEVICE_REQUIRED','SUBSCRIPTION_LIMIT'].includes(message)) return reply(409,{error:message});
      if (message==='WRONG_CURRENT_PASSWORD') return reply(403,{error:message});
      if (message==='RATE_LIMITED') return reply(429,{error:message});
      if (message==='PASSWORD_PROOF_REQUIRED') return reply(403,{error:message});
      if (message==='PASSWORD_CHANGE_IN_PROGRESS') return reply(409,{error:message});
      if (message==='PASSWORD_UPDATE_UNCERTAIN') return reply(503,{error:message});
      if (message === 'SELF_BOOKING_NOT_ALLOWED') return reply(409, { error: message });
      if (['PACKAGE_DATE_UNAVAILABLE', 'BOOKING_NOT_MANAGEABLE', 'BOOKING_CUTOFF_PASSED', 'BOOKING_CHANGED', 'SLOT_UNAVAILABLE', 'INVALID_SELECTION'].includes(message)) return reply(409, { error: message });
      if (['INVALID_REQUEST', 'INVALID_DATE'].includes(message)) return reply(400, { error: message });
      if (message === 'BOOKING_NOT_RATEABLE') return reply(409, { error: message });
      if (message === 'INVALID_RATING') return reply(400, { error: message });
      if(/FAVOURITE_UNAVAILABLE/.test(message))return reply(409,{error:'FAVOURITE_UNAVAILABLE'});
      if(/FAVOURITES_LIMIT/.test(message))return reply(409,{error:'FAVOURITES_LIMIT'});
      if(/PHONE_IN_USE/.test(message))return reply(409,{error:'PHONE_IN_USE'});
      if(/INVALID_PHONE/.test(message))return reply(400,{error:'INVALID_DETAILS'});
      if(message==='STAFF_ACCOUNT')return reply(403,{error:'STAFF_ACCOUNT'});
      if(/AUTH_REQUIRED/.test(message))return reply(401,{error:'AUTH_REQUIRED'});
      if(/ACCOUNT_UNAVAILABLE|23505/.test(message))return reply(400,{error:'ACCOUNT_UNAVAILABLE'});
      return reply(503,{error:'UNAVAILABLE'});
    }
  };
}
