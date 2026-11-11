import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';
import { customerToken } from './customerAuth.service';

async function request(action, data) {
  const token = action !== 'view' && !data.receipt ? await customerToken() : '';
  const response = await functionFetch(`${appConfig.supabaseUrl}/functions/v1/booking-share`, {
    method: 'POST', headers: { apikey: appConfig.supabasePublishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(['LINK_UNAVAILABLE', 'AUTH_REQUIRED'].includes(result.error) ? result.error : 'UNAVAILABLE');
  return result;
}
export const bookingShareService = {
  create: (bookingId, receipt) => request('create', { bookingId, ...(receipt ? { receipt } : {}) }),
  revoke: (bookingId, receipt) => request('revoke', { bookingId, ...(receipt ? { receipt } : {}) }),
  view: async token => (await request('view', { token })).booking,
};
