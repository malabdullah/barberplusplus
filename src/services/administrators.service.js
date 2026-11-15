import { supabase } from '../lib/supabase';
async function request(action, data = {}) {
  const result = await supabase.rpc('manage_administrators', { p_action: action, p_data: data });
  if (result.error) throw new Error(result.error.message || 'UNAVAILABLE');
  return result.data;
}
export const administratorsService = {
  list: page => request('list', { page }),
  add: email => request('add', { email }),
  setEnabled: (userId, enabled) => request(enabled ? 'enable' : 'disable', { userId }),
};
