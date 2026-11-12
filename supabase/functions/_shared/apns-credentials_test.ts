import { apnsCredential, apnsTokenSelector } from './apns-credentials.ts';
import { apnsToken } from '../customer-push-dispatch/apns.ts';
const assert = (v: unknown) => { if (!v) throw Error('Assertion failed'); };
const pemMarker = (kind: string) => ['-----', kind, ' PRIVATE KEY', '-----'].join('');
export const fakePem = [pemMarker('BEGIN'), btoa('fake'), pemMarker('END')].join('\n');
export const liveConfig = {
  apiUrl: 'https://srv1073968.hstgr.cloud', topic: 'com.barberplusplus.customer',
  environments: ['sandbox', 'production'], privateKey: fakePem, keyId: 'SANDBOX001', teamId: 'TESTTEAM01',
  enabled: true, dispatchSecret: 'd'.repeat(64),
  credentials: { production: { privateKey: fakePem, keyId: 'PRODKEY001', teamId: 'TESTTEAM01',
    environment: 'production', topic: 'com.barberplusplus.customer', apiUrl: 'https://srv1073968.hstgr.cloud' } },
};
Deno.test('legacy credentials remain sandbox-only, even after runtime permits production', () => {
  const old = { ...liveConfig, credentials: undefined };
  assert(apnsCredential(old, 'sandbox')?.keyId === 'SANDBOX001');
  assert(apnsCredential(old, 'production') === null);
});
Deno.test('explicit credentials must match environment, topic, API and team; production never falls back', () => {
  assert(apnsCredential(liveConfig, 'production')?.keyId === 'PRODKEY001');
  for (const patch of [{ privateKey: 'invalid' }, { keyId: 'SANDBOX001' }, { keyId: 'invalid' },
    { teamId: 'OTHERTEAM1' }, { environment: 'sandbox' }, { topic: 'other' }, { apiUrl: 'other' }]) {
    assert(apnsCredential({ ...liveConfig, credentials: { production: { ...liveConfig.credentials.production, ...patch } } }, 'production') === null);
  }
  assert(apnsCredential({ ...liveConfig, environments: ['sandbox'] }, 'production') === null);
  assert(apnsCredential({ ...liveConfig, credentials: { sandbox: null } }, 'sandbox') === null);
});
Deno.test('mixed batches mint once per environment; malformed crypto keys return no token without fallback', async () => {
  const seen: string[] = [];
  const token = apnsTokenSelector(liveConfig, async key => { seen.push(key.keyId); return key.keyId; });
  const values = await Promise.all(['sandbox', 'production', 'sandbox', 'production'].map(token));
  assert(values.join() === 'SANDBOX001,PRODKEY001,SANDBOX001,PRODKEY001');
  assert(seen.length === 2);
  const broken = apnsTokenSelector(liveConfig, key => apnsToken(key.privateKey, key.keyId, key.teamId));
  assert(await broken('production') === null && await broken('production') === null);
});
Deno.test('provider JWT cache preserves each signing key and does not reuse a changed private key', async () => {
  async function pair() {
    const p = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const bytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', p.privateKey));
    return { pem: [pemMarker('BEGIN'), btoa(String.fromCharCode(...bytes)), pemMarker('END')].join('\n'), publicKey: p.publicKey };
  }
  const a = await pair(), b = await pair();
  const sandbox = await apnsToken(a.pem, 'SANDBOX001', 'TESTTEAM01');
  const production = await apnsToken(b.pem, 'PRODKEY001', 'TESTTEAM01');
  assert(sandbox === await apnsToken(a.pem, 'SANDBOX001', 'TESTTEAM01'));
  assert(production === await apnsToken(b.pem, 'PRODKEY001', 'TESTTEAM01'));
  const replaced = await apnsToken(b.pem, 'SANDBOX001', 'TESTTEAM01');
  assert(replaced !== sandbox);
  const [head, payload, sig] = replaced.split('.');
  const signature = Uint8Array.from(atob(sig.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  assert(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, b.publicKey, signature, new TextEncoder().encode(head + '.' + payload)));
});
