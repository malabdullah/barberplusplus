type Data = Record<string, unknown>;
export type RegistrationUser = { id: string; email: string; verified: boolean };
export type RegistrationDependencies = {
  signup: (input: { name: string; email: string; phone: string; password: string }) => Promise<RegistrationUser>;
  user: (id: string) => Promise<RegistrationUser | null>;
  resend: (email: string) => Promise<void>;
};
type Context = { action: string; body: Data; ip: string; secret: string; appUrl: string; limit: (key: string, max: number) => Promise<boolean>; deps: RegistrationDependencies; now?: () => number };
const actions = new Set(['manager-signup', 'manager-registration-status', 'manager-registration-resend']);
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lifetime = 86400000;
const cooldown = 60000;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));

// Supabase can return an obfuscated user for a confirmed linked email.
export function registrationUser(user: { id?: string; email?: string; email_confirmed_at?: string; app_metadata?: Record<string, unknown>; identities?: unknown[] } | null): RegistrationUser {
  if (Array.isArray(user?.identities) && user.identities.length === 0) throw Error('SIGNUP_EMAIL_EXISTS');
  if (!user?.id || !uuid.test(user.id) || !user.email) throw Error('UNAVAILABLE');
  if (user.app_metadata?.role !== 'manager') throw Error('SIGNUP_EMAIL_EXISTS');
  return { id: user.id, email: user.email.trim().toLowerCase(), verified: Boolean(user.email_confirmed_at) };
}

export async function managerRegistrationAction(c: Context): Promise<{ status: number; body: Data } | null> {
  if (!actions.has(c.action)) return null;
  const reply = (status: number, body: Data) => ({ status, body });
  try {
    const now = c.now?.() ?? Date.now();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`manager-registration-v1:${c.secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const issue = async (id: string, email: string, expiresAt = now + lifetime) => {
      const payload = encode(new TextEncoder().encode(JSON.stringify({ id, email, expiresAt, issuedAt: now, audience: c.appUrl })));
      const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
      return { receipt: `${payload}.${encode(new Uint8Array(signature))}`, expiresAt, resendAt: now + cooldown };
    };
    const limited = async (value: string, max: number) => {
      if (!await c.limit(`registration:${value}`, max)) throw Error('RATE_LIMITED');
    };
    if (c.action === 'manager-signup') {
      const email = typeof c.body.email === 'string' ? c.body.email.trim().toLowerCase() : '';
      const name = typeof c.body.name === 'string' ? c.body.name.trim() : '';
      const phone = typeof c.body.phone === 'string' ? c.body.phone.replace(/[\s()-]/g, '') : '';
      const password = c.body.password;
      if (!emailPattern.test(email) || email.length > 254 || name.length < 2 || name.length > 120) return reply(400, { error: 'INVALID_DETAILS' });
      if (!/^\+(?:965[569]\d{7}|9665\d{8}|9715\d{8}|973\d{8}|974[3567]\d{7}|968[79]\d{7})$/.test(phone)) return reply(400, { error: 'INVALID_PHONE' });
      if (typeof password !== 'string' || password.length < 8 || new TextEncoder().encode(password).length > 72 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^\w\s]/.test(password)) return reply(400, { error: 'WEAK_PASSWORD' });
      await limited(`signup:${email}`, 5); await limited(`signup-ip:${c.ip}`, 20);
      const user = await c.deps.signup({ name, email, phone, password });
      if (user.email !== email) throw Error('UNAVAILABLE');
      return reply(200, { success: true, confirmationRequired: !user.verified, email, ...(!user.verified ? await issue(user.id, email) : {}) });
    }
    // Only possession of a receipt issued for a real signup permits status or
    // resend. Never offer an arbitrary email lookup or return Auth sessions.
    let claims: { id: string; email: string; expiresAt: number; issuedAt: number; audience: string };
    try {
      if (typeof c.body.receipt !== 'string' || c.body.receipt.length > 2048) throw Error();
      const [payload, signature, extra] = c.body.receipt.split('.');
      if (extra || !signature || !await crypto.subtle.verify('HMAC', key, decode(signature), new TextEncoder().encode(payload))) throw Error();
      claims = JSON.parse(new TextDecoder().decode(decode(payload)));
      if (!uuid.test(claims.id) || !emailPattern.test(claims.email) || !Number.isFinite(claims.expiresAt) || !Number.isFinite(claims.issuedAt) || claims.expiresAt <= now || claims.expiresAt > now + lifetime || claims.issuedAt > now || claims.audience !== c.appUrl) throw Error();
    } catch { return reply(400, { error: 'REGISTRATION_EXPIRED' }); }
    await limited(`ip:${c.ip}`, 100);
    await limited(`status:${claims.id}`, 100);
    const user = await c.deps.user(claims.id);
    if (!user || user.id !== claims.id || user.email !== claims.email) return reply(400, { error: 'REGISTRATION_EXPIRED' });
    if (user.verified || c.action === 'manager-registration-status') return reply(200, { verified: user.verified });
    if (now < claims.issuedAt + cooldown) return reply(429, { error: 'RATE_LIMITED', retryAfter: Math.ceil((claims.issuedAt + cooldown - now) / 1000) });
    await limited(`resend:${claims.id}`, 5);
    await limited(`resend-minute:${claims.id}:${Math.floor(now / cooldown)}`, 1);
    await c.deps.resend(claims.email);
    return reply(200, { verified: false, resent: true, ...await issue(claims.id, claims.email, claims.expiresAt) });
  } catch (failure) {
    const code = failure instanceof Error ? failure.message : 'UNAVAILABLE';
    if (code === 'RATE_LIMITED') return reply(429, { error: code, retryAfter: 60 });
    if (['SIGNUP_EMAIL_EXISTS', 'PHONE_REGISTRATION_CONFLICT'].includes(code)) return reply(409, { error: code });
    return reply(503, { error: 'UNAVAILABLE' });
  }
}
