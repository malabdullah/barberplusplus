import { customerToken } from './customerAuth.service';
import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';
export async function deletionRequest(action, data = {}) {
  const token = ['status', 'retry'].includes(action) ? '' : await customerToken();
  if (!['status', 'retry'].includes(action) && !token) throw new Error('AUTH_REQUIRED');
  const response = await functionFetch(`${appConfig.supabaseUrl}/functions/v1/customer-account-deletion`, {
    method: 'POST', headers: { apikey: appConfig.supabasePublishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(25000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'UNAVAILABLE');
  return result;
}
