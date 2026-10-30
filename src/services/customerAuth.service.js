import { appConfig, isTest } from '../lib/runtimeConfig';
import { customerSupabase } from '../lib/customerSupabase';
export async function customerToken() {
  if (!customerSupabase) return '';
  const { data, error } = await customerSupabase.auth.getSession();
  if (error) throw new Error('AUTH_REQUIRED');
  return data.session?.access_token || '';
}
async function request(action, data = {}, authenticated = false) {
  if (!isTest) throw new Error('NOT_AVAILABLE');
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
export const customerAuthService = {
  async getProfile() { return await customerToken() ? (await request('profile', {}, true)).profile : null; },
  async login({ phone, countryCode, password }) { return acceptSession(await request('login', { phone, countryCode, password })); },
  requestSignup: ({ name, email, phone, countryCode }) => request('signup-code', { name, email, phone, countryCode }),
  async signup(data) { return acceptSession(await request('signup', data)); },
  requestRecovery: ({ phone, countryCode }) => request('recovery-code', { phone, countryCode }),
  async resetPassword(data) { await request('reset-password', data); await customerSupabase.auth.signOut({ scope: 'local' }); },
  async updateProfile(data) { return (await request('update-profile', data, true)).profile; },
  async bookings() { return (await request('bookings', {}, true)).bookings; },
  async logout() {
    try { await request('logout', {}, true); } catch (error) { if (error.message !== 'AUTH_REQUIRED') throw error; }
    const { error } = await customerSupabase.auth.signOut({ scope: 'local' });
    if (error) throw new Error('UNAVAILABLE');
  },
  subscribe(callback) { return customerSupabase?.auth.onAuthStateChange(callback).data.subscription; },
};
