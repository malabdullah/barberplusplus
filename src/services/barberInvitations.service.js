import { supabase } from '../lib/supabase';
import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';
export async function invitationRequest(action, data = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await functionFetch(appConfig.supabaseUrl + '/functions/v1/invite-barber', {
    method: 'POST', headers: { apikey: appConfig.supabasePublishableKey, 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.access_token } : {}) },
    body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'UNAVAILABLE');
  return result;
}
export const barberInvitationsService = {
  check: (branchId, email) => invitationRequest('check', { branchId, email }),
  send: (branchId, email, confirmCustomer = false) => invitationRequest('send', { branchId, email, confirmCustomer }),
  list: (branchId, offset = 0) => invitationRequest('list', { branchId, offset }),
  resend: id => invitationRequest('resend', { id }),
  cancel: id => invitationRequest('cancel', { id }),
  resolve: invite => invitationRequest('resolve', invite),
  accept: (invite, form) => invitationRequest('accept', { ...invite, ...form }),
};
