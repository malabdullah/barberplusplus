import { createCustomerAuthHandler } from './handler.ts';

const assert = (value: unknown) => { if (!value) throw Error('Assertion failed'); };
const appUrl = 'https://barber-test.alabdullah-cs.workers.dev';
const gateway = 'synthetic-gateway-capability-for-unit-tests';
const session = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' };
const identity = { user_id: 'synthetic-customer', session_id: 'synthetic-session' };
const input = { action: 'email-login', client: 'android', email: 'synthetic@example.test', password: 'SyntheticOnly1!' };
type Dependencies = Parameters<typeof createCustomerAuthHandler>[0];

function fixture(overrides: Partial<Dependencies> = {}) {
  const events: string[] = [];
  const config: Dependencies = {
    environment: 'cloud-test', appUrl, publicUrl: 'https://qvkucvcjmojjbphlzlks.supabase.co',
    cloudTestProjectRef: 'qvkucvcjmojjbphlzlks', cloudAccessKey: gateway,
    secret: 'synthetic-signing-capability-for-unit-tests',
    rpc: async (action) => { events.push(action); return action === 'limit' ? true : { needsName: true, internal: 'omit' }; },
    emailSignIn: async () => { events.push('sign-in'); return { session, identity, name: '' }; },
    createUser: async () => { throw Error('Unexpected account creation'); },
    deleteUser: async () => { throw Error('Unexpected account deletion'); },
    signIn: async () => null, identity: async () => null,
    resetPassword: async () => { throw Error('Unexpected password change'); },
    ...overrides,
  };
  const handler = createCustomerAuthHandler(config);
  return {
    events,
    run: (body: Record<string, unknown> = input) => handler(new Request(`${config.publicUrl}/functions/v1/customer-auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.appUrl, 'x-cloud-test-key': gateway },
      body: JSON.stringify(body),
    })),
  };
}

Deno.test('verified Android Test login exposes only a provisional name requirement after existing guards', async () => {
  const f = fixture(); const response = await f.run();
  assert(response.status === 200);
  assert(JSON.stringify(await response.json()) === JSON.stringify({ session, profile: { needsName: true } }));
  assert(f.events.join(',') === 'limit,limit,sign-in,email-ensure');
});

Deno.test('web, iOS and unspecified clients retain the missing-name rejection without a session', async () => {
  for (const client of ['web', 'ios', undefined, 'ANDROID', null]) {
    const response = await fixture().run({ ...input, client });
    assert(response.status === 400);
    assert(JSON.stringify(await response.json()) === '{"error":"ACCOUNT_UNAVAILABLE"}');
  }
});

Deno.test('Android provisional login is denied outside the exact Test runtime pins', async () => {
  for (const config of [
    { environment: 'production', appUrl: 'https://www.barberplusplus.com', publicUrl: 'https://api.example.test', productionEnabled: true },
    { appUrl: 'https://other.example.test' },
    { publicUrl: 'https://abcdefghijklmnopqrst.supabase.co', cloudTestProjectRef: 'abcdefghijklmnopqrst' },
  ]) {
    const response = await fixture(config).run();
    assert(response.status === 400);
    assert(JSON.stringify(await response.json()) === '{"error":"ACCOUNT_UNAVAILABLE"}');
  }
});

Deno.test('MFA response is preserved and never enters canonical name completion', async () => {
  let ensure = 0;
  const f = fixture({
    emailSignIn: async () => ({ session, identity, name: '', mfaRequired: true }),
    rpc: async (action) => { if (action === 'email-ensure') ensure++; return true; },
  });
  const response = await f.run();
  assert(response.status === 200);
  assert(JSON.stringify(await response.json()) === JSON.stringify({ session, mfaRequired: true }));
  assert(ensure === 0);
});

Deno.test('invalid credentials and failed eligibility never expose a provisional session', async () => {
  const invalid = await fixture({ emailSignIn: async () => null }).run();
  assert(invalid.status === 401 && JSON.stringify(await invalid.json()) === '{"error":"INVALID_LOGIN"}');
  for (const reason of ['AUTH_REQUIRED', 'STAFF_ACCOUNT']) {
    const denied = await fixture({ rpc: async (action) => { if (action === 'email-ensure') throw Error(reason); return true; } }).run({ ...input, role: 'customer', user_id: 'forged' });
    assert(denied.status !== 200 && !(await denied.json()).session);
  }
});

Deno.test('rate limiting still precedes credentials and provisional-session responses', async () => {
  let signIns = 0;
  const response = await fixture({ rpc: async () => false, emailSignIn: async () => { signIns++; return { session, identity, name: '' }; } }).run();
  assert(response.status === 429 && signIns === 0 && !(await response.json()).session);
});

Deno.test('missing or malformed name requirements cannot expose the new provisional response', async () => {
  for (const profile of [null, { needsName: 'true' }]) {
    const response = await fixture({ rpc: async (action) => action === 'limit' ? true : profile }).run();
    assert(response.status === 400 && !(await response.json()).session);
  }
});

Deno.test('ordinary canonical login response remains unchanged', async () => {
  const profile = { id: 'synthetic-customer', name: 'Synthetic Customer' };
  const response = await fixture({ rpc: async (action) => action === 'limit' ? true : profile }).run();
  assert(response.status === 200 && JSON.stringify(await response.json()) === JSON.stringify({ session, profile }));
});
