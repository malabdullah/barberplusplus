import { supabase } from '../lib/supabase';
export const availabilityService = {
  async call(action, data = {}) {
    const { data: result, error } = await supabase.rpc('barber_availability', { p_action: action, p_data: data });
    if (error) throw error;
    return result;
  },
};
