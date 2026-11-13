import { customerCapable } from '../lib/accountSession';
import { redirectStaffMfa } from '../lib/staffMfaReturn';
import { passwordProof, rememberPasswordProof, forgetPasswordProof } from '../lib/customerPasswordProof';
import { nativeEmailReturn } from '../lib/nativeEmailReturn';
import { rememberBookingReturn } from '../utils/customerBookingDraft';
import { appConfig, customerFeaturesEnabled } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';
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
  let response; let result;
  try {
    response = await functionFetch(`${appConfig.supabaseUrl}/functions/v1/customer-auth`, {
      method: 'POST', headers: { apikey: appConfig.supabasePublishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(20000),
    });
    result = await response.json();
  } catch (error) {
    // A transport timeout may occur after the server committed the password.
    // Do not present a retryable form for an unknown credential-write outcome.
    if (['password-change', 'email-reset'].includes(action)) throw new Error('PASSWORD_UPDATE_UNCERTAIN', { cause: error });
    throw error;
  }
  if (!response.ok) {
    if (authenticated && ['AUTH_REQUIRED', 'MFA_REQUIRED'].includes(result.error)) {
      const assurance = await customerSupabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!assurance.error && assurance.data?.currentLevel === 'aal1' && assurance.data?.nextLevel === 'aal2') {
        redirectStaffMfa();
        throw new Error('MFA_REQUIRED');
      }
    }
    throw new Error(result.error || 'UNAVAILABLE');
  }
  return result;
}
async function acceptSession(result) {
  const { error } = await customerSupabase.auth.setSession(result.session);
  if (error) throw new Error('SIGN_IN_REQUIRED');
  if (result.mfaRequired) {
    redirectStaffMfa();
    throw new Error('MFA_REQUIRED');
  }
  return result.profile;
}
async function clearCustomerSession(alreadyRevoked = false) {
  const { error } = await customerSupabase.auth.signOut({ scope: 'local' });
  if (!error) return;
  if (!alreadyRevoked && error.name !== 'AuthSessionMissingError') throw new Error('UNAVAILABLE');
  // The gateway has already revoked this session. Auth JS treats the resulting
  // session_not_found response as an error before clearing its persisted token.
  // Both modes share these keys; signing out ends the one active account.
  localStorage.removeItem(CUSTOMER_AUTH_STORAGE_KEY);
  localStorage.removeItem(`${CUSTOMER_AUTH_STORAGE_KEY}-code-verifier`);
  localStorage.removeItem(`${CUSTOMER_AUTH_STORAGE_KEY}-user`);
  // With storage empty the public SDK emits SIGNED_OUT to both contexts/tabs.
  await customerSupabase.auth.signOut({ scope: 'local' });
}
const OAUTH_RETURN_KEY = 'barber-customer-oauth-return';
let callbackExchange;
const destination = value => value === '/book' ? '/book' : '/customer/account';

export const customerAuthService = {
  async favourites() { return (await request('favourites-list', {}, true)).favourites; },
  async saveFavourite(kind, targetId) { return (await request('favourites-save', { kind, targetId }, true)).favourites; },
  async removeFavourite(kind, targetId) { return (await request('favourites-remove', { kind, targetId }, true)).favourites; },
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
    if (returnTo === '/book') rememberBookingReturn({ preserveDraft: true });
    localStorage.setItem(OAUTH_RETURN_KEY, destination(returnTo));
    callbackExchange = null;
    const { error } = await customerSupabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/customer/auth-callback` } });
    if (error) { localStorage.removeItem(OAUTH_RETURN_KEY); throw new Error('SOCIAL_SIGN_IN_FAILED'); }
  },
  async finishSocial(url) {
    const callback = new URL(url);
    const returnTo = localStorage.getItem(OAUTH_RETURN_KEY);
    const code = callback.searchParams.get('code');
    if (callback.searchParams.has('error') || !code || !returnTo) throw new Error('SOCIAL_SIGN_IN_FAILED');
    callbackExchange ||= customerSupabase.auth.exchangeCodeForSession(code);
    const { error } = await callbackExchange;
    if (error) throw new Error('SOCIAL_SIGN_IN_FAILED');
    localStorage.removeItem(OAUTH_RETURN_KEY);
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
  async getProfile() {
    if (!customerSupabase) return null;
    const { data, error } = await customerSupabase.auth.getSession();
    if (error) throw new Error('AUTH_REQUIRED');
    if (!data.session || !customerCapable(data.session.user.app_metadata?.role)) return null;
    const profile = (await request('profile', {}, true)).profile;
    if (profile?.needsName) return null;
    return profile;
  },
  async login({ email, password }) { return acceptSession(await request('email-login', { email, password })); },
  requestSignup: ({ name, email, password, returnTo }) => request('email-signup', { name, email, password, returnTo }),
  resendConfirmation: ({ email, returnTo }) => request('email-resend', { email, returnTo }),
  requestRecovery: ({ email, returnTo, audience }) => request('email-recovery', { email, returnTo, ...(audience === 'work' ? { audience } : {}) }),
  passwordStatus: () => request('password-status', {}, true),
  async nativeRecoveryDelivery(input) {
    const url = new URL(input); const hash = new URLSearchParams(url.hash.slice(1));
    const result = await request('password-native-delivery', { requestId: url.searchParams.get('request_id'), nativeState: url.searchParams.get('state'), tokenHash: hash.get('token_hash') || url.searchParams.get('token_hash') });
    return nativeEmailReturn(input, appConfig, result.deliveryToken);
  },
  setupPassword: ({ audience, returnTo } = {}) => request('password-setup-request', { ...(audience === 'work' ? { audience } : {}), ...(returnTo === '/book' ? { returnTo } : {}) }, true),
  async changePassword({ currentPassword, password, confirmPassword }) {
    try { await request('password-change', { currentPassword, password, confirmPassword }, true); }
    catch (error) { if (error.message === 'PASSWORD_UPDATE_UNCERTAIN') { forgetPasswordProof(); await clearCustomerSession(true).catch(() => {}); } throw error; }
    forgetPasswordProof(); await clearCustomerSession(true);
  },
  async verifyRecovery({ requestId, code, tokenHash, signInPath }) {
    const result = await request('password-recovery-verify', { requestId, ...(tokenHash ? { tokenHash } : { code }) });
    if (!result.session || (!customerCapable(result.session.user?.app_metadata?.role) && !result.legacyRecovery)) throw new Error('INVALID_CODE');
    const { error } = await customerSupabase.auth.setSession(result.session);
    if (error) throw new Error('INVALID_CODE');
    rememberPasswordProof(result, signInPath);
    return result;
  },
  async verifyInvite(tokenHash) {
    const result = await request('password-invite-verify', { tokenHash });
    if (result.session?.user?.app_metadata?.role !== 'barber') throw new Error('INVALID_CODE');
    const { error } = await customerSupabase.auth.setSession(result.session);
    if (error) throw new Error('INVALID_CODE');
    rememberPasswordProof(result, '/login');
    return result;
  },
  async verifyEmailCode({ email, code, purpose, requestId, signInPath }) {
    if (!['signup', 'recovery'].includes(purpose) || !/^\d{6,10}$/.test(code)) throw new Error('INVALID_CODE');
    if (purpose === 'recovery') return this.verifyRecovery({ requestId, code, signInPath });
    const result = await customerSupabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: purpose === 'recovery' ? 'recovery' : 'email' });
    if (result.error) throw new Error(result.error.status === 429 ? 'RATE_LIMITED' : result.error.status >= 500 ? 'UNAVAILABLE' : 'INVALID_CODE');
    if (!customerCapable(result.data.user?.app_metadata?.role) || !result.data.user?.email_confirmed_at || !result.data.session) {
      await customerSupabase.auth.signOut({ scope: 'local' });
      throw new Error('INVALID_CODE');
    }
  },
  async resetPassword({ password, confirmPassword }) {
    const proof = passwordProof();
    if (!proof) throw new Error('PASSWORD_PROOF_REQUIRED');
    try { await request('email-reset', { password, confirmPassword, proof: proof.proof }, true); }
    catch (error) { if (error.message === 'PASSWORD_UPDATE_UNCERTAIN') { forgetPasswordProof(); await clearCustomerSession(true).catch(() => {}); } throw error; }
    forgetPasswordProof(); await clearCustomerSession(true);
  },
  async ensureEmailProfile(name = '') { return (await request('email-ensure', { name }, true)).profile; },
  async finishEmail(url) {
    const callback = new URL(url);
    let type = callback.searchParams.get('type');
    const fragment = new URLSearchParams(callback.hash.slice(1));
    type ||= fragment.get('type');
    const token = callback.searchParams.get('token_hash') || fragment.get('token_hash');
    const code = callback.searchParams.get('code');
    // Remove one-time credentials and provider error details before rendering links.
    window.history.replaceState(null, '', callback.pathname);
    if (callback.searchParams.has('error') || fragment.has('error')) throw new Error('INVALID_CODE');
    if (type === 'recovery') {
      if (!token || !callback.searchParams.get('request_id')) throw new Error('PASSWORD_PROOF_REQUIRED');
      const result = await this.verifyRecovery({ requestId: callback.searchParams.get('request_id'), tokenHash: token, signInPath: callback.searchParams.get('next') === 'work' ? '/login' : '/customer/sign-in' });
      return { recovery: true, legacyRecovery: result.legacyRecovery === true, returnTo: callback.searchParams.get('next') === 'book' ? '/book' : '/customer/account' };
    }
    let result;
    if (fragment.has('access_token') && fragment.has('refresh_token') && ['signup', 'magiclink', 'recovery', 'email_change'].includes(fragment.get('type'))) {
      if (type && type !== fragment.get('type')) throw new Error('INVALID_CODE');
      type = fragment.get('type');
      result = await customerSupabase.auth.setSession({ access_token: fragment.get('access_token'), refresh_token: fragment.get('refresh_token') });
    } else if (token && ['signup', 'magiclink', 'recovery', 'email_change'].includes(type)) result = await customerSupabase.auth.verifyOtp({ type, token_hash: token });
    else if (code) result = await customerSupabase.auth.exchangeCodeForSession(code);
    else throw new Error('INVALID_CODE');
    if (result.error || !customerCapable(result.data.user?.app_metadata?.role) || !result.data.user?.email_confirmed_at) {
      await customerSupabase.auth.signOut({ scope: 'local' });
      throw new Error('INVALID_CODE');
    }
    return { recovery: type === 'recovery', returnTo: callback.searchParams.get('next') === 'book' ? '/book' : '/customer/account' };
  },
  changeEmail() { return Promise.reject(new Error('EMAIL_ADMIN_ONLY')); },
  async updateProfile(data) {
    const { data: auth, error } = await customerSupabase.auth.getUser();
    if (error || !customerCapable(auth.user?.app_metadata?.role)) throw new Error('AUTH_REQUIRED');
    if (data.email && data.email.trim().toLowerCase() !== (auth.user.email || '').toLowerCase()) throw new Error('EMAIL_ADMIN_ONLY');
    return (await request('update-profile', { ...data, email: auth.user.email || '' }, true)).profile;
  },
  appointmentSlots: (bookingId, date) => request('appointment-slots', { bookingId, date }, true),
  rescheduleBooking: (booking, date, time) => request('reschedule-booking', {
    bookingId: booking.id, expectedDate: booking.date, expectedTime: booking.time.slice(0, 5), date, time,
  }, true),
  cancelBooking: booking => request('cancel-booking', {
    bookingId: booking.id, expectedDate: booking.date, expectedTime: booking.time.slice(0, 5),
  }, true),
  async bookings() { return (await request('bookings', {}, true)).bookings; },
  async rateBooking(bookingId, shopRating, barberRating) {
    return request('rate-booking', { bookingId, shopRating, barberRating }, true);
  },
  async logout() {
    // Auth revokes the session and broadcasts SIGNED_OUT for both modes.
    await clearCustomerSession();
  },
  subscribe(callback) { return customerSupabase?.auth.onAuthStateChange(callback).data.subscription; },
};
