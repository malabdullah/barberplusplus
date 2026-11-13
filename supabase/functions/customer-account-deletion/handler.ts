type Identity = { user_id: string; session_id: string };
type Data = Record<string, unknown>;
type Dependencies = {
  enabled: boolean; appUrl: string; pepper: string;
  identity: (token: string) => Promise<Identity | null>;
  rpc: (action: string, data?: Data) => Promise<Data>;
  mail: (email: string, code: string, language: string, id: string) => Promise<void>;
  password: (userId: string, password: string) => Promise<boolean>;
  process: (id: string) => Promise<void>;
  retain: (work: Promise<void>) => void;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const receiptPattern = /^[A-Za-z0-9_-]{43}$/;
const safeErrors = new Set(['AUTH_REQUIRED','LINKED_WORK_ACCOUNT','PROFILE_REQUIRED','ACCOUNT_SCOPE_CONFLICT','TEST_ACCOUNT_ONLY','DELETION_IN_PROGRESS','RATE_LIMITED','RECEIPT_INVALID','INVALID_REQUEST','CODE_EXPIRED','INVALID_CODE','REAUTH_REQUIRED','CONFIRMATION_REQUIRED','EMAIL_UNAVAILABLE']);
export async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
function secret() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
export async function receiptBox(pepper: string, id: string, value: string, decrypt = false) {
  const bytes = new TextEncoder();
  const keyBytes = await crypto.subtle.digest('SHA-256', bytes.encode('account-deletion-receipt:' + pepper));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt','decrypt']);
  if (decrypt) {
    const data = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0,12), additionalData: bytes.encode(id) }, key, data.slice(12)));
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes.encode(id) }, key, bytes.encode(value)));
  const data = new Uint8Array(iv.length + encrypted.length); data.set(iv); data.set(encrypted, iv.length);
  return btoa(String.fromCharCode(...data));
}
function code() {
  let value: number;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4294000000);
  return String(value % 1000000).padStart(6, '0');
}
async function body(req: Request): Promise<Data> {
  const reader = req.body?.getReader(); if (!reader) throw Error('INVALID_REQUEST');
  const parts: Uint8Array[] = []; let length = 0;
  while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > 4096) { await reader.cancel(); throw Error('INVALID_REQUEST'); } parts.push(next.value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Error('INVALID_REQUEST'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('INVALID_REQUEST'); return value;
}
function masked(email: string) { const [name, domain] = email.split('@'); return domain ? name.slice(0,1) + '***@' + domain : ''; }
function preview(value: Data) {
  const email = typeof value.email === 'string' ? value.email : '';
  return { upcoming: value.upcoming, upcomingCount: value.upcomingCount, hasMore: value.hasMore, digest: value.digest, providers: value.providers,
    destination: masked(email), methods: [...(email ? ['email_code'] : []), ...(value.hasPassword ? ['password'] : [])],
    appleRevocation: Array.isArray(value.providers) && value.providers.includes('apple') ? 'manual_required' : 'not_applicable' };
}
export function createDeletionHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', ...(origin === deps.appUrl ? { 'Access-Control-Allow-Origin': deps.appUrl, 'Vary': 'Origin' } : {}) };
    const reply = (status: number, data: Data) => Response.json(data, { status, headers });
    if (!deps.enabled) return reply(503, { error: 'NOT_ENABLED' });
    if (origin && origin !== deps.appUrl) return reply(403, { error: 'FORBIDDEN' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type' } });
    if (req.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
    try {
      const value = await body(req); const action = String(value.action || '');
      const allowed: Record<string, string[]> = { preview: [], start: ['id','language'], resend: ['id','receipt','language'], verify: ['id','receipt','code'], password: ['id','receipt','password'], confirm: ['id','receipt','digest','confirmCancellation'], status: ['id','receipt'], retry: ['id','receipt'] };
      if (!allowed[action] || Object.keys(value).some(key => key !== 'action' && !allowed[action].includes(key))) return reply(400, { error: 'INVALID_REQUEST' });
      const authenticated = !['status','retry'].includes(action);
      const identity = authenticated ? await deps.identity((req.headers.get('authorization') || '').replace(/^Bearer /i, '')) : null;
      if (authenticated && !identity) return reply(401, { error: 'AUTH_REQUIRED' });
      const trusted = identity ? { user_id: identity.user_id, session_id: identity.session_id } : {};
      if (action === 'preview') return reply(200, preview(await deps.rpc('preview', trusted)));
      const id = String(value.id || ''); if (!uuid.test(id)) return reply(400, { error: 'INVALID_REQUEST' });
      if (action === 'start') {
        const candidate = secret(); const otp = code();
        const result = await deps.rpc('start', { ...trusted, id, receipt_hash: await digest(candidate), receipt_box: await receiptBox(deps.pepper, id, candidate), code_hash: await digest(deps.pepper + ':' + id + ':' + otp) });
        const receipt = result.created ? candidate : await receiptBox(deps.pepper, id, String(result.receiptBox), true);
        if (result.created && typeof result.email === 'string' && result.email) await deps.mail(result.email, otp, value.language === 'ar' ? 'ar' : 'en', id);
        return reply(200, { id, receipt, state: result.state, expiresAt: result.expiresAt, upcoming: result.upcoming, upcomingCount: result.upcomingCount, hasMore: result.hasMore, digest: result.digest, destination: masked(String(result.email || '')) });
      }
      const receipt = String(value.receipt || ''); if (!receiptPattern.test(receipt)) return reply(400, { error: 'INVALID_REQUEST' });
      const scope = { ...trusted, id, receipt_hash: await digest(receipt) };
      if (['status','retry'].includes(action)) {
        const result = await deps.rpc('status', scope);
        if (action === 'retry' && result.state === 'cleanup_pending') deps.retain(deps.process(id));
        return reply(result.state === 'cleanup_pending' ? 202 : 200, result);
      }
      if (action === 'resend') {
        const otp = code(); const result = await deps.rpc('resend', { ...scope, code_hash: await digest(deps.pepper + ':' + id + ':' + otp) });
        await deps.mail(String(result.email), otp, value.language === 'ar' ? 'ar' : 'en', id + '-' + String(result.expiresAt));
        return reply(200, { state: result.state, expiresAt: result.expiresAt, destination: masked(String(result.email)) });
      }
      if (action === 'verify' || action === 'password') {
        let result;
        if (action === 'verify') {
          if (!/^\d{6}$/.test(String(value.code || ''))) return reply(400, { error: 'INVALID_REQUEST' });
          result = await deps.rpc('verify', { ...scope, code_hash: await digest(deps.pepper + ':' + id + ':' + value.code) });
        } else {
          if (typeof value.password !== 'string' || value.password.length < 1 || value.password.length > 256) return reply(400, { error: 'INVALID_REQUEST' });
          // Validate scope before trying credentials. No caller-supplied email/user.
          const attempt = crypto.randomUUID();
          const reservation = await deps.rpc('password-check', { ...scope, attempt });
          if (reservation.error) return reply(400, reservation);
          result = await deps.rpc('password-proof', { ...scope, attempt, verified: await deps.password(identity!.user_id, value.password) });
        }
        return reply(result.error ? 400 : 200, result);
      }
      if (value.confirmCancellation !== true || !/^[0-9a-f]{64}$/.test(String(value.digest || ''))) return reply(400, { error: 'CONFIRMATION_REQUIRED' });
      const result = await deps.rpc('confirm', { ...scope, digest: value.digest, confirmCancellation: true });
      if (result.state === 'cleanup_pending') deps.retain(deps.process(id));
      return reply(result.state === 'cleanup_pending' ? 202 : 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const safe = safeErrors.has(message) ? message : 'UNAVAILABLE';
      return reply(safe === 'AUTH_REQUIRED' ? 401 : safe === 'RATE_LIMITED' ? 429 : safe === 'UNAVAILABLE' ? 503 : 400, { error: safe });
    }
  };
}
