import { customerPushAction } from './push.ts';
const assert = (value: unknown) => { if (!value) throw Error('Assertion failed'); };
const device = { deviceId: 'a0000000-0000-4000-8000-000000000001', deviceSecret: 'a'.repeat(64) };
const runtime = { environment: 'cloud-test', appUrl: 'https://barber-test.alabdullah-cs.workers.dev', publicUrl: 'https://qvkucvcjmojjbphlzlks.supabase.co', secret: 'synthetic-private-signing-key-over-thirty-two-characters' };
const request = (token = '') => new Request(runtime.appUrl, { headers: token ? { authorization: `Bearer ${token}` } : {} });
Deno.test('push identity comes only from a live bearer, ignoring supplied account and topic', async () => {
  let data: Record<string, unknown> = {};
  await customerPushAction({ ...runtime, identity: async () => null, rpc: async (_, value) => { data = value; } }, request(),
    { action: 'push-register', ...device, version: 1, token: 'b'.repeat(64), environment: 'sandbox', permission: false, language: 'en',
      user_id: 'forged-account', session_id: 'forged-session', topic: 'another.bundle' });
  assert(!('user_id' in data) && !('session_id' in data) && !('topic' in data));
});
Deno.test('revoked bearer never becomes an anonymous push request', async () => {
  let calls = 0;
  try {
    await customerPushAction({ ...runtime, identity: async () => null, rpc: async () => { calls++; } }, request('revoked'), { action: 'push-status', ...device });
    throw Error('Expected failure');
  } catch (error) { assert((error as Error).message === 'AUTH_REQUIRED'); }
  assert(calls === 0);
});
Deno.test('Test registration rejects production APNs before SQL', async () => {
  let calls = 0;
  try {
    await customerPushAction({ ...runtime, identity: async () => null, rpc: async () => { calls++; } }, request(),
      { action: 'push-register', ...device, version: 1, token: 'b'.repeat(64), environment: 'production', permission: false, language: 'en' });
    throw Error('Expected failure');
  } catch (error) { assert((error as Error).message === 'INVALID_REQUEST'); }
  assert(calls === 0);
});
Deno.test('live development registration allows sandbox with server-selected live topic', async () => {
  let data: Record<string, unknown> = {};
  await customerPushAction({ ...runtime, environment: 'production', appUrl: 'https://www.barberplusplus.com', publicUrl: 'https://srv1073968.hstgr.cloud',
    identity: async () => ({ user_id: 'live-account', session_id: 'live-session' }), rpc: async (_, value) => { data = value; } }, request('live'),
    { action: 'push-register', ...device, version: 2, token: 'b'.repeat(64), environment: 'sandbox', permission: false, language: 'ar' });
  assert(data.user_id === 'live-account' && data.environment === 'sandbox' && !('topic' in data));
});
Deno.test('extra preference keys and unsigned guest capabilities are rejected', async () => {
  let calls = 0;
  const deps = { ...runtime, identity: async () => null, rpc: async () => { calls++; } };
  for (const body of [
    { action: 'push-preferences', preferences: { updates: true, reminder24: true, reminder2: true, reviews: false, untrusted: true } },
    { action: 'push-guest-subscribe', claimToken: 'forged.signature' }]) {
    try { await customerPushAction(deps, request(), { ...device, ...body }); throw Error('Expected failure'); }
    catch (error) { assert(['INVALID_REQUEST', 'FORBIDDEN'].includes((error as Error).message)); }
  }
  assert(calls === 0);
});
