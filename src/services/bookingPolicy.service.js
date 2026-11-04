import { supabase } from '../lib/supabase';

export const bookingPolicyService = {
  async manage(branchId, changes = null) {
    const { data, error } = await supabase.rpc('manage_booking_policy', {
      p_branch: branchId, p_changes: changes,
    });
    if (error) throw error;
    return data;
  },
};
