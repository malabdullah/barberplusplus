import { createCustomerAnnouncementsHandler } from './handler.ts';
const assert = (v: unknown) => {
  if (!v) throw Error('Assertion failed');
};
const runtime = {
  environment: 'test',
  appUrl: 'http://localhost:5173',
  publicUrl: 'http://127.0.0.1:54321',
  secret: 's'.repeat(64),
};
const identity = {
  user_id: 'a0000000-0000-4000-8000-000000000001',
  session_id: 'a0000000-0000-4000-8000-000000000002',
};
const device = {
  deviceId: 'a0000000-0000-4000-8000-000000000003',
  deviceSecret: 'a'.repeat(64),
  version: 1,
};
const request = (body: unknown) =>
  new Request(runtime.appUrl, {
    method: 'POST',
    headers: { origin: runtime.appUrl, authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
Deno.test('announcement preference needs live identity and installation proof without touching booking preferences', async () => {
  let data: Record<string, unknown> = {};
  let calls = 0;
  const handle = createCustomerAnnouncementsHandler({
    ...runtime,
    identity: async () => identity,
    rpc: async (_, value) => {
      calls++;
      data = value;
      return { enabled: false, version: 1, recipientBinding: 'b'.repeat(64) };
    },
  });
  const r = await handle(
    request({
      action: 'preference',
      ...device,
      enabled: true,
      user_id: 'forged',
      session_id: 'forged',
      preferences: { updates: false },
    }),
  );
  assert(
    r.status === 200 && (await r.json()).recipientBinding === 'b'.repeat(64),
  );
  assert(
    data.user_id === identity.user_id &&
      data.session_id === identity.session_id && !('preferences' in data),
  );
  for (
    const body of [
      { action: 'preference', ...device, enabled: 'true' },
      { action: 'register', ...device, version: 2 },
      { action: 'register', ...device, deviceSecret: 'bad' },
      { action: 'register', ...device, body: 'x'.repeat(3000) },
    ]
  ) assert([400, 413].includes((await handle(request(body))).status));
  assert(calls === 1);
  const signedOut = createCustomerAnnouncementsHandler({
    ...runtime,
    identity: async () => null,
    rpc: async () => {
      throw Error('should not call');
    },
  });
  assert((await signedOut(request({ action: 'status' }))).status === 401);
});

Deno.test('announcement first setup forwards only a typed register flag and trusted identity', async () => {
  const calls: Record<string, unknown>[] = [];
  const handle = createCustomerAnnouncementsHandler({
    ...runtime,
    identity: async () => identity,
    rpc: async (_, value) => {
      calls.push(value);
      return { enabled: true, version: 1, preferenceConfigured: true };
    },
  });
  for (const initializeDefaults of [true, false]) {
    const response = await handle(request({
      action: 'register', ...device, initializeDefaults, user_id: 'forged',
    }));
    assert(response.status === 200);
    assert((await response.json()).preferenceConfigured === true);
    assert(calls.at(-1)?.initializeDefaults === initializeDefaults);
    assert(calls.at(-1)?.user_id === identity.user_id);
  }
  assert((await handle(request({ action: 'register', ...device }))).status === 200);
  assert(!('initializeDefaults' in calls[2]));
  for (const body of [
    { action: 'register', ...device, initializeDefaults: 'true' },
    { action: 'register', ...device, initializeDefaults: null },
    { action: 'status', initializeDefaults: true },
    { action: 'preference', ...device, enabled: true, initializeDefaults: true },
  ]) assert((await handle(request(body))).status === 400);
  assert(calls.length === 3);
});
