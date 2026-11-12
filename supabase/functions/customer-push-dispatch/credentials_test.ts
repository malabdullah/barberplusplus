import { type APNsCredential } from '../_shared/apns-credentials.ts';
import { createBookingPushDispatcher } from './handler.ts';
import { type PushJob, sendAPNs } from './apns.ts';
import { createAnnouncementDispatcher } from '../admin-push-dispatch/handler.ts';
import { type AnnouncementJob, sendAnnouncement } from '../admin-push-dispatch/delivery.ts';
const assert = (v: unknown) => { if (!v) throw Error('Assertion failed'); };
const pem = '-----BEGIN PRIVATE KEY-----\nQUFBQQ==\n-----END PRIVATE KEY-----';
const runtime = { environment: 'production', appUrl: 'https://www.barberplusplus.com', publicUrl: 'https://srv1073968.hstgr.cloud' };
const config = { enabled: true, announcementEnabled: true, deliveryMode: 'apns', announcementApiUrl: runtime.publicUrl,
  apiUrl: runtime.publicUrl, topic: 'com.barberplusplus.customer', environments: ['sandbox', 'production'],
  dispatchSecret: 'd'.repeat(64), privateKey: pem, keyId: 'SANDBOX001', teamId: 'TESTTEAM01',
  credentials: { production: { privateKey: pem, keyId: 'PRODKEY001', teamId: 'TESTTEAM01',
    environment: 'production', topic: 'com.barberplusplus.customer', apiUrl: runtime.publicUrl } } };
type Job = PushJob & AnnouncementJob;
const job: Job = { id: 'job', lease: 'lease', eventId: 'event', bookingId: 'booking', kind: 'confirmed', actor: 'shop',
  token: 'a'.repeat(64), environment: 'sandbox', topic: config.topic, language: 'en', date: '2026-11-13', time: '14:30',
  shop: 'QA Shop', barber: 'QA Barber', expiresAt: 2000000000, campaignId: 'campaign', recipientBinding: 'b'.repeat(64),
  deliveryMode: 'apns', titleEn: 'QA', bodyEn: 'No real message', titleAr: '', bodyAr: '', destination: 'book' };
const request = () => new Request(runtime.appUrl, { method: 'POST', headers: { 'x-push-secret': config.dispatchSecret } });
for (const kind of ['booking', 'announcement']) {
  const harness = (value = config, options: { mintFailure?: boolean; revoked?: boolean; testRuntime?: boolean } = {}) => {
    const sent: string[] = [], minted: string[] = [], results: { status: number; reason: string }[] = [];
    let claims = 0, continued = 0;
    const deps = {
      ...(options.testRuntime ? { environment: 'cloud-test', appUrl: 'https://barber-test.alabdullah-cs.workers.dev', publicUrl: 'https://qvkucvcjmojjbphlzlks.supabase.co' } : runtime),
      configuration: async () => value,
      claim: async () => { claims++; return [job, { ...job, environment: 'production' }, { ...job, id: 'second' }]; },
      validate: async (j: PushJob | AnnouncementJob) => !(options.revoked && j.environment === 'production'),
      continueWork: async () => { continued++; },
      finish: async (_: PushJob | AnnouncementJob, r: { status: number; reason: string }) => { results.push(r); },
      providerToken: async (key: APNsCredential) => {
        minted.push(key.keyId);
        if (options.mintFailure && key.environment === 'production') throw Error('Invalid key');
        return 'jwt:' + key.keyId;
      },
      send: async (j: PushJob | AnnouncementJob, jwt: string) => {
        const fakeFetch: typeof fetch = async (url, init) => {
          const env = j.environment;
          assert(new URL(String(url)).hostname === (env === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'));
          assert(new Headers(init?.headers).get('authorization') === 'bearer jwt:' + (env === 'sandbox' ? 'SANDBOX001' : 'PRODKEY001'));
          assert(new Headers(init?.headers).get('apns-topic') === config.topic);
          sent.push(env);
          return new Response(null, { status: 200 });
        };
        const r = kind === 'booking' ? await sendAPNs(j as PushJob, jwt, fakeFetch, value)
          : await sendAnnouncement(j as AnnouncementJob, jwt, value, fakeFetch);
        return { ...r, apnsId: '', providerId: '' };
      },
    };
    return { handle: kind === 'booking' ? createBookingPushDispatcher(deps) : createAnnouncementDispatcher(deps),
      sent, minted, results, claims: () => claims, continued: () => continued };
  };
  Deno.test(kind + ': mixed batch uses the matching provider key and APNs endpoint per job', async () => {
    const h = harness();
    assert((await h.handle(request())).status === 200);
    assert(h.sent.filter(x => x === 'sandbox').length === 2 && h.sent.includes('production'));
    assert(h.minted.length === 2 && h.results.every(r => r.status === 200));
    if (kind === 'announcement') assert(h.continued() === 1);
  });
  Deno.test(kind + ': missing production key never falls back or invalidates a device; sandbox continues', async () => {
    const h = harness({ ...config, credentials: {} } as typeof config);
    assert((await h.handle(request())).status === 200);
    assert(h.sent.join() === 'sandbox,sandbox' && h.minted.join() === 'SANDBOX001');
    assert(h.results.some(r => r.status === 503 && r.reason === 'CredentialUnavailable'));
    assert(!h.results.some(r => ['BadDeviceToken', 'TopicDisallowed', 'DeviceTokenNotForTopic'].includes(r.reason)));
  });
  Deno.test(kind + ': malformed production PEM or crypto failure cannot use the sandbox key', async () => {
    for (const malformed of [true, false]) {
      const value = malformed ? { ...config, credentials: { production: { ...config.credentials.production, privateKey: 'bad' } } } : config;
      const h = harness(value, { mintFailure: !malformed });
      assert((await h.handle(request())).status === 200);
      assert(h.sent.join() === 'sandbox,sandbox');
      assert(h.results.filter(r => r.status === 503 && r.reason === 'CredentialUnavailable').length === 1);
    }
  });
  Deno.test(kind + ': revoked eligibility prevents provider mint and send', async () => {
    const h = harness(config, { revoked: true });
    assert((await h.handle(request())).status === 200);
    assert(h.sent.join() === 'sandbox,sandbox' && h.minted.join() === 'SANDBOX001');
    assert(h.results.some(r => r.status === 409));
  });
  Deno.test(kind + ': Test runtime rejects production topic/config and cannot claim live jobs', async () => {
    const h = harness(config, { testRuntime: true });
    assert((await h.handle(request())).status === 503);
    assert(h.claims() === 0 && !h.sent.length && !h.minted.length);
  });
  Deno.test(kind + ': disabled delivery or invalid authentication never claims jobs', async () => {
    const h = harness({ ...config, enabled: false, announcementEnabled: false });
    assert((await h.handle(request())).status === 503 && h.claims() === 0);
    const enabled = harness();
    assert((await enabled.handle(new Request(runtime.appUrl, { method: 'POST', headers: { 'x-push-secret': 'e'.repeat(64) } }))).status === 403);
    assert(enabled.claims() === 0);
  });
}
