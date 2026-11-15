import { createClient } from '@supabase/supabase-js';
import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';
import { customerSupabase } from '../lib/customerSupabase';
import { deletionRequest } from './customerDeletion.service';

// A separate, memory-only PKCE client keeps reconnection from replacing the
// signed-in account. The popup sends only its one-time code to its exact opener.
export async function connectAppleForDeletion(signal) {
  const checkActive = () => { if (signal?.aborted) throw Error('APPLE_CANCELLED'); };
  checkActive();
  const popup = window.open('about:blank', 'barber-apple-deletion', 'popup,width=520,height=700');
  if (!popup) throw Error('APPLE_POPUP_BLOCKED');
  const state = crypto.randomUUID();
  let client; let stop; let tokenSession;
  try {
    const { data: before } = await customerSupabase.auth.getSession();
    const owner = before.session?.user?.id;
    if (!owner) throw Error('AUTH_REQUIRED');
    const status = await deletionRequest('apple-status', { platform: 'web' });
    checkActive();
    if (!status.available) throw Error('APPLE_NOT_AVAILABLE');
    if (status.registered) return { registered: true };
    client = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
      global: { fetch: functionFetch },
      auth: { storageKey: `barber-apple-deletion-${state}`, flowType: 'pkce', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.signInWithOAuth({ provider: 'apple', options: {
      redirectTo: `${window.location.origin}/customer/auth-callback?deletion_apple=${state}`, skipBrowserRedirect: true,
    } });
    if (error || !data.url) throw Error('APPLE_UNAVAILABLE');
    checkActive();
    const target = new URL(data.url);
    if (target.origin !== new URL(appConfig.supabaseUrl).origin || target.pathname !== '/auth/v1/authorize') throw Error('APPLE_UNAVAILABLE');
    const result = new Promise((resolve, reject) => {
      const receive = event => {
        if (event.origin !== window.location.origin || event.source !== popup || event.data?.type !== 'barber-apple-deletion' || event.data.state !== state) return;
        if (event.data.cancelled) reject(Error('APPLE_CANCELLED'));
        else if (typeof event.data.code === 'string' && event.data.code.length > 0 && event.data.code.length <= 4096) resolve(event.data.code);
        else reject(Error('APPLE_UNAVAILABLE'));
      };
      window.addEventListener('message', receive);
      const abort = () => reject(Error('APPLE_CANCELLED'));
      signal?.addEventListener('abort', abort, { once: true });
      const closed = setInterval(() => { if (popup.closed) reject(Error('APPLE_CANCELLED')); }, 400);
      const timeout = setTimeout(() => reject(Error('APPLE_TIMEOUT')), 120000);
      stop = () => { window.removeEventListener('message', receive); signal?.removeEventListener('abort', abort); clearInterval(closed); clearTimeout(timeout); };
    });
    popup.location.replace(target.href);
    const code = await result;
    stop();
    checkActive();
    const exchanged = await client.auth.exchangeCodeForSession(code);
    tokenSession = exchanged.data?.session;
    const { data: current } = await customerSupabase.auth.getSession();
    if (!current.session || current.session.user.id !== owner) throw Error('APPLE_ACCOUNT_CHANGED');
    if (exchanged.error || tokenSession?.user?.id !== owner) throw Error('APPLE_PROOF_INVALID');
    if (!tokenSession.provider_refresh_token) throw Error('APPLE_TOKEN_UNAVAILABLE');
    checkActive();
    await deletionRequest('apple-register', { platform: 'web', providerRefreshToken: tokenSession.provider_refresh_token });
    const { data: after } = await customerSupabase.auth.getSession();
    if (after.session?.user?.id !== owner) throw Error('APPLE_ACCOUNT_CHANGED');
    return { registered: true };
  } finally {
    stop?.();
    popup.close();
    // End only the isolated Auth session, never the regular account session or
    // Apple grant. Nothing from this temporary client is persisted on disk.
    if (tokenSession) { delete tokenSession.provider_refresh_token; delete tokenSession.provider_token; }
    await client?.auth.signOut({ scope: 'local' }).catch(() => {});
    await client?.auth.stopAutoRefresh();
  }
}

export function returnAppleDeletion(input) {
  const url = new URL(input);
  const state = url.searchParams.get('deletion_apple');
  window.history.replaceState(null, '', url.pathname);
  if (url.origin !== window.location.origin || url.pathname !== '/customer/auth-callback' || !/^[0-9a-f-]{36}$/.test(state || '') || !window.opener) return false;
  const code = url.searchParams.get('code');
  const cancelled = url.searchParams.has('error');
  if (!cancelled && (!code || code.length > 4096)) return false;
  window.opener.postMessage({ type: 'barber-apple-deletion', state, ...(cancelled ? { cancelled: true } : { code }) }, window.location.origin);
  window.close();
  return true;
}
