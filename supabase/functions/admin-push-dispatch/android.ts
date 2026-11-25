import type { AnnouncementJob } from './delivery.ts';
import { LIVE_TARGET, TEST_TARGET } from '../customer-android-push-dispatch/fcm.ts';

// Data-only announcements are displayed by the app only after checking the
// current installation's recipient binding and notification preferences.
export function androidAnnouncementPayload(job: AnnouncementJob, now = Date.now()) {
  const target = job.environment === 'production' ? LIVE_TARGET : TEST_TARGET;
  if (job.client !== 'android' || !['cloud-test', 'production'].includes(job.environment)
    || job.projectId !== target.projectId || job.packageName !== target.packageName
    || !/^[0-9a-f-]{36}$/i.test(job.campaignId) || !/^[0-9a-f]{64}$/.test(job.recipientBinding)
    || !/^[A-Za-z0-9_:-]{20,4096}$/.test(job.token) || !['en', 'ar'].includes(job.language)
    || !['none', 'book', 'account', 'favourites'].includes(job.destination)
    || !Number.isFinite(job.expiresAt) || job.expiresAt * 1000 <= now) throw Error('INVALID_ANDROID_ANNOUNCEMENT');
  const ar = job.language === 'ar' && Boolean(job.titleAr && job.bodyAr);
  const result = { message: { token: job.token, data: {
    type: 'announcement', version: '1', environment: job.environment, campaignId: job.campaignId,
    recipientBinding: job.recipientBinding, destination: job.destination,
    title: ar ? job.titleAr : job.titleEn, body: ar ? job.bodyAr : job.bodyEn,
  }, android: { restricted_package_name: job.packageName, priority: 'HIGH',
    ttl: `${Math.min(86400, Math.max(1, Math.floor(job.expiresAt - now / 1000)))}s` } } };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 4096) throw Error('ANDROID_PAYLOAD_TOO_LARGE');
  return result;
}

// Transport remains injected so qualification never needs an external send.
export async function sendAndroidAnnouncement(job: AnnouncementJob, token: string, send: typeof fetch) {
  const payload = androidAnnouncementPayload(job);
  try {
    const response = await send(`https://fcm.googleapis.com/v1/projects/${job.projectId}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    });
    const value = await response.json().catch(() => null);
    if (response.ok && typeof value?.name === 'string' && value.name.startsWith(`projects/${job.projectId}/messages/`)) {
      return { status: 200, reason: '', providerId: value.name.slice(0, 150) };
    }
    if (Array.isArray(value?.error?.details) && value.error.details.some((d: Record<string, unknown>) =>
      d['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' && d.errorCode === 'UNREGISTERED')) {
      return { status: 410, reason: 'Unregistered', providerId: '' };
    }
    return { status: response.ok ? 502 : response.status, reason: 'FCMRejected', providerId: '' };
  } catch { return { status: 0, reason: 'TransportUnconfirmed', providerId: '' }; }
}
