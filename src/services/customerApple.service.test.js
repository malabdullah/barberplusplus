import { beforeEach, expect, it, vi } from 'vitest';
const send = vi.hoisted(() => vi.fn());
vi.mock('../lib/functionFetch', () => ({ functionFetch: send }));
vi.mock('../lib/runtimeConfig', () => ({ appConfig: { supabaseUrl: 'https://test.supabase.co', supabasePublishableKey: 'public' } }));
import { registerWebApple } from './customerApple.service';
const make = () => ({ user: { id: 'owner' }, access_token: 'app-access', refresh_token: 'app-refresh', provider_refresh_token: 'apple-refresh', provider_token: 'apple-access' });
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
it('registers only transient provider token and keeps the app session while stripping persisted provider fields', async () => {
  const session = make(); localStorage.setItem('session', JSON.stringify(session));
  send.mockResolvedValueOnce({ ok: true, json: async () => ({ available: true }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ registered: true }) });
  await registerWebApple(session, 'session');
  expect(send).toHaveBeenCalledTimes(2);
  const body = JSON.parse(send.mock.calls[1][1].body);expect(body).toEqual({ action: 'apple-register', platform: 'web', providerRefreshToken: 'apple-refresh' });
  expect(JSON.parse(localStorage.getItem('session'))).toEqual({ user: { id: 'owner' }, access_token: 'app-access', refresh_token: 'app-refresh' });
  expect(session.provider_refresh_token).toBeUndefined();
});
it('does not exchange a consumed authorization code or call unavailable provider; login survives failures', async () => {
  for (const response of [{ ok: true, json: async () => ({ available: false }) }, { ok: false }]) {
    send.mockReset();send.mockResolvedValue(response);const session = make();
    await expect(registerWebApple(session, 'session')).resolves.toBeUndefined();expect(send).toHaveBeenCalledTimes(1);expect(session.provider_token).toBeUndefined();
  }
});
it('never overwrites a different account or newer session during asynchronous handoff', async () => {
  const next = { user: { id: 'other' }, access_token: 'new-access', provider_token: 'other-provider' };
  send.mockImplementation(async () => { localStorage.setItem('session', JSON.stringify(next));return { ok: true, json: async () => ({ available: false }) }; });
  await registerWebApple(make(), 'session');expect(JSON.parse(localStorage.getItem('session'))).toEqual(next);
});
it('does nothing when no provider refresh token exists', async () => {
  const session = { access_token: 'app-access', provider_token: 'unusable-provider-token' };
  await registerWebApple(session, 'session');expect(send).not.toHaveBeenCalled();expect(session.provider_token).toBeUndefined();
});
