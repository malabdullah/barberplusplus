import { androidPushAction } from './android-push.ts';
const assert = (value: unknown) => { if (!value) throw Error('Assertion failed'); };
const id = 'ad650000-0000-4000-8000-000000000001';
const base = { environment: 'cloud-test', appUrl: 'https://barber-test.alabdullah-cs.workers.dev', publicUrl: 'https://qvkucvcjmojjbphlzlks.supabase.co' };
const request = () => new Request('https://test.invalid', { headers: { authorization: 'Bearer synthetic' } });
const body = { action: 'push-register', client: 'android', provider: 'fcm', projectId: 'barber-plus-plus-phone-test', packageName: 'com.barberplusplus.customer.test',
  deviceId: id, deviceSecret: 'a'.repeat(64), version: 1, token: 'synthetic-fcm-token:'.repeat(10), language: 'en', permission: true };
function harness() {
  const calls: { action: string; data: Record<string, unknown> }[] = [];
  const deps = { ...base, identity: () => Promise.resolve({ user_id: id, session_id: id }), rpc: (action: string, data: Record<string, unknown>) => {
    calls.push({ action, data }); return Promise.resolve({ success: true });
  } }; return { deps, calls };
}
async function rejects(run: () => Promise<unknown>, expected: string) {
  try { await run(); } catch (e) { assert(e instanceof Error && e.message === expected); return; } throw Error('Expected rejection');
}
Deno.test('FCM registration derives identity and routes only to its separate Test RPC', async () => {
  const h = harness(); await androidPushAction(h.deps, request(), { ...body, user_id: 'attacker', session_id: 'attacker' });
  assert(h.calls.length === 1 && h.calls[0].action === 'android-push-register' && h.calls[0].data.user_id === id && h.calls[0].data.session_id === id);
});
Deno.test('FCM refuses other deployment identities before any RPC', async () => {
  for (const change of [{ environment: 'production' }, { publicUrl: 'https://other.supabase.co' }, { appUrl: 'https://www.barberplusplus.com' }]) {
    const h = harness(); await rejects(() => androidPushAction({ ...h.deps, ...change }, request(), body), 'INVALID_REQUEST'); assert(h.calls.length === 0);
  }
});
Deno.test('FCM refuses wrong project, package, provider and token shape', async () => {
  for (const change of [{ projectId: 'live-project' }, { packageName: 'com.barberplusplus.customer' }, { provider: 'apns' }, { token: 'a b'.repeat(30) }, { token: 'x'.repeat(4097) }]) {
    const h = harness(); await rejects(() => androidPushAction(h.deps, request(), { ...body, ...change }), 'INVALID_REQUEST'); assert(h.calls.length === 0);
  }
});
Deno.test('FCM registration needs a live account while capability-only detach remains possible', async () => {
  const h = harness(); await rejects(() => androidPushAction(h.deps, new Request('https://test.invalid'), body), 'AUTH_REQUIRED');
  await androidPushAction(h.deps, new Request('https://test.invalid'), { ...body, action: 'push-detach' });
  assert(h.calls.length === 1 && h.calls[0].action === 'android-push-detach' && !h.calls[0].data.user_id);
});
Deno.test('FCM rejects stale session tokens and unapproved guest actions', async () => {
  const h = harness(); await rejects(() => androidPushAction({ ...h.deps, identity: () => Promise.resolve(null) }, request(), body), 'AUTH_REQUIRED');
  await rejects(() => androidPushAction(h.deps, request(), { ...body, action: 'push-guest-subscribe' }), 'INVALID_REQUEST'); assert(h.calls.length === 0);
});
Deno.test('FCM validates complete preference shape and monotonic integer versions', async () => {
  const h = harness(); for (const version of [0, -1, 1.2, '1', Number.MAX_SAFE_INTEGER + 1]) {
    await rejects(() => androidPushAction(h.deps, request(), { ...body, version }), 'INVALID_REQUEST');
  }
  await rejects(() => androidPushAction(h.deps, request(), { ...body, action: 'push-preferences', preferences: { updates: true } }), 'INVALID_REQUEST');
  assert(h.calls.length === 0);
});

Deno.test('Live registration requires explicit activation and derives its owner with exact production identities',async()=>{
 const h=harness();const deps={...h.deps,environment:'production',appUrl:'https://www.barberplusplus.com',publicUrl:'https://srv1073968.hstgr.cloud',androidEnabled:true};
 const live={...body,projectId:'barber-plus-plus-phone-prod',packageName:'com.barberplusplus.customer',user_id:'forged'};
 await androidPushAction(deps,request(),live);assert(h.calls[0].data.user_id===id);
 await rejects(()=>androidPushAction({...deps,androidEnabled:false},request(),live),'INVALID_REQUEST');
 await rejects(()=>androidPushAction(deps,request(),body),'INVALID_REQUEST');assert(h.calls.length===1);
});

Deno.test('closed Live transport admits only the time-bound authenticated installation for status and registration', async () => {
  const h = harness();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.deviceSecret));
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  const scope = { userId: id, deviceId: id, secretHash: hash, startsAtMs: now - 1000, expiresAtMs: now + 60_000 };
  const deps = { ...h.deps, environment: 'production', appUrl: 'https://www.barberplusplus.com',
    publicUrl: 'https://srv1073968.hstgr.cloud', androidEnabled: false, androidPushEnrollmentScope: JSON.stringify(scope) };
  const live = { ...body, projectId: 'barber-plus-plus-phone-prod', packageName: 'com.barberplusplus.customer' };
  const send = (values = {}, settings = {}, req = request()) =>
    androidPushAction({ ...deps, ...settings }, req, { ...live, ...values });
  for (const raw of ['', '{', JSON.stringify({ ...scope, expiresAtMs: now - 1 }),
    JSON.stringify({ ...scope, startsAtMs: now + 10000 }), JSON.stringify({ ...scope, expiresAtMs: now + 900000 })]) {
    await rejects(() => send({}, { androidPushEnrollmentScope: raw }), 'INVALID_REQUEST');
  }
  for (const action of ['push-detach', 'push-preferences', 'bookings']) await rejects(() => send({ action }), 'INVALID_REQUEST');
  await rejects(() => send({ deviceId: crypto.randomUUID() }), 'FORBIDDEN');
  await rejects(() => send({ deviceSecret: 'b'.repeat(64) }), 'FORBIDDEN');
  await rejects(() => send({ user_id: id }, { identity: () => Promise.resolve({user_id: crypto.randomUUID(), session_id: id}) }), 'FORBIDDEN');
  await rejects(() => send({}, {}, new Request('https://test.invalid')), 'AUTH_REQUIRED');
  await rejects(() => send({}, { appUrl: 'https://example.invalid' }), 'INVALID_REQUEST');
  await rejects(() => send({ packageName: body.packageName }), 'INVALID_REQUEST');
  assert(h.calls.length === 0);
  await send({ action: 'push-status' });
  await send({ user_id: 'untrusted' });
  assert(h.calls.map(c => c.action).join(',') === 'android-push-status,android-push-register');
  assert(h.calls[1].data.user_id === id && h.calls[1].data.session_id === id);
});
