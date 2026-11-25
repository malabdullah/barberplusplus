import { nativePushRuntime } from '../_shared/native-push-runtime.ts';
import { type APNsConfiguration, type APNsCredential, apnsTokenSelector, hasAPNsCredential } from '../_shared/apns-credentials.ts';
import { type AnnouncementJob, announcementPayload } from './delivery.ts';
import { androidAnnouncementPayload } from './android.ts';
import { type Credential, LIVE_TARGET, validCredential } from '../customer-android-push-dispatch/fcm.ts';
type Configuration = APNsConfiguration & {
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
  androidAnnouncementsEnabled?: boolean;
  android?: { apiUrl: string; projectId: string; packageName: string; enabled: boolean; mode: string; senderEmail: string; credential: Credential };
};
type Dependencies = {
  environment: string;
  appUrl: string;
  publicUrl: string;
  androidEnabled?: boolean;
  androidPushEnabled?: boolean;
  androidAnnouncementsEnabled?: boolean;
  configuration: () => Promise<Configuration>;
  claim: () => Promise<AnnouncementJob[]>;
  continueWork: () => Promise<void>;
  validate: (job: AnnouncementJob) => Promise<boolean>;
  finish: (
    job: AnnouncementJob,
    result: { status: number; reason: string; providerId: string },
  ) => Promise<void>;
  providerToken: (key: APNsCredential) => Promise<string>;
  androidToken?: (credential: Credential, senderEmail: string) => Promise<string>;
  sendAndroid?: (job: AnnouncementJob, jwt: string) => Promise<{ status: number; reason: string; providerId: string }>;
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
        !hasAPNsCredential(config)
      ) return reply(503, { error: 'DELIVERY_DISABLED' });
      const token = apnsTokenSelector(config, deps.providerToken);
      const androidConfig = config.android;
      const androidLive = deps.environment === 'production' && deps.androidEnabled === true && deps.androidPushEnabled === true
        && deps.androidAnnouncementsEnabled === true && config.androidAnnouncementsEnabled === true
        && config.deliveryMode === 'apns' && androidConfig?.enabled === true && androidConfig.mode === 'send'
        && androidConfig.apiUrl === runtime.apiUrl && androidConfig.projectId === LIVE_TARGET.projectId
        && androidConfig.packageName === LIVE_TARGET.packageName
        && validCredential(androidConfig.credential, { ...LIVE_TARGET, senderEmail: androidConfig.senderEmail });
      const jobs = await deps.claim();
      let captured = 0, accepted = 0, other = 0;
      for (let index = 0; index < jobs.length; index += 5) {
        await Promise.all(
          jobs.slice(index, index + 5).map(async (job) => {
            const android = job.client === 'android';
            let payloadValid = false;
            try {
              const payload = android ? androidAnnouncementPayload(job) : announcementPayload(job);
              payloadValid = new TextEncoder().encode(JSON.stringify(payload)).length <= 4096;
            } catch { /* Invalid jobs are acknowledged without provider access. */ }
            const valid = (!job.client || job.client === 'ios' || android) && payloadValid
              && (!android || (deps.environment === 'cloud-test' && job.environment === 'cloud-test' && config.deliveryMode === 'capture' && config.androidAnnouncementsEnabled === true)
                || (androidLive && job.environment === 'production'))
              && job.deliveryMode === config.deliveryMode &&
              /^[0-9a-f]{64}$/.test(job.recipientBinding) &&
              await deps.validate(job);
            const jwt = valid && !android && config.deliveryMode === 'apns' && job.topic === config.topic
              ? await token(job.environment) : null;
            let result = !valid
              ? { status: 409, reason: 'NoLongerEligible', providerId: '' }
              : config.deliveryMode === 'capture'
              ? { status: 200, reason: 'Captured', providerId: '' }
              : jwt ? await deps.send(job, jwt, config)
              : { status: 503, reason: 'CredentialUnavailable', providerId: '' };
            if (valid && androidLive && android && androidConfig && deps.androidToken && deps.sendAndroid) {
              let access: string | null = null;
              try { access = await deps.androidToken(androidConfig.credential, androidConfig.senderEmail); }
              catch { result = { status: 503, reason: 'CredentialUnavailable', providerId: '' }; }
              if (access) {
                if (await deps.validate(job)) {
                  try { result = await deps.sendAndroid(job, access); }
                  catch { result = { status: 0, reason: 'TransportUnconfirmed', providerId: '' }; }
                } else result = { status: 409, reason: 'NoLongerEligible', providerId: '' };
              }
            }
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
