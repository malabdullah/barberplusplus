import { pushContent, type PushJob } from '../customer-push-dispatch/apns.ts';
export const FCM_PROJECT = 'barber-plus-plus-phone-test';
export const FCM_PACKAGE = 'com.barberplusplus.customer.test';
export const FCM_EMAIL = 'barber-android-test-sender@barber-plus-plus-phone-test.iam.gserviceaccount.com';
export type FCMTarget = { environment: 'cloud-test' | 'production'; projectId: string; packageName: string; senderEmail?: string };
export const TEST_TARGET: FCMTarget = { environment: 'cloud-test', projectId: FCM_PROJECT, packageName: FCM_PACKAGE, senderEmail: FCM_EMAIL };
export const LIVE_TARGET: FCMTarget = { environment: 'production', projectId: 'barber-plus-plus-phone-prod', packageName: 'com.barberplusplus.customer' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const targetForJob = (job: AndroidJob) => job.environment === 'production' ? LIVE_TARGET : TEST_TARGET;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export type Credential = { type: string; project_id: string; client_email: string; private_key_id: string; private_key: string; token_uri: string };
export type AndroidJob = Partial<PushJob> & { id: string; lease: string; token: string; mode: 'capture' | 'send';
  projectId: string; packageName: string; language: string; kind: string; expiresAt: number; environment?: 'cloud-test' | 'production' };
export type Outcome = { outcome: 'sent' | 'captured' | 'invalid-token' | 'uncertain' | 'failed' | 'cancelled' | 'retryable'; providerId?: string; retryAfterSeconds?: number };
export function validCredential(value: unknown, target: FCMTarget = TEST_TARGET): value is Credential {
  const c = value as Credential | null;
  return !!c && c.type === 'service_account' && c.project_id === target.projectId && c.client_email === target.senderEmail
    && (target.environment === 'cloud-test' ? target.projectId === FCM_PROJECT && target.packageName === FCM_PACKAGE && target.senderEmail === FCM_EMAIL
      : target.projectId === LIVE_TARGET.projectId && target.packageName === LIVE_TARGET.packageName && /^[a-z0-9][a-z0-9-]{4,62}@barber-plus-plus-phone-prod\.iam\.gserviceaccount\.com$/.test(target.senderEmail || ''))
    && /^[0-9a-f]{40}$/.test(c.private_key_id) && typeof c.private_key === 'string'
    && c.private_key.startsWith('-----BEGIN PRIVATE KEY-----') && c.token_uri === TOKEN_URL;
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export function createFCMToken(send: typeof fetch = fetch, now = () => Date.now()) {
  let cached: { identity: string; value: string; expires: number } | null = null;
  return async (credential: Credential, target: FCMTarget = TEST_TARGET) => {
    if (!validCredential(credential, target)) throw Error('FCM_NOT_CONFIGURED');
    const identity = `${target.projectId}:${target.senderEmail}:${credential.private_key_id}`;
    if (cached?.identity === identity && cached.expires > now() + 60000) return cached.value;
    const raw = atob(credential.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ''));
    const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(raw, c => c.charCodeAt(0)),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const encode = (value: unknown) => b64(new TextEncoder().encode(JSON.stringify(value)));
    const issued = Math.floor(now() / 1000);
    const unsigned = encode({ alg: 'RS256', typ: 'JWT', kid: credential.private_key_id }) + '.' + encode({
      iss: credential.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: TOKEN_URL, iat: issued, exp: issued + 3600,
    });
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const response = await send(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + b64(new Uint8Array(signature)) }),
      signal: AbortSignal.timeout(10000) });
    const data = await response.json().catch(() => null);
    if (!response.ok || typeof data?.access_token !== 'string' || data.access_token.length > 4096
      || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in < 60 || data.expires_in > 3600) throw Error('FCM_CREDENTIAL_UNAVAILABLE');
    cached = { identity, value: data.access_token, expires: now() + data.expires_in * 1000 };
    return cached.value;
  };
}
export function androidContent(job: AndroidJob, now = Date.now(), target: FCMTarget = targetForJob(job)) {
  const pinned = target.environment === 'production' ? LIVE_TARGET : TEST_TARGET;
  if (target.projectId !== pinned.projectId || target.packageName !== pinned.packageName
    || !['cloud-test', 'production'].includes(target.environment) || !['capture', 'send'].includes(job.mode)
    || job.projectId !== target.projectId || job.packageName !== target.packageName
    || (target.environment === 'production' && (job.environment !== 'production' || !['confirmed', 'updated', 'rescheduled', 'cancelled', 'reminder24', 'reminder2', 'review'].includes(job.kind) || !uuid.test(job.eventId || '') || !uuid.test(job.bookingId || '')))
    || (target.environment === 'cloud-test' && job.environment !== undefined && job.environment !== 'cloud-test') || !/^[A-Za-z0-9_:-]{20,4096}$/.test(job.token)
    || !['en', 'ar'].includes(job.language) || !Number.isFinite(job.expiresAt) || job.expiresAt * 1000 <= now) throw Error('INVALID_JOB');
  const test = job.kind === 'test';
  if (!test && (!/^[a-f0-9-]{36}$/i.test(job.bookingId || '') || !job.date || !job.time || !job.shop)) throw Error('INVALID_JOB');
  const alert = test ? { title: 'Barber++ Test', body: job.language === 'ar' ? 'اضغط لفتح التطبيق.' : 'Tap to open the app.' }
    : pushContent(job as PushJob).aps.alert;
  const data = { ...(target.environment === 'production' ? { environment: 'production' } : {}), version: '1', kind: job.kind, destination: test ? 'book' : 'booking', ...(test ? {} : { bookingId: job.bookingId!, eventId: job.eventId || '' }) };
  return { message: { token: job.token, notification: alert, data, android: {
    restricted_package_name: target.packageName, priority: 'HIGH', ttl: `${Math.min(86400, Math.max(1, Math.floor(job.expiresAt - now / 1000)))}s`,
    notification: { channel_id: 'booking_updates', click_action: 'BARBER_OPEN_BOOKING', tag: test ? job.id : `booking.${job.bookingId}` },
  } } };
}
export async function sendFCM(job: AndroidJob, accessToken: string, send: typeof fetch = fetch, target: FCMTarget = targetForJob(job)): Promise<Outcome> {
  const body = androidContent(job, Date.now(), target);
  try {
    const response = await send(`https://fcm.googleapis.com/v1/projects/${target.projectId}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    const result = await response.json().catch(() => null);
    if (response.ok && typeof result?.name === 'string' && result.name.startsWith(`projects/${target.projectId}/messages/`)) return { outcome: 'sent', providerId: result.name.slice(0, 150) };
    if (Array.isArray(result?.error?.details) && result.error.details.some((d: Record<string, unknown>) => d['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' && d.errorCode === 'UNREGISTERED')) return { outcome: 'invalid-token' };
    if (target.environment === 'production' && [429, 500, 503].includes(response.status)) {
      const value = response.headers.get('retry-after') || '';
      const retryAfterSeconds = /^\d{1,5}$/.test(value) ? Math.min(86400, Number(value)) : 0;
      return { outcome: 'retryable', retryAfterSeconds };
    }
    return { outcome: 'failed' };
  } catch { return { outcome: 'uncertain' }; }
}
