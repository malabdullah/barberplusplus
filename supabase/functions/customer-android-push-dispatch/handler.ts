import { androidTestAuth } from '../customer-auth/native-binding.ts';
import { FCM_PACKAGE, FCM_PROJECT, validCredential, type AndroidJob, type Credential, type Outcome } from './fcm.ts';
type Configuration = { apiUrl: string; projectId: string; packageName: string; mode: string; credential: Credential | null };
type Dependencies = { environment: string; appUrl: string; publicUrl: string; serviceKey: string;
  configuration: () => Promise<Configuration>; claim: () => Promise<AndroidJob[]>;
  validate: (job: AndroidJob) => Promise<boolean>; finish: (job: AndroidJob, outcome: Outcome) => Promise<void>;
  token: (credential: Credential) => Promise<string>; send: (job: AndroidJob, token: string) => Promise<Outcome> };
export function createAndroidPushDispatcher(deps: Dependencies) {
  const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  return async (request: Request) => {
    if (!androidTestAuth(deps)) return reply(503, { error: 'PUSH_NOT_CONFIGURED' });
    const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
    if (request.method !== 'POST' || deps.serviceKey.length < 32 || bearer.length > 4096) return reply(403, { error: 'FORBIDDEN' });
    const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    const a = await digest(bearer), b = await digest(deps.serviceKey);
    let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    if (difference) return reply(403, { error: 'FORBIDDEN' });
    let stage = 'configuration';
    try {
      const config = await deps.configuration();
      if (config.apiUrl !== deps.publicUrl || config.projectId !== FCM_PROJECT || config.packageName !== FCM_PACKAGE
        || !['capture', 'send'].includes(config.mode) || (config.mode === 'send' && !validCredential(config.credential))) return reply(503, { error: 'PUSH_NOT_CONFIGURED' });
      stage = 'claim';
      const jobs = await deps.claim();
      if (!Array.isArray(jobs) || jobs.length > 3) throw Error('INVALID_BATCH');
      let captured = 0, accepted = 0, failed = 0;
      // Sequential, at most three. Every real attempt was already reserved in
      // the database. No automatic retry, including on unknown transport outcome.
      for (const job of jobs) {
        stage = 'validation';
        let outcome: Outcome = { outcome: 'cancelled' };
        if (job.projectId === FCM_PROJECT && job.packageName === FCM_PACKAGE && await deps.validate(job) === true) {
          if (job.mode === 'capture') outcome = { outcome: 'captured' };
          else if (job.mode === 'send' && config.mode === 'send' && config.credential) {
            stage = 'delivery';
            try { outcome = await deps.send(job, await deps.token(config.credential)); }
            catch { outcome = { outcome: 'failed' }; }
          }
        }
        stage = 'acknowledgment'; await deps.finish(job, outcome);
        if (outcome.outcome === 'captured') captured++; else if (outcome.outcome === 'sent') accepted++; else failed++;
      }
      return reply(200, { claimed: jobs.length, captured, accepted, failed });
    } catch { return reply(503, { error: 'PUSH_UNAVAILABLE', stage }); }
  };
}
