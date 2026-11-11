import { nativePushRuntime } from '../_shared/native-push-runtime.ts';
import { type AnnouncementJob, announcementPayload } from './delivery.ts';
type Configuration = {
  announcementEnabled: boolean;
  deliveryMode: string;
  announcementApiUrl: string;
  dispatchSecret: string;
  apiUrl: string;
  topic: string;
  environments: string[];
  privateKey: string;
  keyId: string;
  teamId: string;
};
type Dependencies = {
  environment: string;
  appUrl: string;
  publicUrl: string;
  configuration: () => Promise<Configuration>;
  claim: () => Promise<AnnouncementJob[]>;
  continueWork: () => Promise<void>;
  validate: (job: AnnouncementJob) => Promise<boolean>;
  finish: (
    job: AnnouncementJob,
    result: { status: number; reason: string; providerId: string },
  ) => Promise<void>;
  providerToken: (config: Configuration) => Promise<string>;
  send: (
    job: AnnouncementJob,
    jwt: string,
    config: Configuration,
  ) => Promise<{ status: number; reason: string; providerId: string }>;
};
export function createAnnouncementDispatcher(deps: Dependencies) {
  const runtime = nativePushRuntime(deps);
  return async (request: Request) => {
    const reply = (status: number, body: unknown) =>
      Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (
      request.method !== 'POST' ||
      !/^[0-9a-f]{64}$/.test(request.headers.get('x-push-secret') || '')
    ) return reply(403, { error: 'FORBIDDEN' });
    try {
      const config = await deps.configuration();
      const a = new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(request.headers.get('x-push-secret') || ''),
        ),
      );
      const b = new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(config.dispatchSecret || ''),
        ),
      );
      let diff = 0;
      for (let n = 0; n < a.length; n++) diff |= a[n] ^ b[n];
      if (diff || !config.dispatchSecret) {
        return reply(403, { error: 'FORBIDDEN' });
      }
      if (
        !runtime || !config.announcementEnabled ||
        config.announcementApiUrl !== runtime.apiUrl ||
        config.apiUrl !== runtime.apiUrl || config.topic !== runtime.topic ||
        !Array.isArray(config.environments) || !config.environments.length ||
        config.environments.some((v) => !runtime.environments.includes(v))
      ) return reply(503, { error: 'DELIVERY_DISABLED' });
      if (
        !['capture', 'apns'].includes(config.deliveryMode) ||
        config.deliveryMode === 'capture' && deps.environment !== 'cloud-test'
      ) return reply(503, { error: 'DELIVERY_DISABLED' });
      if (
        config.deliveryMode === 'apns' &&
        (!config.privateKey || !/^[A-Z0-9]{10}$/.test(config.keyId) ||
          !/^[A-Z0-9]{10}$/.test(config.teamId))
      ) return reply(503, { error: 'DELIVERY_DISABLED' });
      const jwt = config.deliveryMode === 'apns'
        ? await deps.providerToken(config)
        : '';
      const jobs = await deps.claim();
      let captured = 0, accepted = 0, other = 0;
      for (let index = 0; index < jobs.length; index += 5) {
        await Promise.all(
          jobs.slice(index, index + 5).map(async (job) => {
            const valid = job.deliveryMode === config.deliveryMode &&
              /^[0-9a-f]{64}$/.test(job.recipientBinding) &&
              new TextEncoder().encode(JSON.stringify(announcementPayload(job)))
                  .length <= 4096 &&
              await deps.validate(job);
            const result = !valid
              ? { status: 409, reason: 'NoLongerEligible', providerId: '' }
              : config.deliveryMode === 'capture'
              ? { status: 200, reason: 'Captured', providerId: '' }
              : await deps.send(job, jwt, config);
            await deps.finish(job, result);
            if (result.status === 200) {
              if (config.deliveryMode === 'capture') captured++;
              else accepted++;
            } else other++;
          }),
        );
      }
      await deps.continueWork();
      return reply(200, { claimed: jobs.length, captured, accepted, other });
    } catch {
      return reply(503, { error: 'DISPATCH_UNAVAILABLE' });
    }
  };
}
