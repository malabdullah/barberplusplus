import { createClient } from '@supabase/supabase-js';
import { appConfig, customerFeaturesEnabled } from '../lib/runtimeConfig';
import { customerSupabase, CUSTOMER_AUTH_STORAGE_KEY } from '../lib/customerSupabase';
export async function customerToken() {
  if (!customerSupabase) return '';
  const { data, error } = await customerSupabase.auth.getSession();
  if (error) throw new Error('AUTH_REQUIRED');
  return data.session?.access_token || '';
}
async function request(action, data = {}, authenticated = false) {
  if (!customerFeaturesEnabled) throw new Error('NOT_AVAILABLE');
  const token = authenticated ? await customerToken() : '';
  if (authenticated && !token) throw new Error('AUTH_REQUIRED');
  const response = await fetch(`${appConfig.supabaseUrl}/functions/v1/customer-auth`, {
    method: 'POST', headers: { apikey: appConfig.supabasePublishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'UNAVAILABLE');
  return result;
}
async function acceptSession(result) {
  const { error } = await customerSupabase.auth.setSession(result.session);
  if (error) throw new Error('SIGN_IN_REQUIRED');
  return result.profile;
}
async function clearCustomerSession() {
  const { error } = await customerSupabase.auth.signOut({ scope: 'local' });
  if (!error) return;
  if (error.name !== 'AuthSessionMissingError') throw new Error('UNAVAILABLE');
  // The gateway has already revoked this session. Auth JS treats the resulting
  // session_not_found response as an error before clearing its persisted token.
  // Clear only the isolated customer keys; staff sessions remain untouched.
  localStorage.removeItem(CUSTOMER_AUTH_STORAGE_KEY);
  localStorage.removeItem(`${CUSTOMER_AUTH_STORAGE_KEY}-code-verifier`);
}
const OAUTH_RETURN_KEY = 'barber-customer-oauth-return';
let callbackExchange;
const destination = value => value === '/book' ? '/book' : '/customer/account';

export const customerAuthService = {
  async socialProviders() {
    if (!customerFeaturesEnabled) return { google: false, apple: false };
    const response = await fetch(`${appConfig.supabaseUrl}/auth/v1/settings`, { headers: { apikey: appConfig.supabasePublishableKey }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('UNAVAILABLE');
    const settings = await response.json();
    return { google: settings.external?.google === true, apple: settings.external?.apple === true };
  },
  async startSocial(provider, returnTo) {
    if (!customerFeaturesEnabled || !['google', 'apple'].includes(provider)) throw new Error('PROVIDER_UNAVAILABLE');
    const enabled = await this.socialProviders();
    if (!enabled[provider]) throw new Error('PROVIDER_UNAVAILABLE');
    sessionStorage.setItem(OAUTH_RETURN_KEY, destination(returnTo));
    callbackExchange = null;
    const { error } = await customerSupabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/customer/auth-callback` } });
    if (error) { sessionStorage.removeItem(OAUTH_RETURN_KEY); throw new Error('SOCIAL_SIGN_IN_FAILED'); }
  },
  async finishSocial(url) {
    const callback = new URL(url);
    const returnTo = sessionStorage.getItem(OAUTH_RETURN_KEY);
    const code = callback.searchParams.get('code');
    if (callback.searchParams.has('error') || !code || !returnTo) throw new Error('SOCIAL_SIGN_IN_FAILED');
    callbackExchange ||= customerSupabase.auth.exchangeCodeForSession(code);
    const { error } = await callbackExchange;
    if (error) throw new Error('SOCIAL_SIGN_IN_FAILED');
    sessionStorage.removeItem(OAUTH_RETURN_KEY);
    return destination(returnTo);
  },
  socialStatus: () => request('social-status', {}, true),
  requestSocialCode: ({ name, phone, countryCode }) => request('social-code', { name, phone, countryCode }, true),
  async completeSocial(data) {
    const result = await request('social-complete', data, true);
    const { error } = await customerSupabase.auth.refreshSession();
    if (error) throw new Error('SIGN_IN_REQUIRED');
    return result.profile;
  },
  async getProfile() { return await customerToken() ? (await request('profile', {}, true)).profile : null; },
  async login({ email, password }) { return acceptSession(await request('email-login', { email, password })); },
  requestSignup: ({ name, email, password, returnTo }) => request('email-signup', { name, email, password, returnTo }),
  resendConfirmation: ({ email, returnTo }) => request('email-resend', { email, returnTo }),
  requestRecovery: ({ email, returnTo }) => request('email-recovery', { email, returnTo }),
  async resetPassword({ password }) { await request('email-reset', { password }, true); await clearCustomerSession(); },
  async ensureEmailProfile(name = '') { return (await request('email-ensure', { name }, true)).profile; },
  async finishEmail(url) {
    const callback = new URL(url);
    let type = callback.searchParams.get('type');
    const token = callback.searchParams.get('token_hash');
    const code = callback.searchParams.get('code');
    const fragment = new URLSearchParams(callback.hash.slice(1));
    let result;
    if (fragment.has('access_token') && fragment.has('refresh_token') && ['signup', 'magiclink', 'recovery', 'email_change'].includes(fragment.get('type'))) {
      if (type && type !== fragment.get('type')) throw new Error('INVALID_CODE');
      type = fragment.get('type');
      window.history.replaceState(null, '', callback.pathname + callback.search);
      result = await customerSupabase.auth.setSession({ access_token: fragment.get('access_token'), refresh_token: fragment.get('refresh_token') });
    } else if (token && ['signup', 'magiclink', 'recovery', 'email_change'].includes(type)) result = await customerSupabase.auth.verifyOtp({ type, token_hash: token });
    else if (code) result = await customerSupabase.auth.exchangeCodeForSession(code);
    else throw new Error('INVALID_CODE');
    if (result.error || result.data.user?.app_metadata?.role !== 'customer' || !result.data.user?.email_confirmed_at) {
      await customerSupabase.auth.signOut({ scope: 'local' });
      throw new Error('INVALID_CODE');
    }
    return { recovery: type === 'recovery', returnTo: callback.searchParams.get('next') === 'book' ? '/book' : '/customer/account' };
  },
  async changeEmail(email) {
    const { data, error: sessionError } = await customerSupabase.auth.getSession();
    if (sessionError || !data.session) throw new Error('AUTH_REQUIRED');
    // Each confirmation link must work independently, including on another device.
    const client = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' } });
    const { error: setError } = await client.auth.setSession(data.session);
    if (setError) throw new Error('AUTH_REQUIRED');
    const { error } = await client.auth.updateUser({ email }, { emailRedirectTo: `${window.location.origin}/customer/email-callback` });
    if (error) throw new Error('UNAVAILABLE');
  },
  async updateProfile(data) {
    const { data: auth, error } = await customerSupabase.auth.getUser();
    if (error || auth.user?.app_metadata?.role !== 'customer') throw new Error('AUTH_REQUIRED');
    if (data.email && data.email.trim().toLowerCase() !== (auth.user.email || '').toLowerCase()) await this.changeEmail(data.email.trim());
    return (await request('update-profile', { ...data, email: auth.user.email || '' }, true)).profile;
  },
  async bookings() { return (await request('bookings', {}, true)).bookings; },
  async logout() {
    try { await request('logout', {}, true); } catch (error) { if (error.message !== 'AUTH_REQUIRED') throw error; }
    await clearCustomerSession();
  },
  subscribe(callback) { return customerSupabase?.auth.onAuthStateChange(callback).data.subscription; },
};
