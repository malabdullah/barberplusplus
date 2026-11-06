import { beforeEach, expect, it, vi } from 'vitest';
const mail = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: mail }) }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: {} } }));
vi.mock('./customerAuth.service', () => ({ customerAuthService: {} }));
vi.mock('../lib/runtimeConfig', () => ({ appConfig: { supabaseUrl: 'https://example.test', supabasePublishableKey: 'public-test-key' } }));
import { authService } from './auth.service';
beforeEach(() => { localStorage.clear(); mail.signUp.mockReset(); });
it('returns a confirmation step rather than a signed-in manager from a sessionless signup', async () => {
  mail.signUp.mockResolvedValue({ data: { user: { id: 'unconfirmed-user', identities: [{ provider: 'email' }] }, session: null }, error: null });
  expect(await authService.signup({ name: 'QA', email: 'signup@example.test', phone: '+965 59998721', password: 'Synthetic12!' }))
    .toEqual({ success: true, confirmationRequired: true });
});
it('rejects the fake successful response for an existing Google-linked email', async () => {
  mail.signUp.mockResolvedValue({ data: { user: { id: 'fake-id', identities: [] }, session: null }, error: null });
  expect(await authService.signup({ name: 'QA', email: ' Linked@Example.test ', phone: '+965 59998721', password: 'Synthetic12!' }))
    .toEqual({ success: false, error: 'SIGNUP_EMAIL_EXISTS' });
  expect(mail.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'linked@example.test' }));
});
it.each(['user_already_exists', 'email_exists'])('maps explicit %s errors to the same existing-account outcome', async code => {
  mail.signUp.mockResolvedValue({ data: { user: null, session: null }, error: { code, message: 'Account exists' } });
  expect(await authService.signup({ name: 'QA', email: 'existing@example.test', phone: '+965 59998721', password: 'Synthetic12!' }))
    .toEqual({ success: false, error: 'SIGNUP_EMAIL_EXISTS' });
});
it('never reports a confirmation email when Auth returned no user', async () => {
  mail.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
  expect(await authService.signup({ name: 'QA', email: 'unknown@example.test', phone: '+965 59998721', password: 'Synthetic12!' }))
    .toEqual({ success: false, error: 'REGISTRATION_FAILED' });
});
it('still requires normal sign-in when signup returns a non-persistent session', async () => {
  mail.signUp.mockResolvedValue({ data: { user: { id: 'user' }, session: { access_token: 'not-a-browser-session' } }, error: null });
  expect(await authService.signup({ name: 'QA', email: 'confirmed@example.test', phone: '+965 59998722', password: 'Synthetic12!' }))
    .toEqual({ success: true, confirmationRequired: false });
});
