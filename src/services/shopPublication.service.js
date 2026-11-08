import { supabase } from '../lib/supabase';
export const shopPublicationService = {
  async manage(branchId, action = 'get', expected = null) {
    const { data, error } = await supabase.rpc('manage_shop_publication', { p_branch: branchId, p_action: action, p_expected: expected });
    if (error) throw error;
    return data;
  },
};
