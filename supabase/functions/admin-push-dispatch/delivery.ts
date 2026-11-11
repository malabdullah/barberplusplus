export type AnnouncementJob = {
  id: string;
  lease: string;
  campaignId: string;
  recipientBinding: string;
  deliveryMode: string;
  token: string;
  environment: string;
  topic: string;
  language: string;
  titleEn: string;
  bodyEn: string;
  titleAr: string;
  bodyAr: string;
  destination: string;
  expiresAt: number;
};
export function announcementPayload(job: AnnouncementJob) {
  const ar = job.language === 'ar' && Boolean(job.titleAr && job.bodyAr);
  return {
    aps: {
      alert: {
        title: ar ? job.titleAr : job.titleEn,
        body: ar ? job.bodyAr : job.bodyEn,
      },
      sound: 'default',
      'thread-id': 'barber.announcements',
      category: 'ADMIN_ANNOUNCEMENT',
    },
    version: 1,
    type: 'announcement',
    announcementId: job.campaignId,
    recipientBinding: job.recipientBinding,
    destination: job.destination,
  };
}
export async function sendAnnouncement(
  job: AnnouncementJob,
  jwt: string,
  runtime: { topic: string; environments: string[] },
  send: typeof fetch = fetch,
) {
  if (
    !/^[0-9a-f]{64}$/.test(job.recipientBinding) ||
    !runtime.environments.includes(job.environment) ||
    job.topic !== runtime.topic || !/^[0-9a-f]{32,512}$/.test(job.token) ||
    job.token.length % 2 ||
    !['none', 'book', 'account', 'favourites'].includes(job.destination)
  ) return { status: 400, reason: 'EnvironmentMismatch', providerId: '' };
  const payload = JSON.stringify(announcementPayload(job));
  if (new TextEncoder().encode(payload).length > 4096) {
    return { status: 413, reason: 'PayloadTooLarge', providerId: '' };
  }
  try {
    const response = await send(
      `https://${
        job.environment === 'sandbox'
          ? 'api.sandbox.push.apple.com'
          : 'api.push.apple.com'
      }/3/device/${job.token}`,
      {
        method: 'POST',
        headers: {
          authorization: `bearer ${jwt}`,
          'apns-topic': job.topic,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-id': job.id,
          'apns-collapse-id': 'announcement.' + job.campaignId,
          'apns-expiration': String(job.expiresAt),
          'content-type': 'application/json',
        },
        body: payload,
        signal: AbortSignal.timeout(10000),
      },
    );
    const body = response.ok ? null : await response.json().catch(() => null);
    return {
      status: response.status,
      reason: String(body?.reason || ''),
      providerId: response.headers.get('apns-id') || job.id,
    };
  } catch {
    return { status: 0, reason: 'TransportUnconfirmed', providerId: '' };
  }
}
