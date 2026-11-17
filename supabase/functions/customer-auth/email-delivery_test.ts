import { createCustomerEmailDelivery } from './email-delivery.ts';
const id = 'af220000-0000-4000-8000-000000000003';
const assert = (v: unknown) => { if (!v) throw Error('Assertion failed'); };
Deno.test('only opted-in signup uses the signed-environment HTTPS helper; legacy and recovery remain unchanged', async () => {
  for (const environment of ['cloud-test', 'production']) {
    const app = environment === 'cloud-test' ? 'https://barber-test.alabdullah-cs.workers.dev' : 'https://www.barberplusplus.com';
    const helper = environment === 'cloud-test' ? 'https://barber-open-test.alabdullah-cs.workers.dev' : 'https://barber-open.alabdullah-cs.workers.dev';
    let target = '';
    const auth = { resend: async (p: { options: { emailRedirectTo: string } }) => { target = p.options.emailRedirectTo; return { error: null }; }, resetPasswordForEmail: async (_email: string, p: { redirectTo: string }) => { target = p.redirectTo; return { error: null }; } };
    const send = createCustomerEmailDelivery(auth, app, environment);
    await send('synthetic@example.test', 'confirm', `native-https:${id}`);
    assert(target === `${helper}/auth/email?client=ios&state=${id}`);
    await send('synthetic@example.test', 'confirm', `native:${id}`);
    assert(target === `${app}/customer/email-callback?next=account&client=ios&state=${id}`);
    await send('synthetic@example.test', 'recovery', `native:${id}`);
    assert(new URL(target).origin === app && new URL(target).pathname === '/customer/email-callback');
    let rejected = false;
    try { await send('synthetic@example.test', 'recovery', `native-https:${id}`); } catch { rejected = true; }
    assert(rejected);
  }
});
Deno.test('invalid state and mismatched environments cannot select another helper', async () => {
  const auth = { resend: async () => { throw Error('must not send'); }, resetPasswordForEmail: async () => { throw Error('must not send'); } };
  for (const [app, environment, state] of [['https://www.barberplusplus.com', 'cloud-test', id], ['https://barber-test.alabdullah-cs.workers.dev', 'cloud-test', 'bad']]) {
    let rejected = false;
    try { await createCustomerEmailDelivery(auth, app, environment)('synthetic@example.test', 'confirm', `native-https:${state}`); } catch { rejected = true; }
    assert(rejected);
  }
});
