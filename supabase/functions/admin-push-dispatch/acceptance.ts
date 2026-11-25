import type { AnnouncementJob } from './delivery.ts';
import { androidAnnouncementPayload } from './android.ts';
import { type Credential, LIVE_TARGET, validCredential } from '../customer-android-push-dispatch/fcm.ts';

type Configuration = { enabled: boolean; dispatchSecret: string; apiUrl: string; projectId: string; packageName: string; senderEmail: string; credential: Credential };
type Result = { status: number; reason: string; providerId: string };
type Dependencies = {
  environment: string; enabled: boolean;
  configuration: () => Promise<Configuration>;
  claim: () => Promise<AnnouncementJob[]>;
  validate: (job: AnnouncementJob) => Promise<boolean>;
  finish: (job: AnnouncementJob, result: Result) => Promise<void>;
  token: (credential: Credential, senderEmail: string) => Promise<string>;
  send: (job: AnnouncementJob, token: string) => Promise<Result>;
};

/** Explicit one-job worker. No generic claim, APNs, continuation or retry path. */
export function createAndroidAcceptanceDispatcher(deps: Dependencies) {
  return async (request: Request) => {
    const reply = (status: number, data: unknown) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'POST' || deps.environment !== 'production' || !deps.enabled) return reply(403, { error: 'DELIVERY_DISABLED' });
    const supplied = request.headers.get('x-push-secret') || '';
    if (!/^[0-9a-f]{64}$/.test(supplied)) return reply(403, { error: 'FORBIDDEN' });
    try {
      const config = await deps.configuration();
      const hash = async (v: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
      const a = await hash(supplied), b = await hash(config.dispatchSecret || '');
      let different = 0;
      for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
      if (different || !config.dispatchSecret) return reply(403, { error: 'FORBIDDEN' });
      if (!config.enabled || config.apiUrl !== 'https://srv1073968.hstgr.cloud' || config.projectId !== LIVE_TARGET.projectId
        || config.packageName !== LIVE_TARGET.packageName || !validCredential(config.credential, { ...LIVE_TARGET, senderEmail: config.senderEmail })) {
        return reply(503, { error: 'DELIVERY_DISABLED' });
      }
      const jobs = await deps.claim();
      if (jobs.length > 1) return reply(503, { error: 'ACCEPTANCE_SCOPE_INVALID' });
      if (!jobs.length) return reply(200, { claimed: 0, accepted: 0 });
      const job = jobs[0];
      let result: Result = { status: 409, reason: 'NoLongerEligible', providerId: '' };
      let valid = false;
      try {
        androidAnnouncementPayload(job);
        valid = job.client === 'android' && job.environment === 'production' && job.deliveryMode === 'apns' && await deps.validate(job);
      } catch { /* Fail closed before any provider call. */ }
      if (valid) {
        try {
          const token = await deps.token(config.credential, config.senderEmail);
          if (await deps.validate(job)) result = await deps.send(job, token);
        } catch { result = { status: 0, reason: 'TransportUnconfirmed', providerId: '' }; }
      }
      await deps.finish(job, result);
      return reply(200, { claimed: 1, accepted: result.status === 200 ? 1 : 0 });
    } catch { return reply(503, { error: 'DISPATCH_UNAVAILABLE' }); }
  };
}
