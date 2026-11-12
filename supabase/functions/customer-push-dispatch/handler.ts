import { nativePushRuntime } from '../_shared/native-push-runtime.ts';
import { type APNsConfiguration, type APNsCredential, apnsTokenSelector, hasAPNsCredential } from '../_shared/apns-credentials.ts';
import { type PushJob } from './apns.ts';
type Result = { status: number; reason: string; apnsId: string };
type Configuration = APNsConfiguration & { dispatchSecret: string; enabled: boolean };
type Dependencies = {
  environment: string; appUrl: string; publicUrl: string;
  configuration: () => Promise<Configuration>;
  claim: () => Promise<PushJob[]>;
  validate: (job: PushJob) => Promise<boolean>;
  finish: (job: PushJob, result: Result) => Promise<void>;
  providerToken: (key: APNsCredential) => Promise<string>;
  send: (job: PushJob, jwt: string, config: Configuration) => Promise<Result>;
};
export function createBookingPushDispatcher(deps: Dependencies) {
  const runtime = nativePushRuntime(deps);
  return async (request: Request) => {
    let stage = 'configuration';
    const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
    if (request.method !== 'POST' || !/^[0-9a-f]{64}$/.test(request.headers.get('x-push-secret') || '')) return reply(403, { error: 'FORBIDDEN' });
    if (!runtime) return reply(503, { error: 'PUSH_NOT_CONFIGURED' });
    try {
      const config = await deps.configuration();
      const value = request.headers.get('x-push-secret') || '';
      const secret = config.dispatchSecret || '';
      if (secret.length < 32 || value.length > 256) return reply(403, { error: 'FORBIDDEN' });
      const encoder = new TextEncoder();
      const a = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
      const b = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(secret)));
      let difference = 0;
      for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
      if (difference) return reply(403, { error: 'FORBIDDEN' });
      if (config.apiUrl !== runtime.apiUrl || config.topic !== runtime.topic || !Array.isArray(config.environments) ||
        !config.environments.length || config.environments.some(value => !runtime.environments.includes(value)) ||
        !config.enabled || !hasAPNsCredential(config)) return reply(503, { error: 'PUSH_NOT_CONFIGURED' });
      const token = apnsTokenSelector(config, deps.providerToken);
      stage = 'claim';
      const jobs = await deps.claim();
      stage = 'delivery';
      let accepted = 0, failed = 0;
      for (let offset = 0; offset < jobs.length; offset += 5) {
        await Promise.all(jobs.slice(offset, offset + 5).map(async job => {
          let result: Result = { status: 409, reason: 'Cancelled', apnsId: '' };
          if (await deps.validate(job)) {
            const jwt = job.topic === config.topic ? await token(job.environment) : null;
            result = jwt ? await deps.send(job, jwt, config) : { status: 503, reason: 'CredentialUnavailable', apnsId: '' };
          }
          await deps.finish(job, result);
          if (result.status === 200) accepted++; else failed++;
        }));
      }
      console.log(JSON.stringify({ event: 'customer_push_dispatch', claimed: jobs.length, accepted, failed }));
      return reply(200, { claimed: jobs.length, accepted, failed });
    } catch {
      console.error(JSON.stringify({ event: 'customer_push_dispatch_unavailable', stage }));
      return reply(503, { error: 'PUSH_UNAVAILABLE', stage });
    }
  };
}
