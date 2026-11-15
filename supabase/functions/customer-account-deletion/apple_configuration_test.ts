import { appleConfiguration } from './apple.ts';
import { deletionConfiguration, TEST_APP, TEST_API, PRODUCTION_APP, PRODUCTION_API, type DeletionConfiguration } from './configuration.ts';
const now = 1800000000000;
const key = 'a'.repeat(64);
const equal = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error('Assertion failed'); };
const encoded = (v: unknown) => btoa(JSON.stringify(v)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const test = deletionConfiguration({ environment: 'cloud-test', appUrl: TEST_APP, publicUrl: TEST_API, backendUrl: TEST_API });
const liveInput = { environment: 'production', appUrl: PRODUCTION_APP, publicUrl: PRODUCTION_API, backendUrl: 'http://api-gw:8000', productionBackendUrl: 'http://api-gw:8000', productionEnabled: 'true', productionCleanupEnabled: 'true', resendKey: 'synthetic-resend-key' };
const live = deletionConfiguration(liveInput);
const ids = { test: { ios: 'com.barberplusplus.customer.test', web: 'com.barberplusplus.authentication.test.web' }, production: { ios: 'com.barberplusplus.customer', web: 'com.barberplusplus.authentication.prod.web' } };
function client(clientId: string, changes: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  return { clientId, clientSecret: encoded({ alg: 'ES256', kid: 'SYNTHKEY01', ...header }) + '.' + encoded({ sub: clientId, iss: 'D49RFZQ6BT', aud: 'https://appleid.apple.com', iat: now / 1000, exp: now / 1000 + 86400, ...changes }) + '.synthetic' };
}
function bundle(environment: keyof typeof ids, changes: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  return { ios: client(ids[environment].ios, changes, header), web: client(ids[environment].web, changes, header) };
}
const configuration = (deployment: DeletionConfiguration, clients: unknown, enabled: string | undefined = 'true', encryption: string | undefined = key) => appleConfiguration(deployment, enabled, JSON.stringify(clients), encryption, () => now);
Deno.test('Apple configuration requires the exact environment and complete production native/web credentials', () => {
  equal(configuration(test, bundle('test')).enabled, true);
  equal(configuration(live, bundle('production')).enabled, true);
  equal(configuration(live, bundle('test')).enabled, false);
  equal(configuration(test, bundle('production')).enabled, false);
  equal(configuration(live, { ios: bundle('production').ios }).enabled, false);
  equal(configuration(live, { web: bundle('production').web }).enabled, false);
  equal(configuration(test, { ios: bundle('test').ios }).enabled, true);
  equal(configuration(live, { ...bundle('production'), unknown: {} }).enabled, false);
  equal(configuration(live, {}).enabled, false);
});
Deno.test('production Apple cannot bypass wrong backend binding, origin, public API or disabled cleanup', () => {
  for (const change of [{ environment: 'cloud-test' }, { appUrl: TEST_APP }, { publicUrl: TEST_API }, { backendUrl: TEST_API }, { productionBackendUrl: undefined }, { productionBackendUrl: 'http://kong:8000' }, { backendUrl: 'http://unapproved:8000', productionBackendUrl: 'http://unapproved:8000' }, { productionCleanupEnabled: 'false' }]) {
    equal(configuration(deletionConfiguration({ ...liveInput, ...change }), bundle('production')).enabled, false);
  }
  for (const change of [{ mode: 'disabled' as const }, { appUrl: TEST_APP }, { publicUrl: TEST_API }, { functionUrl: TEST_API + '/functions/v1/customer-account-deletion' }, { cleanupEnabled: false }, { enabled: false }]) equal(configuration({ ...live, ...change }, bundle('production')).enabled, false);
  equal(configuration(deletionConfiguration({ ...liveInput, backendUrl: PRODUCTION_API, productionBackendUrl: PRODUCTION_API }), bundle('production')).enabled, true);
});
Deno.test('Apple activation defaults closed while cleanup-only mode retains accepted-job capability', () => {
  equal(appleConfiguration(live, undefined, JSON.stringify(bundle('production')), key, () => now).enabled, false);
  equal(configuration(live, bundle('production'), 'false').enabled, false);
  equal(configuration(live, bundle('production'), 'TRUE').enabled, false);
  for (const value of ['', 'x'.repeat(64), 'a'.repeat(63), undefined]) equal(appleConfiguration(live, 'true', JSON.stringify(bundle('production')), value, () => now).enabled, false);
  const cleanupOnly = deletionConfiguration({ ...liveInput, productionEnabled: 'false', resendKey: '' });
  equal(cleanupOnly.newRequestsEnabled, false);
  equal(configuration(cleanupOnly, bundle('production')).enabled, true);
});
Deno.test('Apple credential metadata rejects wrong team/audience/subject, expiry, unsafe lifetime and header', () => {
  for (const change of [{ iss: 'OTHERTEAM1' }, { sub: ids.test.ios }, { aud: TEST_API }, { iat: now / 1000 + 31 }, { iat: 0 }, { iat: 'future' }, { exp: now / 1000 + 60 }, { exp: now / 1000 + 181 * 86400 }, { exp: 'future' }]) equal(configuration(live, bundle('production', change)).enabled, false);
  for (const header of [{ alg: 'none' }, { alg: 'HS256' }, { kid: '' }, { kid: 'unapproved-length' }]) equal(configuration(live, bundle('production', {}, header)).enabled, false);
  const mixed = bundle('production'); mixed.web = bundle('test').web;
  equal(configuration(live, mixed).enabled, false);
  equal(configuration(live, { ...bundle('production'), ios: { ...bundle('production').ios, redirectUri: 'https://elsewhere.invalid' } }).enabled, false);
});
