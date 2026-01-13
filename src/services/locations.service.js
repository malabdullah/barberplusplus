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
};
