import { customerRuntime } from './customer-runtime.ts';
const assert = (value: unknown) => { if (!value) throw Error('Customer runtime boundary failed'); };
const production = { environment: 'production', productionEnabled: true, appUrl: 'https://shop.example.test', publicUrl: 'https://auth.example.test', secret: 'production-fixture-secret-at-least-thirty-two-characters' };

Deno.test('production customer access requires explicit activation and HTTPS configuration', () => {
  for (const config of [{ productionEnabled: false }, { appUrl: 'http://shop.example.test' }, { publicUrl: 'http://auth.example.test' }, { appUrl: 'https://localhost' }, { publicUrl: 'https://127.0.0.1' }, { appUrl: 'https://shop.example.test/customer' }, { secret: '' }, { environment: 'staging' }]) assert(!customerRuntime({ ...production, ...config }).enabled);
  const runtime = customerRuntime(production);
  assert(runtime.enabled && !runtime.localTest);
  assert(runtime.allowsOrigin('https://shop.example.test'));
  assert(runtime.allowsOrigin(null));
  for (const origin of ['http://shop.example.test', 'https://other.example.test', 'https://shop.example.test:444', 'https://shop.example.test/forged-path', 'http://localhost:5173', 'null']) assert(!runtime.allowsOrigin(origin));
});
Deno.test('local customer access keeps the loopback-only backend and matching frontend port', () => {
  const config = { ...production, environment: 'test', appUrl: 'http://localhost:5173', publicUrl: 'http://127.0.0.1:55321' };
  const runtime = customerRuntime(config);
  assert(runtime.enabled && runtime.localTest && runtime.allowsOrigin('http://127.0.0.1:5173'));
  assert(!runtime.allowsOrigin('http://localhost:4173'));
  assert(!customerRuntime({ ...config, publicUrl: production.publicUrl }).enabled);
});
Deno.test('hosted customer Test still requires its project-bound private gateway', async () => {
  const runtime = customerRuntime({ ...production, environment: 'cloud-test', appUrl: 'https://barber-test.example.test', publicUrl: 'https://abcdefghijklmnopqrst.supabase.co', cloudTestProjectRef: 'abcdefghijklmnopqrst', cloudAccessKey: 'a-private-test-gateway-secret-of-at-least-thirty-two-characters' });
  assert(runtime.enabled && !runtime.localTest);
  assert(!await runtime.allows(new Request('https://abcdefghijklmnopqrst.supabase.co/functions/v1/customer-auth')));
  assert(await runtime.allows(new Request('https://abcdefghijklmnopqrst.supabase.co/functions/v1/customer-auth', { headers: { Origin: 'https://barber-test.example.test', 'x-cloud-test-key': 'a-private-test-gateway-secret-of-at-least-thirty-two-characters' } })));
  assert(!runtime.allowsOrigin('https://barber-test.example.test'));
});
