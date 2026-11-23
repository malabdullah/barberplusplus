import { createClient } from '@supabase/supabase-js';
import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';
import { customerSupabase } from '../lib/customerSupabase';
import { customerCapable } from '../lib/accountSession';
import { signupConfirmation } from '../lib/signupConfirmation';

export async function confirmSignup(input) {
  const callback = signupConfirmation(input, appConfig.appUrl);
  return verifyEmailInIsolation({ type: 'signup', token_hash: callback.token }, callback);
}

export async function verifyEmailInIsolation(params, callback = {}) {
  // An email opened in an existing browser must never replace its signed-in user.
  // Confirm in memory, discard that new session, then use ordinary sign-in.
  const isolated = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
    global: { fetch: functionFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'barber-email-confirmation' },
  });
  const { data, error } = await isolated.auth.verifyOtp(params);
  let adopted = false;
  try {
    if (error || !data?.session || !data.user?.email_confirmed_at || !customerCapable(data.user.app_metadata?.role)) {
      throw Error(error?.status === 429 ? 'RATE_LIMITED' : error?.status >= 500 ? 'UNAVAILABLE' : 'INVALID_CODE');
    }
    const current = await customerSupabase.auth.getSession();
    if (current.error) throw Error('UNAVAILABLE');
    const existing = current.data?.session?.user?.id;
    if (callback.adopt && existing && existing !== data.user.id) throw Error('INVALID_CODE');
    if (callback.adopt && !existing) {
      const installed = await customerSupabase.auth.setSession(data.session);
      if (installed.error) throw Error('INVALID_CODE');
      adopted = true;
    }
    return { email: data.user.email, work: callback.work, returnTo: callback.returnTo, recovery: false,
      signInRequired: callback.fallback || existing !== data.user.id,
      sessionPreserved: Boolean(existing && existing !== data.user.id) };
  } finally {
    // This client has a separate in-memory session; shared account storage and
    // sessions in other tabs/devices are not signed out or overwritten.
    if (data?.session && !adopted) await isolated.auth.signOut({ scope: 'local' }).catch(() => {});
    isolated.auth.stopAutoRefresh();
  }
}
