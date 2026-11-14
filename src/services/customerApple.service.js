import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';

// The OAuth authorization code has already been consumed by Supabase. Only its
// provider refresh token is handed off transiently; never exchange that code again.
export async function registerWebApple(session, storageKey) {
  if (!session?.access_token) return;
  const request = async data => {
    const response = await functionFetch(`${appConfig.supabaseUrl}/functions/v1/customer-account-deletion`, {
      method: 'POST', headers: { apikey: appConfig.supabasePublishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('APPLE_UNAVAILABLE');
    return response.json();
  };
  try {
    if (session.provider_refresh_token) {
      const capability = await request({ action: 'apple-status', platform: 'web' });
      if (capability.available) await request({ action: 'apple-register', platform: 'web', providerRefreshToken: session.provider_refresh_token });
    }
  } catch { /* Optional registration never breaks login or the saved booking. */ }
  finally {
    // Supabase may have persisted provider credentials with its session. Remove
    // only those optional provider fields, preserving the app's actual session.
    delete session.provider_refresh_token; delete session.provider_token;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored?.user?.id === session.user?.id && stored.access_token === session.access_token) {
          delete stored.provider_refresh_token; delete stored.provider_token;
          localStorage.setItem(storageKey, JSON.stringify(stored));
        }
      }
    } catch { /* Storage may be unavailable; no token is copied elsewhere. */ }
  }
}
