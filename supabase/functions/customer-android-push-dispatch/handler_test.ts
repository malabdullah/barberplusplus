import { createAndroidPushDispatcher } from './handler.ts';
import { FCM_EMAIL, FCM_PACKAGE, FCM_PROJECT, type AndroidJob, type Outcome } from './fcm.ts';
const assert = (value: unknown) => { if (!value) throw Error('Assertion failed'); };
const serviceKey = 'synthetic-server-key-'.repeat(4);
const job: AndroidJob = { id: 'ad650000-0000-4000-8000-000000000001', lease: 'ad650000-0000-4000-8000-000000000002',
  token: 'synthetic-fcm-token:'.repeat(10), mode: 'capture', projectId: FCM_PROJECT, packageName: FCM_PACKAGE, language: 'en', kind: 'test', expiresAt: Math.floor(Date.now() / 1000) + 3600 };
function harness() {
  const calls = { claim: 0, token: 0, send: 0, outcomes: [] as Outcome[] };
  const config = { apiUrl: 'https://qvkucvcjmojjbphlzlks.supabase.co', projectId: FCM_PROJECT, packageName: FCM_PACKAGE, mode: 'capture', credential: {
    type: 'service_account', project_id: FCM_PROJECT, client_email: FCM_EMAIL, private_key_id: 'a'.repeat(40), private_key: '-----BEGIN PRIVATE KEY-----synthetic', token_uri: 'https://oauth2.googleapis.com/token',
  } };
  const deps = { environment: 'cloud-test', appUrl: 'https://barber-test.alabdullah-cs.workers.dev', publicUrl: config.apiUrl, serviceKey,
    configuration: () => Promise.resolve(config), claim: () => { calls.claim++; return Promise.resolve([{ ...job }]); },
    validate: () => Promise.resolve(true), finish: (_job: AndroidJob, outcome: Outcome) => { calls.outcomes.push(outcome); return Promise.resolve(); },
    token: () => { calls.token++; return Promise.resolve('synthetic'); }, send: () => { calls.send++; return Promise.resolve({ outcome: 'sent' } as Outcome); },
  }; return { calls, config, deps };
}
const request = (token = serviceKey) => new Request('https://test.invalid', { method: 'POST', headers: { authorization: 'Bearer ' + token } });
Deno.test('FCM capture acknowledges without obtaining credentials or contacting Google', async () => {
  const h = harness(); const response = await createAndroidPushDispatcher(h.deps)(request());
  const body = await response.json(); assert(response.status === 200 && body.captured === 1 && body.accepted === 0);
  assert(h.calls.token === 0 && h.calls.send === 0 && h.calls.outcomes[0].outcome === 'captured');
});
Deno.test('FCM dispatcher rejects user bearer tokens and production runtime before claiming', async () => {
  const h = harness(); assert((await createAndroidPushDispatcher(h.deps)(request('synthetic-user-token'))).status === 403);
  assert((await createAndroidPushDispatcher({ ...h.deps, environment: 'production' })(request())).status === 503); assert(h.calls.claim === 0);
});
Deno.test('FCM dispatcher refuses wrong project configuration before any queue claim', async () => {
  const h = harness(); h.config.projectId = 'live-project'; assert((await createAndroidPushDispatcher(h.deps)(request())).status === 503); assert(h.calls.claim === 0);
});
Deno.test('invalidated or rotated binding is cancelled without provider dispatch', async () => {
  const h = harness(); await createAndroidPushDispatcher({ ...h.deps, validate: () => Promise.resolve(false) })(request());
  assert(h.calls.outcomes[0].outcome === 'cancelled' && h.calls.send === 0);
});
Deno.test('only explicitly reserved send-mode jobs use the provider', async () => {
  const h = harness(); h.config.mode = 'send';
  const response = await createAndroidPushDispatcher({ ...h.deps, claim: () => Promise.resolve([{ ...job, mode: 'send' }]) })(request());
  assert(response.status === 200 && h.calls.send === 1 && h.calls.token === 1 && h.calls.outcomes[0].outcome === 'sent');
});
Deno.test('provider uncertainty is terminal and never retried by the dispatcher', async () => {
  const h = harness(); h.config.mode = 'send';
  await createAndroidPushDispatcher({ ...h.deps, claim: () => Promise.resolve([{ ...job, mode: 'send' }]), send: () => {
    h.calls.send++; return Promise.resolve({ outcome: 'uncertain' } as Outcome);
  } })(request());
  assert(h.calls.send === 1 && h.calls.outcomes.length === 1 && h.calls.outcomes[0].outcome === 'uncertain');
});
Deno.test('a lost acknowledgment does not cause another claim or send', async () => {
  const h = harness(); const response = await createAndroidPushDispatcher({ ...h.deps, finish: () => { throw Error('synthetic acknowledgment loss'); } })(request());
  assert(response.status === 503 && h.calls.claim === 1 && h.calls.send === 0 && (await response.json()).stage === 'acknowledgment');
});
Deno.test('over-budget batches fail without provider access or leaking job tokens', async () => {
  const h = harness(); const response = await createAndroidPushDispatcher({ ...h.deps, claim: () => Promise.resolve(Array.from({ length: 4 }, () => job)) })(request());
  assert(response.status === 503 && h.calls.send === 0 && !(await response.text()).includes(job.token));
});
