import { supabase } from '../lib/supabase';

export const bookingPolicyService = {
  async paymentMethods(branchId, method = null) {
    const { data, error } = await supabase.rpc('manage_test_shop_payment_methods', {
      p_shop: branchId, p_method: method,
    });
    if (error) throw error;
    return data;
  },

  async manage(branchId, changes = null) {
    const { data, error } = await supabase.rpc('manage_booking_policy', {
      p_branch: branchId, p_changes: changes,
    });
    if (error) throw error;
    return data;
  },
};
