import { createDeletionMailer, deletionDeliveryKey, deletionEmail } from './mail.ts';
import { deletionConfiguration, PRODUCTION_API, PRODUCTION_APP, TEST_API, TEST_APP } from './configuration.ts';
const equal = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error('Values differ'); };
const assert = (v: unknown) => { if (!v) throw Error('Assertion failed'); };
const id = '8c43610f-3c44-4c96-bb21-99572d110f1f';
const prod = () => deletionConfiguration({ environment: 'production', appUrl: PRODUCTION_APP, publicUrl: PRODUCTION_API, backendUrl: 'http://kong:8000', productionBackendUrl: 'http://kong:8000', productionEnabled: 'true', productionCleanupEnabled: 'true', resendKey: 're_mock_key' });
const test = () => deletionConfiguration({ environment: 'cloud-test', appUrl: TEST_APP, publicUrl: TEST_API, backendUrl: TEST_API, productionEnabled: 'true', productionCleanupEnabled: 'true', resendKey: 'must-never-be-used' });
Deno.test('Test captures branded messages and never calls the mail provider, even if a key is present', async () => {
  const captured: unknown[] = []; let calls = 0;
  const mail = createDeletionMailer({ configuration: test(), resendKey: 'must-never-be-used', capture: async (...args) => { captured.push(args); }, fetch: async () => { calls++; throw Error('network forbidden'); } });
  await mail('qa@example.test', '123456', 'en', id);
  await mail('qa@example.test', '123456', 'en', id);
  equal(calls, 0); equal(captured[0], captured[1]);
  const value = captured[0] as [string, { subject: string; text: string; html: string }];
  assert(/^[0-9a-f-]{36}$/.test(value[0])); assert(value[1].text.includes('123456')); assert(value[1].html.includes(TEST_APP));
});
Deno.test('production adapter sends only to the fixed Resend endpoint with stable key, approved sender, reply-to and timeout', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const mail = createDeletionMailer({ configuration: prod(), resendKey: 're_mock_key', capture: async () => { throw Error('production cannot capture'); }, fetch: async (url, init) => { requests.push({ url, init }); return Response.json({ id: 'mock-provider-message' }); } });
  await mail('verified@example.test', '123456', 'en', id); await mail('verified@example.test', '123456', 'en', id);
  equal(requests[0].url, 'https://api.resend.com/emails'); equal(requests[0].init.redirect, 'error'); assert(requests[0].init.signal instanceof AbortSignal);
  equal(requests[0].init.body, requests[1].init.body);
  equal((requests[0].init.headers as Record<string,string>)['Idempotency-Key'], await deletionDeliveryKey(id));
  const body = JSON.parse(requests[0].init.body as string); equal(body.from, 'Barber++ <noreply@barberplusplus.com>'); equal(body.reply_to, 'support@barberplusplus.com'); equal(body.to, ['verified@example.test']);
  assert(body.html.includes(PRODUCTION_APP + '/customer/delete-account')); assert(!body.html.includes(TEST_APP)); assert(!body.html.includes('?code='));
  assert(!(requests[0].init.headers as Record<string,string>)['Idempotency-Key'].includes('verified'));
});
Deno.test('resend generation gets a distinct deterministic provider key without contact or code', async () => {
  const first = await deletionDeliveryKey(id); const second = await deletionDeliveryKey(id + '-2026-11-13T14:12:00.000+00:00');
  assert(first !== second); equal(second, await deletionDeliveryKey(id + '-2026-11-13T14:12:00.000+00:00')); assert(second.length < 256);
});
Deno.test('Arabic template and sender do not contain unescaped user input', () => {
  const email = deletionEmail('qa@example.test', '123456', 'ar', PRODUCTION_APP);
  assert(email.html.includes('dir="rtl"')); assert(email.html.includes('lang="ar"')); assert(email.html.includes('dir="ltr"')); assert(email.text.includes('10')); assert(email.text.includes('123456')); equal(email.subject, 'تأكيد حذف حساب Barber++');
  for (const [address, code, url] of [['qa@example.test\r\nBcc: victim@example.test', '123456', PRODUCTION_APP], ['qa@example.test', '<img>', PRODUCTION_APP], ['qa@example.test', '123456', 'https://evil.test']]) {
    let rejected = false; try { deletionEmail(address, code, 'en', url); } catch { rejected = true; } assert(rejected);
  }
});
Deno.test('provider rejection, invalid ack and uncertain network outcome produce only a safe error, without automatic retry', async () => {
  for (const response of [() => new Response('secret/contact/provider diagnostics', { status: 429 }), () => new Response('secret/contact', { status: 409 }), () => Response.json({}), () => { throw Error('API key recipient details timeout'); }]) {
    let calls = 0; const mail = createDeletionMailer({ configuration: prod(), resendKey: 're_mock', capture: async () => {}, fetch: async () => { calls++; return response(); } });
    try { await mail('qa@example.test', '123456', 'en', id); throw Error('unexpected success'); } catch (failure) { equal((failure as Error).message, 'EMAIL_UNAVAILABLE'); }
    equal(calls, 1);
  }
});
Deno.test('disabled or cleanup-only configuration cannot send or capture a new proof email', async () => {
  let calls = 0; const config = { ...prod(), newRequestsEnabled: false };
  const mail = createDeletionMailer({ configuration: config, resendKey: 're_mock', capture: async () => { calls++; }, fetch: async () => { calls++; return Response.json({ id: 'x' }); } });
  let rejected = false; try { await mail('qa@example.test', '123456', 'en', id); } catch { rejected = true; } assert(rejected); equal(calls, 0);
});
