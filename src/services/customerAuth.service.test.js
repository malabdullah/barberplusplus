import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInWithOAuth: vi.fn(), exchangeCodeForSession: vi.fn(), refreshSession: vi.fn(), verifyOtp: vi.fn(), setSession: vi.fn(), signOut: vi.fn() }));
vi.mock('../lib/runtimeConfig', () => ({ isTest: true, appConfig: { supabaseUrl: 'http://127.0.0.1:55321', supabasePublishableKey: 'test-public-key' } }));
vi.mock('../lib/customerSupabase', () => ({ customerSupabase: { auth }, CUSTOMER_AUTH_STORAGE_KEY: 'barber-customer-auth' }));
import { customerAuthService } from './customerAuth.service';
const request = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); localStorage.clear(); vi.stubGlobal('fetch', request);
  auth.getSession.mockResolvedValue({ data: { session: { access_token: 'customer-token' } } });
  auth.signInWithOAuth.mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  request.mockResolvedValue({ ok: true, json: async () => ({ external: { google: true, apple: false } }) });
});
afterEach(() => vi.unstubAllGlobals());
it('sends email signup through the customer gateway without a phone', async () => {
  await customerAuthService.requestSignup({ name: 'Customer', email: 'test@example.test', password: 'Short12!', returnTo: '/book' });
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ action: 'email-signup', name: 'Customer', email: 'test@example.test', password: 'Short12!', returnTo: '/book' });
});
it('checks the configured provider and sends PKCE to the isolated customer callback', async () => {
  await customerAuthService.startSocial('google', 'https://untrusted.example');
  expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: `${window.location.origin}/customer/auth-callback` } });
  expect(sessionStorage.getItem('barber-customer-oauth-return')).toBe('/customer/account');
  await expect(customerAuthService.startSocial('apple', '/book')).rejects.toThrow('PROVIDER_UNAVAILABLE');
  expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1);
});
it('exchanges only a started callback, handles cancellation, and clears its return marker', async () => {
  await expect(customerAuthService.finishSocial('http://localhost/customer/auth-callback?code=unsolicited')).rejects.toThrow('SOCIAL_SIGN_IN_FAILED');
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  await customerAuthService.startSocial('google', '/book');
  await expect(customerAuthService.finishSocial('http://localhost/customer/auth-callback?error=access_denied')).rejects.toThrow('SOCIAL_SIGN_IN_FAILED');
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(await customerAuthService.finishSocial('http://localhost/customer/auth-callback?code=provider-code')).toBe('/book');
  expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('provider-code');
  expect(sessionStorage.getItem('barber-customer-oauth-return')).toBeNull();
});

it('accepts an email change callback only after verifying the customer session', async () => {
  auth.setSession.mockResolvedValue({ data: { user: { app_metadata: { role: 'customer' }, email_confirmed_at: 'confirmed' } } });
  expect(await customerAuthService.finishEmail('http://localhost/customer/email-callback#access_token=customer-token&refresh_token=refresh-token&type=email_change')).toEqual({ recovery: false, returnTo: '/customer/account' });
  expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'customer-token', refresh_token: 'refresh-token' });
});
it('rejects expired links and staff sessions', async () => {
  auth.verifyOtp.mockResolvedValue({ error: new Error('expired'), data: {} });
  await expect(customerAuthService.finishEmail('http://localhost/customer/email-callback?type=signup&token_hash=expired')).rejects.toThrow('INVALID_CODE');
  auth.verifyOtp.mockResolvedValue({ data: { user: { app_metadata: { role: 'manager' }, email_confirmed_at: 'confirmed' } } });
  await expect(customerAuthService.finishEmail('http://localhost/customer/email-callback?type=signup&token_hash=staff')).rejects.toThrow('INVALID_CODE');
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
it.each(['logout', 'resetPassword'])('clears only customer credentials after %s has revoked the Auth session', async action => {
  localStorage.setItem('barber-customer-auth', 'revoked-customer-session');
  localStorage.setItem('barber-customer-auth-code-verifier', 'customer-verifier');
  localStorage.setItem('staff-session', 'keep-staff-session');
  auth.signOut.mockResolvedValue({ error: { name: 'AuthSessionMissingError', status: 400 } });
  await customerAuthService[action]({ password: 'ResetPass1!' });
  expect(localStorage.getItem('barber-customer-auth')).toBeNull();
  expect(localStorage.getItem('barber-customer-auth-code-verifier')).toBeNull();
  expect(localStorage.getItem('staff-session')).toBe('keep-staff-session');
});
it('does not hide unrelated Auth sign-out failures', async () => {
  localStorage.setItem('barber-customer-auth', 'customer-session');
  auth.signOut.mockResolvedValue({ error: { name: 'AuthRetryableFetchError', status: 500 } });
  await expect(customerAuthService.logout()).rejects.toThrow('UNAVAILABLE');
  expect(localStorage.getItem('barber-customer-auth')).toBe('customer-session');
});
