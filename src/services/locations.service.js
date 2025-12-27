import { supabase } from '../lib/supabase';

export const locationsService = {
  /**
   * Fetch all governorates with their areas
   */
  async getGovernoratesWithAreas() {
    const { data, error } = await supabase
      .from('governorates')
      .select(`
        id,
        name_en,
        name_ar,
        code,
        areas (
          id,
          name_en,
          name_ar
        )
      `)
      .order('id');

    if (error) throw error;
    return data || [];
  },

  /**
   * Fetch all governorates (without areas)
   */
  async getGovernorates() {
    const { data, error } = await supabase
      .from('governorates')
      .select('id, name_en, name_ar, code')
      .order('id');

    if (error) throw error;
    return data || [];
  },

  /**
   * Fetch areas by governorate ID
   */
  async getAreasByGovernorate(governorateId) {
    const { data, error } = await supabase
      .from('areas')
      .select('id, name_en, name_ar')
      .eq('governorate_id', governorateId)
      .order('name_en');

    if (error) throw error;
    return data || [];
  },
};
