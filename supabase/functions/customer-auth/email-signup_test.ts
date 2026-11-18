import { createCustomerEmailSignup } from './email-signup.ts';

const assert = (value: unknown) => { if (!value) throw Error('Assertion failed'); };

Deno.test('confirmed identities are conflicts without mail or account writes', async () => {
  const signup = createCustomerEmailSignup({
    lookup: async () => ({ confirmed: true }),
    create: async () => { throw Error('Unexpected account write'); },
    deliver: async () => { throw Error('Unexpected mail'); },
  });
  assert(await signup('Synthetic', 'synthetic@example.test', 'Strong123!', 'account') === 'exists');
});

Deno.test('only known Auth collision codes become signup conflicts, including a creation race', async () => {
  for (const code of ['email_exists', 'user_already_exists']) {
    const signup = createCustomerEmailSignup({
      lookup: async () => null,
      create: async () => ({ code }),
      deliver: async () => { throw Error('Unexpected mail'); },
    });
    assert(await signup('Synthetic', 'synthetic@example.test', 'Strong123!', 'account') === 'exists');
  }
});

Deno.test('unknown account errors are unavailable, never guessed from their message', async () => {
  for (const error of [{ code: 'unexpected_failure' }, {}, { code: 'weak_password' }]) {
    const signup = createCustomerEmailSignup({
      lookup: async () => null,
      create: async () => error,
      deliver: async () => { throw Error('Unexpected mail'); },
    });
    let message = '';
    try { await signup('Synthetic', 'synthetic@example.test', 'Strong123!', 'account'); }
    catch (failure) { message = (failure as Error).message; }
    assert(message === 'UNAVAILABLE');
  }
});

Deno.test('unconfirmed customers retain their account and receive confirmation without replacing details', async () => {
  const calls: unknown[][] = [];
  const signup = createCustomerEmailSignup({
    lookup: async () => ({ confirmed: false }),
    create: async () => { throw Error('Unexpected replacement'); },
    deliver: async (...args) => { calls.push(args); },
  });
  assert(await signup('Changed Name', 'synthetic@example.test', 'Different123!', 'native-https:state') === undefined);
  assert(JSON.stringify(calls) === JSON.stringify([['synthetic@example.test', 'Different123!', 'native-https:state', false]]));
});

Deno.test('new customers are created before confirmation and delivery failures remain unavailable', async () => {
  const calls: string[] = [];
  const signup = createCustomerEmailSignup({
    lookup: async () => null,
    create: async () => { calls.push('create'); return null; },
    deliver: async (_email, _password, _returnTo, created) => { assert(created); calls.push('deliver'); },
  });
  assert(await signup('Synthetic', 'synthetic@example.test', 'Strong123!', 'account') === undefined);
  assert(calls.join(',') === 'create,deliver');
  const unavailable = createCustomerEmailSignup({
    lookup: async () => null,
    create: async () => null,
    deliver: async () => { throw Error('UNAVAILABLE'); },
  });
  let message = '';
  try { await unavailable('Synthetic', 'synthetic@example.test', 'Strong123!', 'account'); }
  catch (failure) { message = (failure as Error).message; }
  assert(message === 'UNAVAILABLE');
});
