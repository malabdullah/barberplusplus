import { supabase } from '../lib/supabase';

import { mapPackage } from '../utils/servicePackages';

export const packagesService = {
  async list(shop, page = 0, search = '') {
    const { data, error } = await supabase.rpc('manage_service_packages', { p_action: 'list', p_shop: shop, p_data: { page, search } });
    if (error) throw error;
    return data;
  },
  async manage(action, shop, data) {
    const result = await supabase.rpc('manage_service_packages', { p_action: action, p_shop: shop, p_data: data });
    if (result.error) throw result.error;
    return result.data;
  },
  async terms(booking) {
    const { data, error } = await supabase.rpc('staff_package_terms', { p_booking: booking });
    if (error) throw error;
    return data ? mapPackage(data) : null;
  },
  async staff(shop, barber, date) {
    const { data, error } = await supabase.rpc('staff_package_catalog', { p_shop: shop, p_barber: barber, p_date: date || null });
    if (error) throw error;
    return data.map(mapPackage);
  },
};
