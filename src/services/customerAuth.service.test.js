import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInWithOAuth: vi.fn(), exchangeCodeForSession: vi.fn(), refreshSession: vi.fn(), verifyOtp: vi.fn(), setSession: vi.fn(), signOut: vi.fn(), mfa: { getAuthenticatorAssuranceLevel: vi.fn() } }));
const isolated = vi.hoisted(() => ({ verifyOtp: vi.fn(), signOut: vi.fn(), stopAutoRefresh: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: isolated }) }));
const redirectStaffMfa = vi.hoisted(() => vi.fn());
vi.mock('../lib/staffMfaReturn', () => ({ redirectStaffMfa }));
vi.mock('../lib/runtimeConfig', () => ({ isTest: true, customerFeaturesEnabled: true, appConfig: { appUrl: window.location.origin, supabaseUrl: 'http://127.0.0.1:55321', supabasePublishableKey: 'test-public-key' } }));
vi.mock('../lib/customerSupabase', () => ({ customerSupabase: { auth }, CUSTOMER_AUTH_STORAGE_KEY: 'barber-customer-auth' }));
import { rememberPasswordProof } from '../lib/customerPasswordProof';
import { customerAuthService } from './customerAuth.service';
const request = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); localStorage.clear(); vi.stubGlobal('fetch', request);
  auth.getSession.mockResolvedValue({ data: { session: { access_token: 'customer-token' } } });
  isolated.signOut.mockResolvedValue({ error: null });
  auth.signInWithOAuth.mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  request.mockResolvedValue({ ok: true, json: async () => ({ external: { google: true, apple: false } }) });
});
afterEach(() => vi.unstubAllGlobals());
it('preserves the recovery proof while an enrolled staff session steps up', async () => {
  const proof = 'af220000-0000-4000-8000-000000000004';
  rememberPasswordProof({ proof, expiresIn: 300 });
  auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null });
  request.mockResolvedValue({ ok: false, json: async () => ({ error: 'AUTH_REQUIRED' }) });
  await expect(customerAuthService.resetPassword({ password: 'Changed12!', confirmPassword: 'Changed12!' })).rejects.toThrow('MFA_REQUIRED');
  expect(redirectStaffMfa).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem('barber-password-proof')).toContain(proof);
  expect(auth.signOut).not.toHaveBeenCalled();
});
it('rejects self-service email changes before sending an Auth update',async()=>{
  await expect(customerAuthService.changeEmail('new@example.test')).rejects.toThrow('EMAIL_ADMIN_ONLY');
  expect(auth.setSession).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
});
it('sends email signup through the customer gateway without a phone', async () => {
  await customerAuthService.requestSignup({ name: 'Customer', email: 'test@example.test', password: 'Short12!', returnTo: '/book' });
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ action: 'email-signup', name: 'Customer', email: 'test@example.test', returnTo: '/book' });
});
it('checks the configured provider and sends PKCE to the isolated customer callback', async () => {
  await customerAuthService.startSocial('google', 'https://untrusted.example');
  expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: `${window.location.origin}/customer/auth-callback` } });
  expect(localStorage.getItem('barber-customer-oauth-return')).toBe('/customer/account');
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
  expect(localStorage.getItem('barber-customer-oauth-return')).toBeNull();
});

it.each(['signup', 'magiclink', 'email_change'])('rejects the legacy %s session return without replacing the active session', async type => {
  window.history.replaceState({}, '', `/customer/email-callback?next=book#access_token=example&refresh_token=example&type=${type}`);
  await expect(customerAuthService.finishEmail(window.location.href)).rejects.toThrow('INVALID_CODE');
  expect(window.location.hash).toBe('');
  expect(auth.setSession).not.toHaveBeenCalled();
  expect(auth.signOut).not.toHaveBeenCalled();
});
it.each(['signup', 'magiclink'])('confirms a %s token separately and sends the customer to sign in', async type => {
  auth.getSession.mockResolvedValue({ data: { session: null } });
  isolated.verifyOtp.mockResolvedValue({ data: { session: {}, user: { id: 'customer', app_metadata: { role: 'customer' }, email_confirmed_at: 'confirmed' } } });
  window.history.replaceState({}, '', `/customer/email-callback?next=book&type=${type}&token_hash=test`);
  expect(await customerAuthService.finishEmail(window.location.href)).toMatchObject({ recovery: false, returnTo: '/book', signInRequired: true });
  expect(auth.setSession).not.toHaveBeenCalled();
  expect(isolated.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
it('rejects conflicting email callback types', async () => {
  await expect(customerAuthService.finishEmail(`${window.location.origin}/customer/email-callback?type=signup#access_token=token&refresh_token=refresh&type=recovery`)).rejects.toThrow('INVALID_CODE');
  expect(auth.setSession).not.toHaveBeenCalled();
});
it('rejects expired links and staff sessions', async () => {
  isolated.verifyOtp.mockResolvedValue({ error: new Error('expired'), data: {} });
  await expect(customerAuthService.finishEmail(`${window.location.origin}/customer/email-callback?type=signup&token_hash=expired`)).rejects.toThrow('INVALID_CODE');
  isolated.verifyOtp.mockResolvedValue({ data: { session: {}, user: { app_metadata: { role: 'admin' }, email_confirmed_at: 'confirmed' } } });
  await expect(customerAuthService.finishEmail(`${window.location.origin}/customer/email-callback?type=signup&token_hash=staff`)).rejects.toThrow('INVALID_CODE');
  expect(auth.signOut).not.toHaveBeenCalled();
  expect(isolated.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
it.each(['logout', 'resetPassword'])('clears only customer credentials after %s has revoked the Auth session', async action => {
  localStorage.setItem('barber-customer-auth', 'revoked-customer-session');
  localStorage.setItem('barber-customer-auth-code-verifier', 'customer-verifier');
  localStorage.setItem('staff-session', 'keep-staff-session');
  auth.signOut.mockResolvedValue({ error: { name: 'AuthSessionMissingError', status: 400 } });
  rememberPasswordProof({ proof: 'af220000-0000-4000-8000-000000000004', expiresIn: 300 });
  await customerAuthService[action]({ password: 'ResetPass1!', confirmPassword: 'ResetPass1!' });
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

it.each(['signup'])('verifies the emailed %s code using Supabase OTP', async purpose => {
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.setSession.mockResolvedValue({ error: null });
  isolated.verifyOtp.mockResolvedValue({ data: { session: { access_token: 'customer-token' }, user: { id: 'customer', app_metadata: { role: 'customer' }, email_confirmed_at: 'confirmed' } } });
  await customerAuthService.verifyEmailCode({ email: 'Customer@Example.test ', code: '123456', purpose });
  expect(isolated.verifyOtp).toHaveBeenCalledWith({ email: 'customer@example.test', token: '123456', type: purpose === 'recovery' ? 'recovery' : 'email' });
});
it('rejects incorrect codes and never accepts staff or unconfirmed sessions as customers', async () => {
  isolated.verifyOtp.mockResolvedValue({ data: {}, error: { status: 403 } });
  await expect(customerAuthService.verifyEmailCode({ email: 'a@example.test', code: '123456', purpose: 'signup' })).rejects.toThrow('INVALID_CODE');
  isolated.verifyOtp.mockResolvedValue({ data: { session: {}, user: { app_metadata: { role: 'admin' }, email_confirmed_at: 'confirmed' } } });
  await expect(customerAuthService.verifyEmailCode({ email: 'a@example.test', code: '123456', purpose: 'signup' })).rejects.toThrow('INVALID_CODE');
  expect(auth.signOut).not.toHaveBeenCalled();
  expect(isolated.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
it('removes callback credentials and handles Supabase expired-link errors', async () => {
  window.history.replaceState({}, '', '/customer/email-callback?token_hash=used&type=signup');
  isolated.verifyOtp.mockResolvedValue({ data: {}, error: { status: 403 } });
  await expect(customerAuthService.finishEmail(window.location.href)).rejects.toThrow('INVALID_CODE');
  expect(window.location.search).toBe('');
  await expect(customerAuthService.finishEmail(`${window.location.origin}/customer/email-callback#error=access_denied&error_code=otp_expired`)).rejects.toThrow('INVALID_CODE');
});

it('rejects a normal recovery session without a request-bound proof', async () => {
  await expect(customerAuthService.finishEmail(`${window.location.origin}/customer/email-callback#type=recovery`)).rejects.toThrow('PASSWORD_PROOF_REQUIRED');
  expect(auth.setSession).not.toHaveBeenCalled();
});
it('verifies recovery codes through the server with the issued request ID', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null } });
  const session = { access_token: 'recovery-token', refresh_token: 'recovery-refresh', user: { app_metadata: { role: 'customer' } } };
  request.mockResolvedValue({ ok: true, json: async () => ({ session, proof: 'af220000-0000-4000-8000-000000000004', expiresIn: 300 }) });
  auth.setSession.mockResolvedValue({ error: null });
  await customerAuthService.verifyEmailCode({ email: 'ignored@example.test', code: '123456', purpose: 'recovery', requestId: 'issued-request' });
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ action: 'password-recovery-verify', requestId: 'issued-request', code: '123456' });
  expect(auth.verifyOtp).not.toHaveBeenCalled();
  expect(auth.setSession).toHaveBeenCalledWith(session);
});

it('treats a lost credential-write response as uncertain and clears the local identity instead of retrying', async () => {
  request.mockRejectedValue(new TypeError('Network request failed'));
  auth.signOut.mockResolvedValue({ error: null });
  await expect(customerAuthService.changePassword({ currentPassword: 'Current12!', password: 'Changed12!', confirmPassword: 'Changed12!' })).rejects.toThrow('PASSWORD_UPDATE_UNCERTAIN');
  expect(request).toHaveBeenCalledTimes(1);
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
