import supabase from '../lib/supabase';
import { logErrorDev } from '../utils/security';

// Convert customer from database to frontend format
const toFrontend = (customer) => {
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.name,
    nameAr: customer.name_ar,
    countryCode: customer.country_code,
    phone: customer.phone,
    email: customer.email,
    notes: customer.notes,
    tags: customer.tags || [],
    preferredBarberId: customer.preferred_barber_id,
    preferredBranchId: customer.preferred_branch_id,
    status: customer.status,
    totalBookings: customer.total_bookings || 0,
    lastBookingDate: customer.last_booking_date,
    createdByType: customer.created_by_type,
    createdByUserId: customer.created_by_user_id,
    createdAt: customer.created_at,
    updatedAt: customer.updated_at,
    // Include joined barber data if present
    preferredBarber: customer.preferred_barber ? {
      id: customer.preferred_barber.id,
      name: customer.preferred_barber.name,
    } : null,
  };
};

// Convert customer from frontend to database format
const toDatabase = (data) => {
  const result = {};
  if (data.name !== undefined) result.name = data.name;
  if (data.nameAr !== undefined) result.name_ar = data.nameAr;
  if (data.countryCode !== undefined) result.country_code = data.countryCode;
  if (data.phone !== undefined) result.phone = data.phone;
  if (data.email !== undefined) result.email = data.email || null;
  if (data.notes !== undefined) result.notes = data.notes || null;
  if (data.tags !== undefined) result.tags = data.tags || [];
  if (data.preferredBarberId !== undefined) result.preferred_barber_id = data.preferredBarberId || null;
  if (data.preferredBranchId !== undefined) result.preferred_branch_id = data.preferredBranchId || null;
  if (data.status !== undefined) result.status = data.status;
  if (data.createdByType !== undefined) result.created_by_type = data.createdByType;
  if (data.createdByUserId !== undefined) result.created_by_user_id = data.createdByUserId;
  return result;
};

export const customersService = {
  /**
   * Search for a customer by exact phone number match
   * @param {string} countryCode - Phone country code (e.g., '+965')
   * @param {string} phone - Phone number
   * @returns {object|null} Customer record or null if not found
   */
  searchByPhone: async (countryCode, phone) => {
    try {
      const cleanPhone = phone.replace(/\s/g, '');

      const { data, error } = await supabase
        .from('customers')
        .select(`
          *,
          preferred_barber:barbers!preferred_barber_id(id, name)
        `)
        .eq('country_code', countryCode)
        .eq('phone', cleanPhone)
        .eq('status', 'active')
        .single();

      // PGRST116 means no rows found - not an error
      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data ? toFrontend(data) : null;
    } catch (error) {
      logErrorDev('Error searching customer by phone:', error);
      throw error;
    }
  },

  /**
   * Find existing customer or create new one
   * Uses atomic operation with race condition handling
   * @param {object} params
   * @param {string} params.countryCode - Phone country code
   * @param {string} params.phone - Phone number
   * @param {string} params.name - Customer name
   * @param {string} params.createdByType - Who created: 'manager', 'barber', 'agent', etc.
   * @param {string} params.createdByUserId - User ID of creator
   * @returns {object} Customer record
   */
  findOrCreate: async ({ countryCode, phone, name, createdByType, createdByUserId }) => {
    try {
      const cleanPhone = phone.replace(/\s/g, '');

      // Try to find existing customer
      const { data: existing, error: findError } = await supabase
        .from('customers')
        .select('*')
        .eq('country_code', countryCode)
        .eq('phone', cleanPhone)
        .single();

      if (existing && !findError) {
        return toFrontend(existing);
      }

      // Customer not found, create new one
      const { data: created, error: createError } = await supabase
        .from('customers')
        .insert([{
          name,
          country_code: countryCode,
          phone: cleanPhone,
          status: 'active',
          created_by_type: createdByType,
          created_by_user_id: createdByUserId,
        }])
        .select()
        .single();

      if (createError) {
        // Handle race condition - another request might have created the customer
        if (createError.code === '23505') {
          const { data: retry } = await supabase
            .from('customers')
            .select('*')
            .eq('country_code', countryCode)
            .eq('phone', cleanPhone)
            .single();
          if (retry) return toFrontend(retry);
        }
        throw createError;
      }

      return toFrontend(created);
    } catch (error) {
      logErrorDev('Error in findOrCreate customer:', error);
      throw error;
    }
  },

  /**
   * Get customer booking summary for display in booking form
   * @param {string} customerId - Customer UUID
   * @returns {object} Summary with totalBookings, lastBookingDate, preferredBarber, notes, tags
   */
  getBookingSummary: async (customerId) => {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select(`
          id,
          total_bookings,
          last_booking_date,
          notes,
          tags,
          preferred_barber_id,
          preferred_branch_id,
          created_at,
          preferred_barber:barbers!preferred_barber_id(id, name)
        `)
        .eq('id', customerId)
        .single();

      if (error) throw error;

      return {
        totalBookings: data.total_bookings || 0,
        lastBookingDate: data.last_booking_date,
        preferredBarber: data.preferred_barber?.name || null,
        preferredBarberId: data.preferred_barber_id,
        preferredBranchId: data.preferred_branch_id,
        notes: data.notes,
        tags: data.tags || [],
        memberSince: data.created_at,
      };
    } catch (error) {
      logErrorDev('Error getting customer booking summary:', error);
      throw error;
    }
  },

  /**
   * Get customer by ID
   * @param {string} customerId - Customer UUID
   * @returns {object|null} Customer record or null
   */
  getById: async (customerId) => {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select(`
          *,
          preferred_barber:barbers!preferred_barber_id(id, name)
        `)
        .eq('id', customerId)
        .single();

      if (error) throw error;
      return toFrontend(data);
    } catch (error) {
      logErrorDev('Error getting customer by ID:', error);
      throw error;
    }
  },
};

export default customersService;
