import { supabase } from '../lib/supabase';
import { functionFetch } from '../lib/functionFetch';
import { appConfig } from '../lib/runtimeConfig';
async function request(action, data = {}, token) {
  if (!token) {
    const { data: auth, error } = await supabase.auth.getSession();
    if (error || !auth.session) throw new Error('AUTH_REQUIRED');
    token = auth.session.access_token;
  }
  const response = await functionFetch(`${appConfig.supabaseUrl}/functions/v1/account-tools`, {
    method: 'POST', headers: { apikey: appConfig.supabasePublishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'UNAVAILABLE');
  return result;
}
export const accountToolsService = {
  status: token => request('status', {}, token),
  sessions: (cursor, token) => request('sessions', cursor ? { cursor } : {}, token),
  revokeSession: (targetId, token) => request('revoke-session', { targetId }, token),
  activity: (view, cursor, token) => request('activity', { view, ...(cursor ? { cursor } : {}) }, token),
};
