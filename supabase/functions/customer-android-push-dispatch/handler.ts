import { androidRuntime } from '../customer-auth/android-runtime.ts';
import { validCredential, type AndroidJob, type Credential, type FCMTarget, type Outcome } from './fcm.ts';
type Configuration = { apiUrl: string; projectId: string; packageName: string; mode: string; credential: Credential | null; enabled?: boolean; senderEmail?: string };
type Dependencies = { environment: string; appUrl: string; publicUrl: string; androidEnabled?: boolean; androidPushEnabled?: boolean;
  authorizeService: (token: string) => Promise<boolean>; authorizeDispatch?: (secret: string) => Promise<boolean>; configuration: () => Promise<Configuration>; claim: () => Promise<AndroidJob[]>;
  validate: (job: AndroidJob) => Promise<boolean>; finish: (job: AndroidJob, outcome: Outcome) => Promise<void>;
  token: (credential: Credential, target: FCMTarget) => Promise<string>; send: (job: AndroidJob, token: string, target: FCMTarget) => Promise<Outcome> };
export function createAndroidPushDispatcher(deps: Dependencies) {
  const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  return async (request: Request) => {
    const runtime = androidRuntime(deps);
    if (!runtime || (runtime.environment === 'production' && deps.androidPushEnabled !== true)) return reply(503, { error: 'PUSH_NOT_CONFIGURED' });
    const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
    const dispatchSecret = request.headers.get('x-android-push-secret') || '';
    if (request.method !== 'POST') return reply(403, { error: 'FORBIDDEN' });
    try {
      const approved = runtime.environment === 'production' && /^[0-9a-f]{64}$/.test(dispatchSecret) && deps.authorizeDispatch
        ? await deps.authorizeDispatch(dispatchSecret)
        : /^[A-Za-z0-9._-]{32,4096}$/.test(bearer) && await deps.authorizeService(bearer);
      if (approved !== true) return reply(403, { error: 'FORBIDDEN' });
    } catch { return reply(403, { error: 'FORBIDDEN' }); }
    let stage = 'configuration';
    try {
      const config = await deps.configuration();
      const target: FCMTarget = { environment: runtime.environment, projectId: runtime.projectId, packageName: runtime.packageName,
        senderEmail: runtime.environment === 'cloud-test' ? 'barber-android-test-sender@barber-plus-plus-phone-test.iam.gserviceaccount.com' : config.senderEmail };
      if (config.apiUrl !== runtime.apiUrl || config.projectId !== target.projectId || config.packageName !== target.packageName
        || (runtime.environment === 'production' && config.enabled !== true) || !['capture', 'send'].includes(config.mode)
        || (config.mode === 'send' && !validCredential(config.credential, target))) return reply(503, { error: 'PUSH_NOT_CONFIGURED' });
      stage = 'claim'; const jobs = await deps.claim();
      if (!Array.isArray(jobs) || jobs.length > (runtime.environment === 'production' ? 20 : 3)) throw Error('INVALID_BATCH');
      let captured = 0, accepted = 0, failed = 0;
      for (const job of jobs) {
        stage = 'validation'; let outcome: Outcome = { outcome: 'cancelled' };
        if (job.projectId === target.projectId && job.packageName === target.packageName
          && (runtime.environment !== 'production' || job.environment === 'production') && await deps.validate(job) === true) {
          if (job.mode === 'capture' && config.mode === 'capture') outcome = { outcome: 'captured' };
          else if (job.mode === 'send' && config.mode === 'send' && config.credential) {
            stage = 'delivery';
            try {
              const token = await deps.token(config.credential, target);
              // Credential minting may take time. Recheck ownership, permission,
              // revision, current token/version and the lease immediately before send.
              if (await deps.validate(job) === true) outcome = await deps.send(job, token, target);
            } catch { outcome = { outcome: 'failed' }; }
          }
        }
        stage = 'acknowledgment'; await deps.finish(job, outcome);
        if (outcome.outcome === 'captured') captured++; else if (outcome.outcome === 'sent') accepted++; else failed++;
      }
      return reply(200, { claimed: jobs.length, captured, accepted, failed });
    } catch { return reply(503, { error: 'PUSH_UNAVAILABLE', stage }); }
  };
}
