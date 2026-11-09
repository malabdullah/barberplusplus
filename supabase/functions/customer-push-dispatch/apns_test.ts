import { nativePushRuntime } from '../_shared/native-push-runtime.ts';
import { sendAPNs, pushContent, type PushJob } from './apns.ts';
const assert = (value: unknown) => { if (!value) throw Error('Assertion failed'); };
const job: PushJob = { id: 'job', lease: 'lease', eventId: 'event', bookingId: 'booking', kind: 'confirmed', actor: 'shop',
  token: 'a'.repeat(64), environment: 'sandbox', topic: 'com.barberplusplus.customer.test', language: 'en', date: '2026-11-12', time: '10:00', shop: 'QA Shop', barber: 'QA Barber', expiresAt: 1800000000 };
Deno.test('deployment identity rejects mixed Test/live origins', () => {
  assert(nativePushRuntime({ environment: 'production', appUrl: 'https://www.barberplusplus.com', publicUrl: 'https://qvkucvcjmojjbphlzlks.supabase.co' }) === null);
  assert(nativePushRuntime({ environment: 'cloud-test', appUrl: 'https://barber-test.alabdullah-cs.workers.dev', publicUrl: 'https://srv1073968.hstgr.cloud' }) === null);
});
Deno.test('sandbox Test and live development builds select sandbox APNs; distribution selects production APNs', async () => {
  for (const [topic, environment, host] of [
    ['com.barberplusplus.customer.test', 'sandbox', 'api.sandbox.push.apple.com'],
    ['com.barberplusplus.customer', 'sandbox', 'api.sandbox.push.apple.com'],
    ['com.barberplusplus.customer', 'production', 'api.push.apple.com']]) {
    let calls = 0;
    const send: typeof fetch = async (url, options) => { calls++; assert(new URL(String(url)).host === host); assert(new Headers(options?.headers).get('apns-topic') === topic); return new Response('{}', { status: 200 }); };
    const result = await sendAPNs({ ...job, topic, environment }, 'synthetic-token', send, { topic, environments: [environment] });
    assert(result.status === 200 && calls === 1);
  }
});
Deno.test('topic, environment and token mismatches never contact APNs', async () => {
  let calls = 0;
  const send: typeof fetch = async () => { calls++; return new Response('{}'); };
  for (const patch of [{ topic: 'com.barberplusplus.customer' }, { environment: 'production' }, { token: '../other' }]) {
    const result = await sendAPNs({ ...job, ...patch }, '', send, { topic: job.topic, environments: ['sandbox'] });
    assert(result.reason === 'EnvironmentMismatch');
  }
  assert(calls === 0);
});
Deno.test('staff cancellation reason is bounded and customer cancellations do not disclose it', () => {
  const staff = pushContent({ ...job, kind: 'cancelled', cancellationReason: 'x'.repeat(1000) });
  const customer = pushContent({ ...job, kind: 'cancelled', actor: 'customer', cancellationReason: 'Private staff note' });
  assert(staff.aps.alert.body.includes('x'.repeat(300)) && !staff.aps.alert.body.includes('x'.repeat(301)));
  assert(!customer.aps.alert.body.includes('Private staff note'));
});
