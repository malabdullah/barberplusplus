import { beforeEach, expect, it, vi } from 'vitest';
const main = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn(), setSession: vi.fn() }));
const oauth = vi.hoisted(() => ({ setSession: vi.fn(), signInWithOAuth: vi.fn(), linkIdentity: vi.fn(), exchangeCodeForSession: vi.fn(), getUser: vi.fn(), signOut: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: main } }));
vi.mock('../lib/teamOAuthSupabase', () => ({ teamOAuthSupabase: { auth: oauth }, TEAM_OAUTH_STORAGE_KEY: 'barber-team-oauth' }));
vi.mock('../lib/runtimeConfig', () => ({ appConfig: { supabaseUrl: 'https://test.supabase.co', supabasePublishableKey: 'public' } }));
import { teamAuthService, staffDestination } from './teamAuth.service';
const manager = { id: 'manager-id', app_metadata: { role: 'manager' }, email_confirmed_at: 'confirmed', identities: [{ provider: 'google' }] };
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ external: { google: true, apple: true } }) }));
  main.getUser.mockResolvedValue({ data: { user: manager } }); main.getSession.mockResolvedValue({ data: { session: { access_token: 'manager-token' } } }); main.setSession.mockResolvedValue({ error: null });
  oauth.setSession.mockResolvedValue({ error: null }); oauth.signInWithOAuth.mockResolvedValue({ error: null }); oauth.linkIdentity.mockResolvedValue({ error: null }); oauth.exchangeCodeForSession.mockResolvedValue({ data: { session: { access_token: 'verified-manager' } } }); oauth.getUser.mockResolvedValue({ data: { user: manager } });
});
it('starts manager OAuth with an isolated PKCE callback and accepts only the verified manager session', async () => {
  await teamAuthService.startSocial('google');
  expect(oauth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: `${window.location.origin}/team/auth-callback` } });
  expect(main.setSession).not.toHaveBeenCalled();
  expect(await teamAuthService.finishSocial(`${window.location.origin}/team/auth-callback?code=auth-code`)).toBe('/dashboard');
  expect(main.setSession).toHaveBeenCalledWith({ access_token: 'verified-manager' });
  expect(sessionStorage.getItem('barber-team-oauth-pending')).toBeNull();
});
it.each(['customer', 'admin', 'agent', 'barber', undefined])('rejects the %s role without installing a staff session or changing any role', async role => {
  await teamAuthService.startSocial('google'); oauth.getUser.mockResolvedValue({ data: { user: { ...manager, app_metadata: { role } } } });
  await expect(teamAuthService.finishSocial(`${window.location.origin}/team/auth-callback?code=auth-code`)).rejects.toThrow('MANAGER_REQUIRED');
  expect(main.setSession).not.toHaveBeenCalled(); expect(oauth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
it('links only for a signed-in manager and preserves their original user ID', async () => {
  await teamAuthService.connectProvider('google'); expect(oauth.linkIdentity).toHaveBeenCalled();
  expect(await teamAuthService.finishSocial(`${window.location.origin}/team/auth-callback?code=auth-code`)).toBe('/dashboard/settings?connected=1');
  await teamAuthService.connectProvider('google'); oauth.getUser.mockResolvedValue({ data: { user: { ...manager, id: 'other-manager' } } });
  await expect(teamAuthService.finishSocial(`${window.location.origin}/team/auth-callback?code=other-code`)).rejects.toThrow('MANAGER_REQUIRED');
  expect(main.setSession).toHaveBeenCalledTimes(1);
});
it('rejects customer-initiated linking, cancellation, unstarted and replayed callbacks', async () => {
  main.getUser.mockResolvedValue({ data: { user: { ...manager, app_metadata: { role: 'customer' } } } });
  await expect(teamAuthService.connectProvider('google')).rejects.toThrow('MANAGER_REQUIRED'); expect(oauth.linkIdentity).not.toHaveBeenCalled();
  await expect(teamAuthService.finishSocial(`${window.location.origin}/team/auth-callback?code=unsolicited`)).rejects.toThrow('SOCIAL_FAILED');
  await teamAuthService.startSocial('google'); await expect(teamAuthService.finishSocial(`${window.location.origin}/team/auth-callback?error=access_denied`)).rejects.toThrow('SOCIAL_FAILED');
  expect(oauth.exchangeCodeForSession).not.toHaveBeenCalled();
  await teamAuthService.startSocial('google'); await teamAuthService.finishSocial(`${window.location.origin}/team/auth-callback?code=once`);
  await expect(teamAuthService.finishSocial(`${window.location.origin}/team/auth-callback?code=once`)).rejects.toThrow('SOCIAL_FAILED');
  expect(oauth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
});
it('rejects a different provider and expired transactions', async () => {
  await teamAuthService.startSocial('apple');
  await expect(teamAuthService.finishSocial(`${window.location.origin}/team/auth-callback?code=wrong-provider`)).rejects.toThrow('MANAGER_REQUIRED');
  await teamAuthService.startSocial('google'); const pending = JSON.parse(sessionStorage.getItem('barber-team-oauth-pending')); pending.startedAt -= 16 * 60000; sessionStorage.setItem('barber-team-oauth-pending', JSON.stringify(pending));
  await expect(teamAuthService.finishSocial(`${window.location.origin}/team/auth-callback?code=expired`)).rejects.toThrow('SOCIAL_FAILED');
});
it.each([['manager', '/dashboard'], ['admin', '/admin'], ['agent', '/agent'], ['barber', '/barber']])('preserves the %s password destination', (role, route) => expect(staffDestination(role)).toBe(route));
