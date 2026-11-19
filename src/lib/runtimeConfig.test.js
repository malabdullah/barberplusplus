import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  delete window.__BARBER_CONFIG__;
  vi.resetModules();
});

it('enables subscription pages in production without enabling Test previews', async () => {
  window.__BARBER_CONFIG__ = {
    environment: 'production',
    appUrl: 'https://www.barberplusplus.com',
    supabaseUrl: 'https://backend.example.com',
    supabasePublishableKey: 'sb_publishable_example',
  };
  const runtime = await import('./runtimeConfig');
  expect(runtime.subscriptionFeaturesEnabled).toBe(true);
  expect(runtime.isTest).toBe(false);
});

it('keeps subscriptions available on the separately configured hosted Test', async () => {
  window.__BARBER_CONFIG__ = {
    environment: 'cloud-test',
    appUrl: 'https://barber-test.alabdullah-cs.workers.dev',
    supabaseUrl: 'https://qvkucvcjmojjbphlzlks.supabase.co',
    cloudTestProjectRef: 'qvkucvcjmojjbphlzlks',
    supabasePublishableKey: 'sb_publishable_example',
  };
  const runtime = await import('./runtimeConfig');
  expect(runtime.subscriptionFeaturesEnabled).toBe(true);
  expect(runtime.isTest).toBe(true);
});
