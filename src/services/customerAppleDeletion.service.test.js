import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ create: vi.fn(), session: vi.fn(), request: vi.fn(), oauth: vi.fn(), exchange: vi.fn(), signOut: vi.fn(), stop: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: state.create }));
vi.mock('../lib/customerSupabase', () => ({ customerSupabase: { auth: { getSession: state.session } } }));
vi.mock('../lib/runtimeConfig', () => ({ appConfig: { supabaseUrl: 'https://qvkucvcjmojjbphlzlks.supabase.co', supabasePublishableKey: 'public' } }));
vi.mock('../lib/functionFetch', () => ({ functionFetch: vi.fn() }));
vi.mock('./customerDeletion.service', () => ({ deletionRequest: state.request }));
import { connectAppleForDeletion, returnAppleDeletion } from './customerAppleDeletion.service';
let popup; let destination;
const owner = 'owner';
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear();
  destination = '';
  popup = { closed: false, close: vi.fn(), location: { replace: vi.fn(url => { destination = url; }) } };
  vi.spyOn(window, 'open').mockReturnValue(popup);
  state.create.mockReturnValue({ auth: { signInWithOAuth: state.oauth, exchangeCodeForSession: state.exchange, signOut: state.signOut, stopAutoRefresh: state.stop } });
  state.session.mockResolvedValue({ data: { session: { user: { id: owner } } } });
  state.request.mockImplementation(async action => action === 'apple-status' ? { available: true } : { registered: true });
  state.oauth.mockImplementation(async ({ options }) => ({ data: { url: `https://qvkucvcjmojjbphlzlks.supabase.co/auth/v1/authorize?redirect_to=${encodeURIComponent(options.redirectTo)}` } }));
  state.exchange.mockResolvedValue({ data: { session: { user: { id: owner }, provider_refresh_token: 'private-provider-token', provider_token: 'access' } } });
  state.signOut.mockResolvedValue({ error: null }); state.stop.mockResolvedValue();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function ready() { for (let i = 0; i < 20 && !destination; i++) await Promise.resolve(); expect(destination).not.toBe(''); return new URL(new URL(destination).searchParams.get('redirect_to')).searchParams.get('deletion_apple'); }
function message(nonce, extra = {}, source = popup, origin = window.location.origin) {
  window.dispatchEvent(new MessageEvent('message', { origin, source, data: { type: 'barber-apple-deletion', state: nonce, code: 'one-time-code', ...extra } }));
}
it('uses memory-only PKCE, same-account registration and isolated-session cleanup, without changing persisted state', async () => {
  localStorage.setItem('regular-session', 'untouched');
  const result = connectAppleForDeletion(); const nonce = await ready(); message(nonce);
  await expect(result).resolves.toEqual({ registered: true });
  expect(state.create.mock.calls[0][2].auth).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce' });
  expect(state.request).toHaveBeenCalledWith('apple-register', { platform: 'web', providerRefreshToken: 'private-provider-token' });
  expect(state.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  expect(localStorage.getItem('regular-session')).toBe('untouched'); expect(sessionStorage.length).toBe(0);
  expect(popup.close).toHaveBeenCalled();
});
it('ignores messages from another origin, popup or state', async () => {
  const result = connectAppleForDeletion(); const nonce = await ready();
  message(nonce, {}, popup, 'https://evil.test'); message('wrong'); message(nonce, {}, window);
  expect(state.exchange).not.toHaveBeenCalled(); message(nonce); await result;
  expect(state.exchange).toHaveBeenCalledExactlyOnceWith('one-time-code');
});
it.each(['wrong-user', 'missing-token', 'exchange-error', 'account-switch'])('rejects %s without registering credentials', async kind => {
  if (kind === 'wrong-user') state.exchange.mockResolvedValue({ data: { session: { user: { id: 'another' }, provider_refresh_token: 'wrong' } } });
  if (kind === 'missing-token') state.exchange.mockResolvedValue({ data: { session: { user: { id: owner } } } });
  if (kind === 'exchange-error') state.exchange.mockResolvedValue({ data: {}, error: Error('private') });
  if (kind === 'account-switch') state.session.mockResolvedValueOnce({ data: { session: { user: { id: owner } } } }).mockResolvedValue({ data: { session: { user: { id: 'another' } } } });
  const result = connectAppleForDeletion(); const nonce = await ready(); message(nonce);
  await expect(result).rejects.toThrow(/^APPLE_/);
  expect(state.request.mock.calls.some(([action]) => action === 'apple-register')).toBe(false);
  expect(popup.close).toHaveBeenCalled();
});
it('handles blocked popups without any Auth or provider request', async () => {
  window.open.mockReturnValue(null);
  await expect(connectAppleForDeletion()).rejects.toThrow('APPLE_POPUP_BLOCKED'); expect(state.request).not.toHaveBeenCalled();
});
it('handles unavailable capability before navigating to a provider', async () => {
  state.request.mockResolvedValue({ available: false });
  await expect(connectAppleForDeletion()).rejects.toThrow('APPLE_NOT_AVAILABLE'); expect(state.oauth).not.toHaveBeenCalled(); expect(popup.close).toHaveBeenCalled();
});
it('does not request a new Apple authorization when registration already exists', async () => {
  state.request.mockResolvedValue({ available: true, registered: true });
  await expect(connectAppleForDeletion()).resolves.toEqual({ registered: true }); expect(state.oauth).not.toHaveBeenCalled();
});
it('aborts an in-flight popup when the deletion page is left', async () => {
  const controller = new AbortController(); const result = connectAppleForDeletion(controller.signal); await ready();
  controller.abort(); await expect(result).rejects.toThrow('APPLE_CANCELLED'); expect(state.exchange).not.toHaveBeenCalled(); expect(popup.close).toHaveBeenCalled();
});
it('preserves the existing session and stops cleanly when registration fails', async () => {
  state.request.mockImplementation(async action => { if (action === 'apple-register') throw Error('APPLE_UNAVAILABLE'); return { available: true }; });
  const result = connectAppleForDeletion(); const nonce = await ready(); message(nonce);
  await expect(result).rejects.toThrow('APPLE_UNAVAILABLE'); expect(state.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
});
it('handles explicit cancellation without exchanging a code', async () => {
  const result = connectAppleForDeletion(); const nonce = await ready(); message(nonce, { cancelled: true });
  await expect(result).rejects.toThrow('APPLE_CANCELLED'); expect(state.exchange).not.toHaveBeenCalled();
});
it('times out or detects popup closure and removes listeners', async () => {
  vi.useFakeTimers(); const result = connectAppleForDeletion(); await ready(); popup.closed = true;
  const check = expect(result).rejects.toThrow('APPLE_CANCELLED'); await vi.advanceTimersByTimeAsync(400); await check;
  expect(vi.getTimerCount()).toBe(0);
  popup.closed = false; destination = '';
  const second = connectAppleForDeletion(); await ready(); const timeout = expect(second).rejects.toThrow('APPLE_TIMEOUT');
  await vi.advanceTimersByTimeAsync(120000); await timeout; expect(vi.getTimerCount()).toBe(0);
});
it('never redirects to an unexpected provider URL', async () => {
  state.oauth.mockResolvedValue({ data: { url: 'https://evil.test/auth/v1/authorize' } });
  await expect(connectAppleForDeletion()).rejects.toThrow('APPLE_UNAVAILABLE'); expect(popup.location.replace).not.toHaveBeenCalled();
});
it('returns only a one-time code to the exact opener and scrubs the callback URL', () => {
  const opener = { postMessage: vi.fn() }; vi.stubGlobal('opener', opener); vi.spyOn(window, 'close').mockImplementation(() => {});
  const replace = vi.spyOn(window.history, 'replaceState'); const nonce = crypto.randomUUID();
  expect(returnAppleDeletion(`${window.location.origin}/customer/auth-callback?deletion_apple=${nonce}&code=one-time&untrusted=value`)).toBe(true);
  expect(replace).toHaveBeenCalledWith(null, '', '/customer/auth-callback');
  expect(opener.postMessage).toHaveBeenCalledWith({ type: 'barber-apple-deletion', state: nonce, code: 'one-time' }, window.location.origin);
  vi.unstubAllGlobals();
});
