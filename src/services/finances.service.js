import { supabase } from '../lib/supabase';

export async function financeRpc(action, data = {}) {
  const result = await supabase.rpc('manager_finances', { p_action: action, p_data: data });
  if (result.error) throw new Error(result.error.code?.startsWith('22') ? 'FINANCE_INVALID' : result.error.message);
  return result.data;
}
export const financesService = {
  options: () => financeRpc('options'),
  generate: filters => financeRpc('generate', filters),
  get: id => financeRpc('get', { id }),
  rows: (id, after = 0) => financeRpc('rows', { id, after, limit: 500 }),
};
