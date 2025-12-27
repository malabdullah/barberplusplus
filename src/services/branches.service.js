import { supabase } from '../lib/supabase';

// Convert snake_case DB columns to camelCase for frontend
const toFrontend = (branch) => {
  if (!branch) return null;
  return {
    id: branch.id,
    managerId: branch.manager_id,
    name: branch.name,
    nameAr: branch.name_ar,
    address: branch.address,
    city: branch.city,
    country: branch.country,
    governorateId: branch.governorate_id,
    areaId: branch.area_id,
    governorateName: branch.governorates?.name_en || '',
    governorateNameAr: branch.governorates?.name_ar || '',
    areaName: branch.areas?.name_en || '',
    areaNameAr: branch.areas?.name_ar || '',
    locationUrl: branch.location_url,
    countryCode: branch.country_code,
    phone: branch.phone,
    email: branch.email,
    numberOfBarbers: branch.number_of_barbers,
    status: branch.status,
    openingHours: branch.working_hours,
    imageUrl: branch.image_url,
    createdAt: branch.created_at,
    updatedAt: branch.updated_at,
  };
};

// Convert camelCase frontend data to snake_case for DB
const toDatabase = (data) => {
  const result = {};
  if (data.managerId !== undefined) result.manager_id = data.managerId;
  if (data.name !== undefined) result.name = data.name;
  if (data.nameAr !== undefined) result.name_ar = data.nameAr;
  if (data.address !== undefined) result.address = data.address;
  if (data.city !== undefined) result.city = data.city;
  if (data.country !== undefined) result.country = data.country;
  if (data.governorateId !== undefined) result.governorate_id = data.governorateId || null;
  if (data.areaId !== undefined) result.area_id = data.areaId || null;
  if (data.locationUrl !== undefined) result.location_url = data.locationUrl;
  if (data.countryCode !== undefined) result.country_code = data.countryCode;
  if (data.phone !== undefined) result.phone = data.phone;
  if (data.email !== undefined) result.email = data.email;
  if (data.numberOfBarbers !== undefined) result.number_of_barbers = data.numberOfBarbers ? parseInt(data.numberOfBarbers, 10) : null;
  if (data.status !== undefined) result.status = data.status;
  if (data.openingHours !== undefined) result.working_hours = data.openingHours;
  if (data.imageUrl !== undefined) result.image_url = data.imageUrl;
  return result;
};

export const branchesService = {
  /**
   * Get all branches for the current manager
   * @returns {Promise<Array>}
   */
  getAll: async () => {
    const { data, error } = await supabase
      .from('branches')
      .select(`
        *,
        governorates:governorate_id (name_en, name_ar),
        areas:area_id (name_en, name_ar)
      `)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(toFrontend);
  },

  /**
   * Get a single branch by ID
   * @param {string} id
   * @returns {Promise<object | null>}
   */
  getById: async (id) => {
    const { data, error } = await supabase
      .from('branches')
      .select(`
        *,
        governorates:governorate_id (name_en, name_ar),
        areas:area_id (name_en, name_ar)
      `)
      .eq('id', id)
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Create a new branch
   * @param {object} branchData
   * @returns {Promise<object | null>}
   */
  create: async (branchData) => {
    const { data, error } = await supabase
      .from('branches')
      .insert([toDatabase(branchData)])
      .select()
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Update an existing branch
   * @param {string} id
   * @param {object} branchData
   * @returns {Promise<object | null>}
   */
  update: async (id, branchData) => {
    const { data, error } = await supabase
      .from('branches')
      .update(toDatabase(branchData))
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Delete a branch
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  delete: async (id) => {
    const { error } = await supabase
      .from('branches')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  },
};

export default branchesService;
