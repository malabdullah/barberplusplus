import { afterEach, expect, it, vi } from 'vitest';
const createClient = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('./runtimeConfig', () => ({ isTest: true, customerFeaturesEnabled: true, appConfig: { supabaseUrl: 'http://127.0.0.1:55321', supabasePublishableKey: 'public-test-key' } }));
afterEach(() => { window.history.replaceState({}, '', '/'); createClient.mockClear(); vi.resetModules(); });
it('shares one PKCE client without automatically processing the customer callback', async () => {
  window.history.replaceState({}, '', '/customer/auth-callback?error_description=cancelled');
  const { supabase } = await import('./supabase');
  const { customerSupabase } = await import('./customerSupabase');
  expect(customerSupabase).toBe(supabase);
  expect(createClient).toHaveBeenCalledTimes(1);
  expect(createClient.mock.calls[0][2].auth).toMatchObject({ detectSessionInUrl: false, flowType: 'pkce' });
});
it('keeps normal staff password-reset URL handling enabled', async () => {
  window.history.replaceState({}, '', '/reset-password');
  await import('./supabase'); expect(createClient.mock.calls[0][2].auth.detectSessionInUrl).toBe(true);
});
