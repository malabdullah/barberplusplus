import { supabase } from '../lib/supabase';
import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';
async function request(action, data = {}) {
  const { data: auth, error } = await supabase.auth.getSession();
  if (error || !auth.session) throw new Error('AUTH_REQUIRED');
  const response = await functionFetch(
    `${appConfig.supabaseUrl}/functions/v1/admin-push`,
    {
      method: 'POST',
      headers: {
        apikey: appConfig.supabasePublishableKey,
        Authorization: `Bearer ${auth.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...data }),
      signal: AbortSignal.timeout(30000),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'UNAVAILABLE');
  return result;
}
export const adminPushService = {
  options: (page = 1, query = '') => request('options', { page, query }),
  users: (filters, page = 1) => request('users', { filters, page }),
  preview: (data) => request('preview', data),
  send: (campaignId) => request('send', { campaignId, confirmed: true }),
  history: (page = 1) => request('history', { page }),
  details: (campaignId) => request('details', { campaignId }),
  recipients: (campaignId, page = 1) =>
    request('recipients', { campaignId, page }),
};
