import { beforeEach, expect, it, vi } from 'vitest';
const mail = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: mail }) }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: {} } }));
vi.mock('./customerAuth.service', () => ({ customerAuthService: {} }));
vi.mock('../lib/runtimeConfig', () => ({ appConfig: { supabaseUrl: 'https://example.test', supabasePublishableKey: 'public-test-key' } }));
import { authService } from './auth.service';
beforeEach(() => { localStorage.clear(); mail.signUp.mockReset(); });
it('returns a confirmation step rather than a signed-in manager from a sessionless signup', async () => {
  mail.signUp.mockResolvedValue({ data: { user: { id: 'obfuscated-or-unconfirmed-user' }, session: null }, error: null });
  expect(await authService.signup({ name: 'QA', email: 'signup@example.test', phone: '+965 59998721', password: 'Synthetic12!' }))
    .toEqual({ success: true, confirmationRequired: true });
});
it('still requires normal sign-in when signup returns a non-persistent session', async () => {
  mail.signUp.mockResolvedValue({ data: { user: { id: 'user' }, session: { access_token: 'not-a-browser-session' } }, error: null });
  expect(await authService.signup({ name: 'QA', email: 'confirmed@example.test', phone: '+965 59998722', password: 'Synthetic12!' }))
    .toEqual({ success: true, confirmationRequired: false });
});
