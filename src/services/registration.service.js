import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';

async function request(action, data) {
  const response = await functionFetch(`${appConfig.supabaseUrl}/functions/v1/customer-auth`, {
    method: 'POST', headers: { apikey: appConfig.supabasePublishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'UNAVAILABLE'), { retryAfter: Number(result.retryAfter) || 0 });
  return result;
}
export const registrationService = {
  signup: data => request('manager-signup', data),
  status: receipt => request('manager-registration-status', { receipt }),
  resend: receipt => request('manager-registration-resend', { receipt }),
};
