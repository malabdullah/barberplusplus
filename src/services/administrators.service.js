import { supabase } from '../lib/supabase';
import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';
async function rpc(action, data = {}) {
  const result = await supabase.rpc('manage_administrators', { p_action: action, p_data: data });
  if (result.error) throw Error(result.error.message || 'UNAVAILABLE');
  return result.data;
}
async function request(action, data = {}, publicRequest = false, endpoint = 'admin-accounts') {
  const auth = publicRequest ? null : await supabase.auth.getSession();
  if (!publicRequest && (auth.error || !auth.data.session)) throw Error('AUTH_REQUIRED');
  const response = await functionFetch(appConfig.supabaseUrl + '/functions/v1/' + endpoint, {
    method: 'POST',
    headers: { apikey: appConfig.supabasePublishableKey, 'Content-Type': 'application/json', ...(!publicRequest ? { Authorization: 'Bearer ' + auth.data.session.access_token } : {}) },
    body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'UNAVAILABLE');
  return result;
}
export const administratorsService = {
  list: page => rpc('list', { page }),
  invite: (name, email) => request('invite', { name, email }),
  resend: id => request('resend', { id }),
  cancel: id => rpc('cancel', { id }),
  edit: data => rpc('edit', data),
  setEnabled: (userId, enabled) => rpc(enabled ? 'enable' : 'disable', { userId }),
  remove: userId => request('delete', { userId }),
  resolve: invite => request('resolve', invite, true),
  accept: (invite, password) => request('accept', { ...invite, password }, true),
  resetPassword: (userId, password) => request('reset', { userId, password }, false, 'admin-password-reset'),
};
