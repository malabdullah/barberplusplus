import { deletionConfiguration, deletionRuntimeMatches, withDeletionActivation, PRODUCTION_API, PRODUCTION_APP, TEST_API, TEST_APP } from './configuration.ts';
import { createDeletionHandler } from './handler.ts';
const assert = (v: unknown) => { if (!v) throw Error('Assertion failed'); };
const equal = (a: unknown, b: unknown) => assert(JSON.stringify(a) === JSON.stringify(b));
const production = { environment: 'production', appUrl: PRODUCTION_APP, publicUrl: PRODUCTION_API, backendUrl: 'http://kong:8000', productionBackendUrl: 'http://kong:8000', resendKey: 're_mock' };
Deno.test('production defaults off and requires literal, independent new-request/cleanup flags and a mail key', () => {
  equal(deletionConfiguration(production).enabled, false);
  for (const flag of [undefined, '', 'TRUE', '1', 'false']) equal(deletionConfiguration({ ...production, productionEnabled: flag }).newRequestsEnabled, false);
  equal(deletionConfiguration({ ...production, productionEnabled: 'true' }).newRequestsEnabled, false);
  const cleanup = deletionConfiguration({ ...production, productionCleanupEnabled: 'true' }); assert(cleanup.enabled); assert(!cleanup.newRequestsEnabled);
  assert(deletionConfiguration({ ...production, productionCleanupEnabled: 'true', productionEnabled: 'true' }).newRequestsEnabled);
  assert(!deletionConfiguration({ ...production, productionCleanupEnabled: 'true', productionEnabled: 'true', resendKey: '' }).newRequestsEnabled);
});
Deno.test('mismatched environment, website, public API or internal backend cannot activate Live', () => {
  for (const patch of [{ environment: 'cloud-test' }, { environment: 'development' }, { appUrl: TEST_APP }, { appUrl: PRODUCTION_APP + '/' }, { publicUrl: TEST_API }, { publicUrl: 'https://evil.test' }, { backendUrl: TEST_API, productionBackendUrl: TEST_API }, { productionBackendUrl: undefined }, { backendUrl: 'http://evil.test', productionBackendUrl: 'http://evil.test' }]) {
    assert(!deletionConfiguration({ ...production, productionCleanupEnabled: 'true', productionEnabled: 'true', ...patch }).enabled);
  }
});
Deno.test('the observed production gateway still requires an explicit matching binding and both flags', () => {
  const observed = { ...production, backendUrl: 'http://api-gw:8000', productionBackendUrl: 'http://api-gw:8000' };
  assert(!deletionConfiguration(observed).enabled);
  assert(deletionConfiguration({ ...observed, productionCleanupEnabled: 'true', productionEnabled: 'true' }).newRequestsEnabled);
  assert(!deletionConfiguration({ ...observed, productionBackendUrl: undefined, productionCleanupEnabled: 'true', productionEnabled: 'true' }).enabled);
  assert(!deletionConfiguration({ ...observed, backendUrl: 'http://api-gw:8001', productionCleanupEnabled: 'true', productionEnabled: 'true' }).enabled);
  assert(!deletionConfiguration({ ...observed, backendUrl: 'http://api-gw:8000.evil.test', productionBackendUrl: 'http://api-gw:8000.evil.test', productionCleanupEnabled: 'true', productionEnabled: 'true' }).enabled);
});
Deno.test('hosted Test is always pinned and retains its existing pilot behavior independently of production flags', () => {
  const input = { environment: 'cloud-test', appUrl: TEST_APP, publicUrl: TEST_API, backendUrl: TEST_API };
  const config = deletionConfiguration(input); assert(config.enabled); assert(config.newRequestsEnabled); equal(config.mode, 'test');
  for (const patch of [{ appUrl: PRODUCTION_APP }, { backendUrl: PRODUCTION_API }, { publicUrl: PRODUCTION_API }]) assert(!deletionConfiguration({ ...input, ...patch }).enabled);
});
Deno.test('both application config and immutable database environment must agree, not just the URL', async () => {
  const config = deletionConfiguration({ ...production, productionCleanupEnabled: 'true', productionEnabled: 'true' });
  assert(!deletionRuntimeMatches(config, { deploymentEnvironment: 'cloud-test', testMode: false, functionUrl: config.functionUrl }));
  assert(!deletionRuntimeMatches(config, { deploymentEnvironment: 'production', testMode: true, functionUrl: config.functionUrl }));
  assert(!deletionRuntimeMatches(config, { deploymentEnvironment: 'production', testMode: false, functionUrl: null }));
  assert(deletionRuntimeMatches(config, { deploymentEnvironment: 'production', testMode: false, functionUrl: config.functionUrl }));
  let calls = 0; const blocked = withDeletionActivation(config, async () => ({ deploymentEnvironment: 'cloud-test', testMode: true, functionUrl: TEST_API + '/functions/v1/customer-account-deletion' }), async () => { calls++; return new Response(); });
  equal((await blocked(new Request(PRODUCTION_APP))).status, 503); equal(calls, 0);
});
Deno.test('runtime failures fail closed, and a disabled environment never even reads database configuration', async () => {
  let reads = 0; const disabled = deletionConfiguration(production);
  const handler = withDeletionActivation(disabled, async () => { reads++; throw Error('DB secret'); }, async () => new Response());
  equal((await handler(new Request(PRODUCTION_APP))).status, 503); equal(reads, 0);
  const active = deletionConfiguration({ ...production, productionCleanupEnabled: 'true' });
  const unavailable = withDeletionActivation(active, async () => { throw Error('DB diagnostics'); }, async () => new Response());
  equal(await (await unavailable(new Request(PRODUCTION_APP))).json(), { error: 'NOT_ENABLED' });
});
Deno.test('cleanup-only mode retains receipt status/retry while refusing every new proof/deletion action', async () => {
  let identities = 0; let work = 0;
  const handler = createDeletionHandler({ enabled: true, newRequestsEnabled: false, appUrl: PRODUCTION_APP, pepper: 'key', identity: async () => { identities++; return null; }, rpc: async () => ({ state: 'cleanup_pending' }), mail: async () => {}, password: async () => false, process: async () => { work++; }, retain: async task => { await task; } });
  const request = (action: string) => handler(new Request(PRODUCTION_APP, { method: 'POST', body: JSON.stringify({ action, ...(['status','retry'].includes(action) ? { id: '8c43610f-3c44-4c96-bb21-99572d110f1f', receipt: 'a'.repeat(43) } : {}) }) }));
  for (const action of ['preview','start','resend','verify','password','confirm']) equal((await request(action)).status, 503);
  equal(identities, 0); equal((await request('status')).status, 202); equal((await request('retry')).status, 202); equal(work, 1);
});
