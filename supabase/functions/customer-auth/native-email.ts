import { sessionId } from '../_shared/customer-session.ts';
import { androidTestAuth, nativeBinding } from './native-binding.ts';
type Data = Record<string, unknown>;
type Session = { access_token: string; refresh_token: string; user: { id: string; email?: string; email_confirmed_at?: string; app_metadata: Data; user_metadata?: Data } };
export type NativeEmailDependencies = {
  rpc: (action: string, data: Data) => Promise<Data>;
  account: (name: string, email: string, password: string) => Promise<string | null>;
  send: (email: string, callback: string) => Promise<void>;
  verify: (params: { email?: string; code?: string; tokenHash?: string }) => Promise<Session | null>;
  discard: (token: string) => Promise<void>;
  profile: (userId: string, sessionId: string, name: string) => Promise<Data>;
};
type Context = { action: string; body: Data; environment: string; appUrl: string; publicUrl: string;
  limit: (key: string, max: number) => Promise<boolean>; ip: string; deps: NativeEmailDependencies };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const strong = (value: unknown): value is string => typeof value === 'string' && value.length >= 8
  && new TextEncoder().encode(value).length <= 72 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^\w\s]/.test(value);
const methods = new Set(['email-signup', 'email-resend', 'email-native-delivery', 'email-native-verify', 'email-native-status']);
export async function nativeEmailAction(c: Context): Promise<{ status: number; body: Data } | null> {
  if (!methods.has(c.action) || (c.body.client !== 'android' && !c.action.startsWith('email-native-'))) return null;
  if (c.body.client !== 'android' || !androidTestAuth(c)) throw Error('INVALID_REQUEST');
  const reply = (body: Data) => ({ status: 200, body });
  const limited = async (key: string, max: number) => {
    if (!await c.limit(key, max) || !await c.limit(`native-email-ip:${c.action}:${c.ip}`, 100)) throw Error('RATE_LIMITED');
  };
  if (c.action === 'email-signup') {
    const email = typeof c.body.email === 'string' ? c.body.email.trim().toLowerCase() : '';
    const name = typeof c.body.name === 'string' ? c.body.name.trim() : '';
    if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || name.length < 2 || name.length > 120) throw Error('INVALID_DETAILS');
    if (!strong(c.body.password)) throw Error('WEAK_PASSWORD');
    const binding = await nativeBinding(c.body, false, c);
    await limited(`email:email-signup:${email}`, 5);
    const userId = await c.deps.account(name, email, c.body.password);
    const requestId = crypto.randomUUID(), pendingHandle = crypto.randomUUID();
    await c.deps.rpc('start', { request_id: requestId, pending_handle: pendingHandle, email, user_id: userId, ...binding });
    const callback = new URL('/customer/email-callback', c.appUrl);
    callback.search = new URLSearchParams({ client: 'android', request_id: requestId, state: String(binding.native_state), next: 'account' }).toString();
    try { if (userId) await c.deps.send(email, callback.href); }
    catch { await c.deps.rpc('delivery-failed', { request_id: requestId }); throw Error('UNAVAILABLE'); }
    await c.deps.rpc('ready', { request_id: requestId });
    return reply({ success: true, requestId, pendingHandle, expiresIn: 3600 });
  }
  if (!uuid.test(String(c.body.requestId)) || !uuid.test(String(c.body.nativeState))) throw Error('INVALID_CODE');
  const common = { request_id: c.body.requestId, native_state: c.body.nativeState, client: 'android' };
  await limited(`native-email:${c.action}:${c.body.requestId}`, c.action === 'email-native-status' ? 30 : 10);
  if (c.action === 'email-native-delivery') {
    if (typeof c.body.tokenHash !== 'string' || !/^[a-f0-9]{32,128}$/i.test(c.body.tokenHash)) throw Error('INVALID_CODE');
    return reply(await c.deps.rpc('delivery', { ...common, token_hash: c.body.tokenHash }));
  }
  if (c.action === 'email-resend' || c.action === 'email-native-status') {
    if (!uuid.test(String(c.body.pendingHandle))) throw Error('INVALID_CODE');
    const binding = await nativeBinding(c.body, false, c);
    const bound = { ...common, ...binding, pending_handle: c.body.pendingHandle };
    const request = await c.deps.rpc('status', bound);
    if (c.action === 'email-native-status') return reply({ status: request.status, expiresIn: request.expiresIn });
    await limited(`email:email-resend:${request.email}`, 5);
    const resend = await c.deps.rpc('resend', bound);
    const callback = new URL('/customer/email-callback', c.appUrl);
    callback.search = new URLSearchParams({ client: 'android', request_id: String(c.body.requestId), state: String(c.body.nativeState), next: 'account' }).toString();
    try { if (resend.deliver) await c.deps.send(String(resend.email), callback.href); }
    catch { await c.deps.rpc('delivery-failed', common); throw Error('UNAVAILABLE'); }
    await c.deps.rpc('ready', common);
    return reply({ success: true, requestId: c.body.requestId, expiresIn: resend.expiresIn });
  }
  const binding = await nativeBinding(c.body, true, c);
  const delivery = c.body.deliveryToken, code = c.body.code;
  if (Boolean(delivery) === Boolean(code) || c.body.tokenHash !== undefined
    || (delivery !== undefined && !uuid.test(String(delivery)))
    || (code !== undefined && (typeof code !== 'string' || !/^\d{6,10}$/.test(code)))) throw Error('INVALID_CODE');
  const loaded = await c.deps.rpc('reserve', { ...common, ...binding, ...(delivery ? { delivery_token: delivery } : {}) });
  const lease = { ...common, operation: loaded.operation };
  let session: Session | null;
  try { session = await c.deps.verify(delivery ? { tokenHash: String(loaded.tokenHash) } : { email: String(loaded.email), code: String(code) }); }
  catch { await c.deps.rpc('uncertain', lease); throw Error('UNAVAILABLE'); }
  if (!session) { await c.deps.rpc('invalid-code', lease); throw Error('INVALID_CODE'); }
  const sid = sessionId(session.access_token);
  if (session.user.id !== loaded.userId || session.user.email?.trim().toLowerCase() !== loaded.email
    || !session.user.email_confirmed_at || !sid) {
    await c.deps.discard(session.access_token); await c.deps.rpc('uncertain', lease); throw Error('INVALID_CODE');
  }
  if (session.user.app_metadata.role !== 'customer') {
    await c.deps.discard(session.access_token); await c.deps.rpc('uncertain', lease); throw Error('STAFF_ACCOUNT');
  }
  try {
    await c.deps.rpc('verified', { ...lease, user_id: session.user.id, session_id: sid });
    const name = typeof session.user.user_metadata?.name === 'string' ? session.user.user_metadata.name.slice(0, 120) : '';
    const profile = await c.deps.profile(session.user.id, sid, name);
    if (!profile || profile.needsName) throw Error('ACCOUNT_UNAVAILABLE');
    return reply({ session, profile });
  } catch (failure) { await c.deps.discard(session.access_token); throw failure; }
}
