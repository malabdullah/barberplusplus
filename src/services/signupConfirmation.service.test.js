import { beforeEach, expect, it, vi } from 'vitest';
import { confirmSignup } from './signupConfirmation.service';
const mock = vi.hoisted(() => ({ verifyOtp: vi.fn(), signOut: vi.fn(), stopAutoRefresh: vi.fn(), getSession: vi.fn(), createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
vi.mock('../lib/runtimeConfig', () => ({ appConfig: { appUrl: 'https://app.example.test', supabaseUrl: 'https://backend.example.test', supabasePublishableKey: 'synthetic-public-key' } }));
vi.mock('../lib/functionFetch', () => ({ functionFetch: vi.fn() }));
vi.mock('../lib/customerSupabase', () => ({ customerSupabase: { auth: { getSession: mock.getSession } } }));
const input = `https://app.example.test/customer/email-callback?next=book#type=signup&token_hash=${'a'.repeat(56)}`;
function verified(role = 'customer') { return { data: { user: { id: 'verified-user', app_metadata: { role }, email_confirmed_at: 'confirmed' }, session: { access_token: 'synthetic-token' } }, error: null }; }
beforeEach(() => {
  vi.resetAllMocks();
  mock.createClient.mockReturnValue({ auth: mock });
  mock.verifyOtp.mockResolvedValue(verified());
  mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mock.signOut.mockResolvedValue({ error: null });
});
it('confirms once in an isolated nonpersistent client and continues through normal sign-in', async () => {
  expect(await confirmSignup(input)).toEqual({ work: false, returnTo: '/book', recovery: false, signInRequired: true, sessionPreserved: false });
  expect(mock.verifyOtp).toHaveBeenCalledExactlyOnceWith({ type: 'signup', token_hash: 'a'.repeat(56) });
  expect(mock.createClient.mock.calls[0][2].auth).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  expect(mock.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  expect(mock.stopAutoRefresh).toHaveBeenCalledOnce();
});
it('preserves a different signed-in account without adopting the verified session', async () => {
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: 'existing-other-user' } } } });
  expect((await confirmSignup(input)).sessionPreserved).toBe(true);
  expect(mock.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  // There is deliberately no shared setSession/signOut capability in the adapter.
});
it('checks the current identity after verification, including a concurrent sign-in', async () => {
  mock.verifyOtp.mockImplementation(async () => {
    mock.getSession.mockResolvedValue({ data: { session: { user: { id: 'concurrent-user' } } } });
    return verified();
  });
  expect((await confirmSignup(input)).sessionPreserved).toBe(true);
});
it('can continue an already signed-in matching account but never adopts a native fallback session', async () => {
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: 'verified-user' } } } });
  expect((await confirmSignup(input)).signInRequired).toBe(false);
  expect((await confirmSignup(input.replace('?next=book', '?next=account&signup_fallback=ios'))).signInRequired).toBe(true);
});
it('keeps manager verification on the team sign-in route', async () => {
  mock.verifyOtp.mockResolvedValue(verified('manager'));
  expect((await confirmSignup(input.replace('next=book', 'next=work'))).work).toBe(true);
});
it.each(['admin', 'agent'])('rejects privileged %s identities without touching the shared session', async role => {
  mock.verifyOtp.mockResolvedValue(verified(role));
  await expect(confirmSignup(input)).rejects.toThrow('INVALID_CODE');
  expect(mock.getSession).not.toHaveBeenCalled();
  expect(mock.signOut).toHaveBeenCalledOnce();
});
it('rejects consumed/expired links without treating them as a successful confirmation', async () => {
  mock.verifyOtp.mockResolvedValue({ error: { code: 'otp_expired' }, data: {} });
  await expect(confirmSignup(input)).rejects.toThrow('INVALID_CODE');
  expect(mock.getSession).not.toHaveBeenCalled();
});
it.each([
  input.replace('app.example.test', 'evil.example.test'),
  input.replace('next=book', 'next=https://evil.example.test'),
  input.replace('next=book', 'next=book&next=work'),
  input + '&access_token=unexpected', input + '&type=signup',
  input.replace('type=signup', 'type=recovery'),
])('rejects malformed or mixed-purpose callbacks before verifying', async value => {
  await expect(confirmSignup(value)).rejects.toThrow('INVALID_CODE');
  expect(mock.verifyOtp).not.toHaveBeenCalled();
});
