import { supabase } from '../lib/supabase';

export const barberConfirmationService = {
  async read(id) {
    const { data, error } = await supabase.from('barbers').select('auto_confirm_bookings').eq('id', id).single();
    if (error) throw error;
    return data.auto_confirm_bookings;
  },
  async save(id, enabled) {
    const { data, error } = await supabase.rpc('set_barber_auto_confirm', { p_barber_id: id, p_enabled: enabled });
    if (error) throw error;
    return data.auto_confirm_bookings;
  },
};
