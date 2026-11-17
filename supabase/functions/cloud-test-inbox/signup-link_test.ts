import { signupLink } from './signup-link.ts';
const assert = (v: unknown) => { if (!v) throw Error('Assertion failed'); };
const app = 'https://barber-test.alabdullah-cs.workers.dev';
const state = 'af220000-0000-4000-8000-000000000003';
const token = 'a'.repeat(56);
Deno.test('captured signup links mirror the direct template for web, legacy iOS and opted-in HTTPS', () => {
  for (const redirect of [`${app}/customer/email-callback?next=account`, `${app}/customer/email-callback?next=book&client=ios&state=${state}`, `https://barber-open-test.alabdullah-cs.workers.dev/auth/email?client=ios&state=${state}`]) {
    const link = signupLink(redirect, token, app);
    assert(link === redirect + '#type=signup&token_hash=' + token);
  }
});
Deno.test('captured links reject external hosts, mismatched environments, duplicates and unsupported bindings', () => {
  for (const redirect of ['https://evil.test/customer/email-callback', `${app}/customer/email-callback?next=account&next=work`, `${app}/customer/email-callback?client=ios`, `https://barber-open-test.alabdullah-cs.workers.dev/auth/email?client=ios&state=${state}&extra=bad`, `https://barber-open.alabdullah-cs.workers.dev/auth/email?client=ios&state=${state}`]) assert(signupLink(redirect, token, app) === null);
  assert(signupLink(`${app}/customer/email-callback?next=account`, 'bad', app) === null);
});
