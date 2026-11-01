import { supabase } from '../lib/supabase';
import { teamOAuthSupabase, TEAM_OAUTH_STORAGE_KEY } from '../lib/teamOAuthSupabase';
import { appConfig } from '../lib/runtimeConfig';
const pendingKey = 'barber-team-oauth-pending';
const providers = ['google', 'apple'];
export const staffDestination = role => ({ manager: '/dashboard', admin: '/admin', barber: '/barber', agent: '/agent' })[role] || '/login';
async function clearTemporarySession() {
  // The accepted session belongs to the main client. Do not revoke it here.
  sessionStorage.removeItem(TEAM_OAUTH_STORAGE_KEY);
  sessionStorage.removeItem(`${TEAM_OAUTH_STORAGE_KEY}-code-verifier`);
  sessionStorage.removeItem(pendingKey);
}
async function settings() {
  const response = await fetch(`${appConfig.supabaseUrl}/auth/v1/settings`, { headers: { apikey: appConfig.supabasePublishableKey }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('PROVIDER_UNAVAILABLE');
  const result = await response.json();
  return { google: result.external?.google === true, apple: result.external?.apple === true };
}
async function start(provider, linking) {
  if (!providers.includes(provider) || !(await settings())[provider]) throw new Error('PROVIDER_UNAVAILABLE');
  let managerId = '';
  if (linking) {
    const { data, error } = await supabase.auth.getUser();
    if (error || data.user?.app_metadata?.role !== 'manager') throw new Error('MANAGER_REQUIRED');
    managerId = data.user.id;
    const session = await supabase.auth.getSession();
    if (session.error || !session.data.session) throw new Error('MANAGER_REQUIRED');
    const accepted = await teamOAuthSupabase.auth.setSession(session.data.session);
    if (accepted.error) throw new Error('SOCIAL_FAILED');
  }
  sessionStorage.setItem(pendingKey, JSON.stringify({ provider, linking, managerId, startedAt: Date.now() }));
  const options = { redirectTo: `${window.location.origin}/team/auth-callback` };
  const result = linking
    ? await teamOAuthSupabase.auth.linkIdentity({ provider, options })
    : await teamOAuthSupabase.auth.signInWithOAuth({ provider, options });
  if (result.error) { await clearTemporarySession(); throw new Error(result.error.code === 'manual_linking_disabled' ? 'LINKING_UNAVAILABLE' : 'SOCIAL_FAILED'); }
}
export const teamAuthService = {
  socialProviders: settings,
  startSocial: provider => start(provider, false),
  connectProvider: provider => start(provider, true),
  async connectedProviders() {
    const { data, error } = await supabase.auth.getUser();
    if (error || data.user?.app_metadata?.role !== 'manager') throw new Error('MANAGER_REQUIRED');
    return Object.fromEntries(providers.map(provider => [provider, data.user.identities?.some(identity => identity.provider === provider) === true]));
  },
  async finishSocial(url) {
    const callback = new URL(url);
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(pendingKey)); } catch { /* Reject incomplete transactions. */ }
    window.history.replaceState(null, '', callback.pathname);
    try {
      if (callback.searchParams.has('error') || !callback.searchParams.get('code') || !providers.includes(pending?.provider) || !Number.isFinite(pending?.startedAt) || Date.now() - pending.startedAt > 5 * 60000 || pending.startedAt > Date.now()) throw new Error('SOCIAL_FAILED');
      const result = await teamOAuthSupabase.auth.exchangeCodeForSession(callback.searchParams.get('code'));
      if (result.error || !result.data.session) throw new Error('SOCIAL_FAILED');
      const { data, error } = await teamOAuthSupabase.auth.getUser();
      if (error || !data.user?.email_confirmed_at || data.user.app_metadata?.role !== 'manager' || !data.user.identities?.some(identity => identity.provider === pending.provider) || pending.linking && data.user.id !== pending.managerId) {
        // The callback must never promote a customer or replace another manager.
        await teamOAuthSupabase.auth.signOut({ scope: 'local' });
        throw new Error('MANAGER_REQUIRED');
      }
      if (pending.linking) {
        const existing = await supabase.auth.getUser();
        if (existing.error || existing.data.user?.id !== pending.managerId || existing.data.user?.app_metadata?.role !== 'manager') throw new Error('MANAGER_REQUIRED');
      }
      const accepted = await supabase.auth.setSession(result.data.session);
      if (accepted.error) throw new Error('SOCIAL_FAILED');
      return pending.linking ? '/dashboard/settings?connected=1' : '/dashboard';
    } catch (failure) {
      failure.linking = pending?.linking === true;
      throw failure;
    } finally { await clearTemporarySession(); }
  },
};
