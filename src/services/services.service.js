import { supabase } from '../lib/supabase';

// Convert snake_case DB columns to camelCase for frontend
const toFrontend = (service) => {
  if (!service) return null;
  return {
    id: service.id,
    branchId: service.branch_id,
    name: service.name,
    description: service.description,
    duration: service.duration,
    price: parseFloat(service.price),
    status: service.status,
    createdAt: service.created_at,
    updatedAt: service.updated_at,
  };
};

// Convert camelCase frontend data to snake_case for DB
const toDatabase = (data) => {
  const result = {};
  if (data.branchId !== undefined) result.branch_id = data.branchId;
  if (data.name !== undefined) result.name = data.name;
  if (data.description !== undefined) result.description = data.description;
  if (data.duration !== undefined) result.duration = data.duration;
  if (data.price !== undefined) result.price = data.price;
  if (data.status !== undefined) result.status = data.status;
  return result;
};

export const servicesService = {
  /**
   * Get all services, optionally filtered by branch
   * @param {string} branchId - Optional branch ID to filter
   * @returns {Promise<Array>}
   */
  getAll: async (branchId = null) => {
    let query = supabase.from('services').select('*');
    if (branchId) query = query.eq('branch_id', branchId);
    const { data, error } = await query.order('name');
    if (error) throw error;
    return (data || []).map(toFrontend);
  },

  /**
   * Get a single service by ID
   * @param {string} id
   * @returns {Promise<object | null>}
   */
  getById: async (id) => {
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Create a new service
   * @param {object} serviceData
   * @returns {Promise<object | null>}
   */
  create: async (serviceData) => {
    const { data, error } = await supabase
      .from('services')
      .insert([toDatabase(serviceData)])
      .select()
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Update an existing service
   * @param {string} id
   * @param {object} serviceData
   * @returns {Promise<object | null>}
   */
  update: async (id, serviceData) => {
    const { data, error } = await supabase
      .from('services')
      .update(toDatabase(serviceData))
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Delete a service
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  delete: async (id) => {
    const { error } = await supabase
      .from('services')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  },
};

export default servicesService;
