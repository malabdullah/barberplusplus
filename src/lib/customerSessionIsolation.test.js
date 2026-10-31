import { afterEach, expect, it, vi } from 'vitest';
const createClient = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('./runtimeConfig', () => ({ isTest: true, appConfig: { supabaseUrl: 'http://127.0.0.1:55321', supabasePublishableKey: 'public-test-key' } }));
afterEach(() => { window.history.replaceState({}, '', '/'); createClient.mockClear(); vi.resetModules(); });
it('isolates customer PKCE and prevents the staff client handling customer OAuth URL errors', async () => {
  window.history.replaceState({}, '', '/customer/auth-callback?error_description=cancelled');
  await import('./supabase'); await import('./customerSupabase');
  const staff = createClient.mock.calls[0][2].auth;
  const customer = createClient.mock.calls[1][2].auth;
  expect(staff.detectSessionInUrl).toBe(false);
  expect(customer).toMatchObject({ storageKey: 'barber-customer-auth', flowType: 'pkce', detectSessionInUrl: false });
});
it('keeps normal staff password-reset URL handling enabled', async () => {
  window.history.replaceState({}, '', '/reset-password');
  await import('./supabase'); expect(createClient.mock.calls[0][2].auth.detectSessionInUrl).toBe(true);
});
