type Data = Record<string, unknown>;
type Identity = { user_id: string; session_id: string };
type Session = { access_token: string; refresh_token: string; user: { id: string; app_metadata: Record<string, unknown> } };
export type PasswordDependencies = {
  rpc: (action: string, data: Data) => Promise<Data>;
  reauthenticate: (userId: string, password: string) => Promise<{ sessionId: string; token: string } | null>;
  discardReauthentication: (token: string) => Promise<void>;
  sendRecovery: (email: string, callback: string) => Promise<void>;
  verifyRecovery: (params: { email?: string; code?: string; tokenHash?: string; type: 'recovery' | 'invite' }) => Promise<Session | null>;
  writePassword: (userId: string, password: string, operation: string) => Promise<{ ok: boolean; definitive: boolean; code?: string }>;
};
type Context = {
  action: string; body: Data; token: string; ip: string;
  environment: string; appUrl: string;
  identity: (token: string) => Promise<Identity | null>;
  limit: (key: string, max: number) => Promise<boolean>;
  deps: PasswordDependencies;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const strong = (s: unknown): s is string => typeof s === 'string' && s.length >= 8 && new TextEncoder().encode(s).length <= 72 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[^\w\s]/.test(s);
const methods = new Set(['password-status','password-change','password-setup-request','password-native-delivery','password-recovery-verify','password-invite-verify','email-recovery','email-reset']);
const allowed = new Set(['customer','manager','barber']);
function sessionId(token: string) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id || ''; } catch { return ''; }
}
function nativeScheme(environment: string, appUrl: string) {
  if (environment === 'cloud-test' && appUrl === 'https://barber-test.alabdullah-cs.workers.dev') return 'barberplusplus-test';
  if (environment === 'production' && appUrl === 'https://www.barberplusplus.com') return 'barberplusplus';
  return null;
}
async function nativeBinding(body: Data, verification: boolean) {
  if (body.client !== undefined && body.client !== 'ios' && body.client !== 'web') throw Error('INVALID_REQUEST');
  if (body.client !== 'ios') return { client:'web' };
  if (!uuid.test(String(body.nativeState))) throw Error('INVALID_REQUEST');
  let challenge = String(body.nativeChallenge || '');
  if (verification) {
    if (typeof body.nativeVerifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(body.nativeVerifier)) throw Error('INVALID_CODE');
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.nativeVerifier)));
    challenge = btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw Error('NATIVE_CLIENT_UPDATE_REQUIRED');
  return { client:'ios',native_state:body.nativeState,native_challenge:challenge };
}
export async function customerPasswordAction(c: Context): Promise<{ status: number; body: Data } | null> {
  if (!methods.has(c.action)) return null;
  const reply = (status: number, body: Data) => ({status,body});
  const limited = async (key: string, max=5) => {
    if (!await c.limit(`password:${c.action}:${key}`,max) || !await c.limit(`password-ip:${c.action}:${c.ip}`,100)) throw Error('RATE_LIMITED');
  };
  if (c.action==='password-native-delivery') {
    if (!nativeScheme(c.environment,c.appUrl) || !uuid.test(String(c.body.requestId)) || !uuid.test(String(c.body.nativeState)) || typeof c.body.tokenHash!=='string') throw Error('INVALID_CODE');
    await limited(String(c.body.requestId),10);
    return reply(200,await c.deps.rpc('request-delivery',{request_id:c.body.requestId,native_state:c.body.nativeState,token_hash:c.body.tokenHash}));
  }
  if (c.action === 'email-recovery' || c.action === 'password-setup-request') {
    const setup = c.action === 'password-setup-request';
    const identity = setup ? await c.identity(c.token) : null;
    if (setup && !identity) throw Error('AUTH_REQUIRED');
    const email = typeof c.body.email === 'string' ? c.body.email.trim().toLowerCase() : '';
    if (!setup && (email.length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) throw Error('INVALID_DETAILS');
    const native = await nativeBinding(c.body,false);
    if (native.client === 'ios' && !nativeScheme(c.environment,c.appUrl)) throw Error('INVALID_REQUEST');
    await limited(identity?.user_id || email);
    const requestId = crypto.randomUUID();
    const request = await c.deps.rpc('request-start',{...identity,...native,request_id:requestId,email,purpose:setup?'set':'recovery',audience:c.body.audience==='work'?'work':'customer'});
    const callback = new URL('/customer/email-callback',c.appUrl);
    callback.searchParams.set('next',c.body.returnTo==='/book'?'book':c.body.audience==='work'?'work':'account');
    callback.searchParams.set('request_id',requestId);
    if (native.client==='ios') { callback.searchParams.set('client','ios');callback.searchParams.set('state',String(native.native_state)); }
    if (request.deliver) await c.deps.sendRecovery(String(request.email),callback.href);
    await c.deps.rpc('request-ready',{request_id:requestId});
    return reply(200,{success:true,requestId,expiresIn:3600,...(setup?{email:request.email}:{})});
  }
  if (c.action === 'password-recovery-verify') {
    if (!uuid.test(String(c.body.requestId))) throw Error('INVALID_CODE');
    const native = await nativeBinding(c.body,true);
    if (native.client==='ios' && !nativeScheme(c.environment,c.appUrl)) throw Error('INVALID_CODE');
    await limited(String(c.body.requestId),10);
    const delivery = c.body.deliveryToken;
    if (delivery!==undefined && (native.client!=='ios' || !uuid.test(String(delivery)))) throw Error('INVALID_CODE');
    const request = await c.deps.rpc('request-load',{request_id:c.body.requestId,...native,...(delivery?{delivery_token:delivery}:{})});
    const code = c.body.code;
    const tokenHash = c.body.tokenHash;
    if (tokenHash !== undefined && (typeof tokenHash !== 'string' || tokenHash !== request.tokenHash)) throw Error('INVALID_CODE');
    if (tokenHash === undefined && !delivery && (typeof code !== 'string' || !/^\d{6,10}$/.test(code))) throw Error('INVALID_CODE');
    const session = await c.deps.verifyRecovery({type:'recovery',...(delivery?{tokenHash:String(request.tokenHash)}:typeof tokenHash==='string'?{tokenHash}:{email:String(request.email),code:String(code)})});
    if (!session) throw Error('INVALID_CODE');
    if (session.user.id !== request.userId) { await c.deps.discardReauthentication(session.access_token); throw Error('INVALID_CODE'); }
    let proof;
    try { proof = await c.deps.rpc('request-verified',{request_id:c.body.requestId,...native,user_id:session.user.id,session_id:sessionId(session.access_token)}); }
    catch (failure) { await c.deps.discardReauthentication(session.access_token); throw failure; }
    return reply(200,{...proof,session});
  }
  if (c.action === 'password-invite-verify') {
    if (typeof c.body.tokenHash !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(c.body.tokenHash)) throw Error('INVALID_CODE');
    await limited(c.ip,10);
    const started = await c.deps.rpc('invite-start',{token_hash:c.body.tokenHash});
    let session;
    try { session = await c.deps.verifyRecovery({type:'invite',tokenHash:c.body.tokenHash}); }
    finally { await c.deps.rpc('abort',{user_id:started.userId,session_id:null,operation:started.operation}); }
    if (!session || session.user.id!==started.userId || session.user.app_metadata.role!=='barber') {
      if (session) await c.deps.discardReauthentication(session.access_token);
      throw Error('INVALID_CODE');
    }
    let proof;
    try { proof = await c.deps.rpc('invite-verified',{user_id:session.user.id,session_id:sessionId(session.access_token)}); }
    catch (failure) { await c.deps.discardReauthentication(session.access_token); throw failure; }
    return reply(200,{...proof,session});
  }
  const identity = await c.identity(c.token);
  if (!identity) throw Error('AUTH_REQUIRED');
  if (c.action === 'password-status') return reply(200,await c.deps.rpc('status',identity));
  if (!strong(c.body.password)) throw Error('WEAK_PASSWORD');
  if (c.body.confirmPassword !== c.body.password) throw Error('PASSWORD_MISMATCH');
  await limited(identity.user_id);
  let operation: Data;
  if (c.action === 'password-change') {
    const current = c.body.currentPassword;
    if (typeof current !== 'string' || !current || new TextEncoder().encode(current).length>72) throw Error('CURRENT_PASSWORD_REQUIRED');
    if (current === c.body.password) throw Error('SAME_PASSWORD');
    const capability = await c.deps.rpc('status',identity);
    if (!capability.hasPassword) throw Error('PASSWORD_NOT_SET');
    const reauth = await c.deps.reauthenticate(identity.user_id,current);
    if (!reauth) throw Error('WRONG_CURRENT_PASSWORD');
    try { operation = await c.deps.rpc('current-begin',{...identity,reauth_session_id:reauth.sessionId}); }
    finally { await c.deps.discardReauthentication(reauth.token); }
  } else {
    if (!uuid.test(String(c.body.proof))) throw Error('PASSWORD_PROOF_REQUIRED');
    operation = await c.deps.rpc('prepare',{...identity,proof:c.body.proof});
  }
  let outcome: {ok:boolean;definitive:boolean;code?:string};
  try { outcome = await c.deps.writePassword(identity.user_id,c.body.password,String(operation.operation)); }
  catch { outcome={ok:false,definitive:false}; }
  // The trigger commits the proof and session revocation with the Auth write.
  // This reconciles a lost reply without replaying the credential update.
  let result;
  try { result = await c.deps.rpc('operation-result',{...identity,operation:operation.operation}); }
  catch { throw Error('PASSWORD_UPDATE_UNCERTAIN'); }
  if (result.applied) return reply(200,{success:true,signInRequired:true});
  if (!outcome.definitive) throw Error('PASSWORD_UPDATE_UNCERTAIN');
  await c.deps.rpc('abort',{...identity,operation:operation.operation});
  if (outcome.code==='weak_password') throw Error('WEAK_PASSWORD');
  if (outcome.code==='same_password') throw Error('SAME_PASSWORD');
  throw Error('UNAVAILABLE');
}
export const passwordCapableRoles = allowed;
