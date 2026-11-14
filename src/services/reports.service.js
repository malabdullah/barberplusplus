import { supabase } from '../lib/supabase';
import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';

export async function reportRpc(action, data = {}) {
  const result = await supabase.rpc('staff_reports', { p_action: action, p_data: data });
  if (result.error) throw new Error(result.error.code?.startsWith('22') ? 'REPORT_INVALID_FILTER' : result.error.message);
  return result.data;
}

export const reportsService = {
  options: () => reportRpc('options'),
  get: id => reportRpc('get', { id }),
  rows: (id, data) => reportRpc('rows', { id, ...data }),
  groups: (id, data) => reportRpc('groups', { id, ...data }),
  async generate(filters) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('REPORT_FORBIDDEN');
    const response = await functionFetch(`${appConfig.supabaseUrl}/functions/v1/staff-reports`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: appConfig.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(filters), signal: AbortSignal.timeout(25000),
    });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || 'REPORT_FAILED');
    return job;
  },
};
