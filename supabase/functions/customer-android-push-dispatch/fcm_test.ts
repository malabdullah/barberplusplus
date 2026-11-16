import { androidContent, createFCMToken, FCM_EMAIL, FCM_PACKAGE, FCM_PROJECT, sendFCM, type AndroidJob, type Credential } from './fcm.ts';
const assert = (value: unknown) => { if (!value) throw Error('Assertion failed'); };
const job: AndroidJob = { id: 'ad650000-0000-4000-8000-000000000001', lease: 'ad650000-0000-4000-8000-000000000002',
  token: 'synthetic-fcm-token:'.repeat(10), mode: 'send', projectId: FCM_PROJECT, packageName: FCM_PACKAGE, language: 'en', kind: 'test', expiresAt: Math.floor(Date.now() / 1000) + 3600 };
Deno.test('FCM payload uses exact Android Test package and fixed native tap routing, without customer contact', () => {
  const p = androidContent(job); assert(p.message.android.restricted_package_name === FCM_PACKAGE);
  assert(p.message.data.destination === 'book' && p.message.data.version === '1' && !JSON.stringify(p).includes('email'));
});
Deno.test('FCM rejects wrong app/project and expired jobs before network', async () => {
  let calls = 0; const send = (() => { calls++; return Promise.resolve(Response.json({})); }) as typeof fetch;
  for (const change of [{ projectId: 'live' }, { packageName: 'live.app' }, { expiresAt: 0 }]) {
    let denied = false; try { await sendFCM({ ...job, ...change }, 'test', send); } catch { denied = true; } assert(denied);
  } assert(calls === 0);
});
Deno.test('FCM reuses existing localized booking content and includes only booking route identifiers', () => {
  const p = androidContent({ ...job, kind: 'confirmed', bookingId: job.id, date: '2026-11-20', time: '09:00', shop: 'Synthetic shop', language: 'ar' });
  assert(p.message.notification.title === 'تم تأكيد الحجز' && p.message.data.destination === 'booking' && p.message.data.bookingId === job.id);
});
Deno.test('only explicit FCM UNREGISTERED invalidates a token; payload/auth errors do not', async () => {
  const unregistered = await sendFCM(job, 'test', (() => Promise.resolve(Response.json({ error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } }, { status: 404 }))) as typeof fetch);
  const invalidPayload = await sendFCM(job, 'test', (() => Promise.resolve(Response.json({ error: { status: 'INVALID_ARGUMENT' } }, { status: 400 }))) as typeof fetch);
  assert(unregistered.outcome === 'invalid-token' && invalidPayload.outcome === 'failed');
});
Deno.test('FCM timeout is uncertain and never automatically retried', async () => {
  let calls = 0; const result = await sendFCM(job, 'test', (() => { calls++; throw Error('synthetic transport loss'); }) as typeof fetch);
  assert(result.outcome === 'uncertain' && calls === 1);
});
Deno.test('FCM OAuth signs exact send-only audience/scope and caches a bounded access token', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const bytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const credential: Credential = { type: 'service_account', project_id: FCM_PROJECT, client_email: FCM_EMAIL, private_key_id: 'a'.repeat(40),
    private_key: '-----BEGIN PRIVATE KEY-----\n' + btoa(String.fromCharCode(...bytes)) + '\n-----END PRIVATE KEY-----', token_uri: 'https://oauth2.googleapis.com/token' };
  let calls = 0;
  const token = createFCMToken((async (url, init) => {
    calls++; assert(String(url) === 'https://oauth2.googleapis.com/token');
    const assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
    const [header, payload, signature] = assertion.split('.');
    const decode = (v: string) => Uint8Array.from(atob(v.replaceAll('-', '+').replaceAll('_', '/')), x => x.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(decode(payload)));
    assert(claims.iss === FCM_EMAIL && claims.aud === 'https://oauth2.googleapis.com/token' && claims.scope === 'https://www.googleapis.com/auth/firebase.messaging');
    assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, decode(signature), new TextEncoder().encode(header + '.' + payload)));
    return Response.json({ access_token: 'synthetic-access-token', expires_in: 3600 });
  }) as typeof fetch);
  assert(await token(credential) === 'synthetic-access-token' && await token(credential) === 'synthetic-access-token' && calls === 1);
  let denied = false; try { await token({ ...credential, token_uri: 'https://other.invalid' }); } catch { denied = true; } assert(denied && calls === 1);
});
