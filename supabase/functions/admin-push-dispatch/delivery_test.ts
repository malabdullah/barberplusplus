import {
  type AnnouncementJob,
  announcementPayload,
  sendAnnouncement,
} from './delivery.ts';
import { createAnnouncementDispatcher } from './handler.ts';
const assert = (v: unknown) => {
  if (!v) throw Error('Assertion failed');
};
const job: AnnouncementJob = {
  id: 'a0000000-0000-4000-8000-000000000001',
  lease: 'a0000000-0000-4000-8000-000000000002',
  campaignId: 'a0000000-0000-4000-8000-000000000003',
  recipientBinding: 'b'.repeat(64),
  deliveryMode: 'capture',
  token: 'c'.repeat(64),
  environment: 'sandbox',
  topic: 'com.barberplusplus.customer.test',
  language: 'ar',
  titleEn: 'Hello',
  bodyEn: 'Book a haircut',
  titleAr: '',
  bodyAr: '',
  destination: 'book',
  expiresAt: 2000000000,
};
const config = {
  announcementEnabled: true,
  deliveryMode: 'capture',
  announcementApiUrl: 'https://qvkucvcjmojjbphlzlks.supabase.co',
  dispatchSecret: 'd'.repeat(64),
  apiUrl: 'https://qvkucvcjmojjbphlzlks.supabase.co',
  topic: job.topic,
  environments: ['sandbox'],
  privateKey: '',
  keyId: '',
  teamId: '',
};
const runtime = {
  environment: 'cloud-test',
  appUrl: 'https://barber-test.alabdullah-cs.workers.dev',
  publicUrl: config.apiUrl,
};
Deno.test('announcement payload contains bilingual fallback and opaque binding, no account, contact, token or booking capability', () => {
  const p = announcementPayload(job);
  assert(
    p.aps.alert.title === 'Hello' && p.type === 'announcement' &&
      p.recipientBinding === job.recipientBinding,
  );
  assert(
    ![
      'bookingId',
      'deviceId',
      'accountId',
      'email',
      'token',
      'lease',
      'sessionId',
    ].some((k) => k in p),
  );
  assert(
    announcementPayload({ ...job, titleAr: 'مرحبا', bodyAr: 'احجز الآن' }).aps
      .alert.title === 'مرحبا',
  );
});
Deno.test('APNs sends exact topic, fixed destinations and expiration; transport uncertainty is not treated as rejection', async () => {
  let calls = 0;
  const send: typeof fetch = async (url, init) => {
    calls++;
    assert(
      String(url).startsWith('https://api.sandbox.push.apple.com/3/device/'),
    );
    const h = new Headers(init?.headers);
    assert(
      h.get('apns-topic') === job.topic && h.get('apns-id') === job.id &&
        h.get('apns-expiration') === '2000000000',
    );
    return new Response(null, { status: 200 });
  };
  assert(
    (await sendAnnouncement(job, 'jwt', {
      topic: job.topic,
      environments: ['sandbox'],
    }, send)).status === 200,
  );
  for (
    const change of [
      { topic: 'other' },
      { environment: 'production' },
      { recipientBinding: '' },
      { destination: 'https://bad.example' },
      { bodyEn: '🙂'.repeat(2000) },
    ]
  ) {
    assert(
      (await sendAnnouncement({ ...job, ...change }, 'jwt', {
        topic: job.topic,
        environments: ['sandbox'],
      }, send)).status !== 200,
    );
  }
  assert(calls === 1);
  assert(
    (await sendAnnouncement(job, 'jwt', {
      topic: job.topic,
      environments: ['sandbox'],
    }, () => Promise.reject(Error('timeout')))).status === 0,
  );
});
Deno.test('capture dispatch never calls APNs or mints provider credentials, and revalidates eligibility before capturing', async () => {
  const finished: number[] = [];
  const handle = createAnnouncementDispatcher({
    ...runtime,
    configuration: async () => config,
    claim: async () => [job, { ...job, recipientBinding: '' }],
    validate: async () => true,
    finish: async (_, r) => {
      finished.push(r.status);
    },
    providerToken: () => {
      throw Error('No APNs in capture');
    },
    send: () => {
      throw Error('No APNs in capture');
    },
  });
  const req = () =>
    new Request(runtime.appUrl, {
      method: 'POST',
      headers: { 'x-push-secret': config.dispatchSecret },
    });
  const r = await handle(req());
  const body = await r.json();
  assert(
    r.status === 200 && body.captured === 1 && body.accepted === 0 &&
      finished.includes(409),
  );
  assert(
    (await handle(new Request(runtime.appUrl, { method: 'POST' }))).status ===
      403,
  );
  const prod = createAnnouncementDispatcher({
    ...runtime,
    environment: 'production',
    configuration: async () => config,
    claim: async () => {
      throw Error('must not claim');
    },
    validate: async () => true,
    finish: async () => {},
    providerToken: async () => '',
    send: async () => ({ status: 200, reason: '', providerId: '' }),
  });
  assert((await prod(req())).status === 503);
});
