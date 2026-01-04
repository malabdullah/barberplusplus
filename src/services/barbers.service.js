import { supabase } from '../lib/supabase';
import { logErrorDev } from '../utils/security';

// SECURITY: Timeout for Edge Function calls (prevents hanging requests)
const EDGE_FUNCTION_TIMEOUT_MS = 30000; // 30 seconds

// Convert snake_case DB columns to camelCase for frontend
const toFrontend = (barber) => {
  if (!barber) return null;
  return {
    id: barber.id,
    userId: barber.user_id,
    branchId: barber.branch_id,
    name: barber.name,
    nameAr: barber.name_ar,
    email: barber.email,
    countryCode: barber.country_code,
    phone: barber.phone,
    status: barber.status,
    isActive: barber.status === 'active',
    profilePicture: barber.avatar_url,
    avatarUrl: barber.avatar_url,
    services: barber.service_ids || [],
    availability: barber.availability,
    timeOffs: barber.time_offs || [],
    vacations: barber.vacations || [],
    maxBookingDays: barber.max_booking_days ?? 30,
    createdAt: barber.created_at,
    updatedAt: barber.updated_at,
    inviteStatus: barber.invite_status,
    inviteSentAt: barber.invite_sent_at,
    inviteAcceptedAt: barber.invite_accepted_at,
  };
};

// Convert camelCase frontend data to snake_case for DB
const toDatabase = (data) => {
  const result = {};
  if (data.userId !== undefined) result.user_id = data.userId;
  if (data.branchId !== undefined) result.branch_id = data.branchId;
  if (data.name !== undefined) result.name = data.name;
  if (data.nameAr !== undefined) result.name_ar = data.nameAr;
  if (data.email !== undefined) result.email = data.email;
  if (data.countryCode !== undefined) result.country_code = data.countryCode;
  if (data.phone !== undefined) result.phone = data.phone;
  // Handle both status and isActive (isActive takes precedence)
  if (data.isActive !== undefined) {
    result.status = data.isActive ? 'active' : 'inactive';
  } else if (data.status !== undefined) {
    result.status = data.status;
  }
  // Handle both profilePicture and avatarUrl (profilePicture takes precedence)
  if (data.profilePicture !== undefined) {
    result.avatar_url = data.profilePicture;
  } else if (data.avatarUrl !== undefined) {
    result.avatar_url = data.avatarUrl;
  }
  if (data.services !== undefined) result.service_ids = data.services;
  if (data.availability !== undefined) result.availability = data.availability;
  if (data.timeOffs !== undefined) result.time_offs = data.timeOffs;
  if (data.vacations !== undefined) result.vacations = data.vacations;
  if (data.maxBookingDays !== undefined) result.max_booking_days = data.maxBookingDays;
  return result;
};

export const barbersService = {
  /**
   * Get all barbers, optionally filtered by branch
   * @param {string} branchId - Optional branch ID to filter
   * @returns {Promise<Array>}
   */
  getAll: async (branchId = null) => {
    let query = supabase.from('barbers').select('*');
    if (branchId) query = query.eq('branch_id', branchId);
    const { data, error } = await query.order('name');
    if (error) throw error;
    return (data || []).map(toFrontend);
  },

  /**
   * Get a single barber by ID
   * @param {string} id
   * @returns {Promise<object | null>}
   */
  getById: async (id) => {
    const { data, error } = await supabase
      .from('barbers')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Get barber by user ID (for logged-in barber)
   * @param {string} userId
   * @returns {Promise<object | null>}
   */
  getByUserId: async (userId) => {
    const { data, error } = await supabase
      .from('barbers')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    return toFrontend(data);
  },

  /**
   * Create a new barber
   * @param {object} barberData
   * @returns {Promise<object | null>}
   */
  create: async (barberData) => {
    const { data, error } = await supabase
      .from('barbers')
      .insert([toDatabase(barberData)])
      .select()
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Update an existing barber
   * @param {string} id
   * @param {object} barberData
   * @returns {Promise<object | null>}
   */
  update: async (id, barberData) => {
    const { data, error } = await supabase
      .from('barbers')
      .update(toDatabase(barberData))
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Delete a barber
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  delete: async (id) => {
    const { error } = await supabase
      .from('barbers')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  },

  /**
   * Update barber availability schedule
   * @param {string} id
   * @param {object} availability
   * @returns {Promise<object | null>}
   */
  updateAvailability: async (id, availability) => {
    const { data, error } = await supabase
      .from('barbers')
      .update({ availability })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Send invite email to barber via Edge Function
   * SECURITY: Implements timeout and sanitized error messages
   * @param {string} barberId
   * @param {string} email
   * @param {string} name
   * @param {string} branchId
   * @param {boolean} isResend - If true, deletes existing user and re-invites
   * @returns {Promise<{success: boolean, userId?: string, error?: string}>}
   */
  sendInvite: async (barberId, email, name, branchId, isResend = false) => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    // SECURITY: AbortController for request timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EDGE_FUNCTION_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-barber`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ barberId, email, name, branchId, isResend }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      const result = await response.json();

      if (!response.ok) {
        // SECURITY: Log raw error for debugging, throw sanitized message
        logErrorDev('Edge Function error:', result.error);
        // Map specific known errors to user-friendly messages
        if (response.status === 401) {
          throw new Error('Session expired. Please log in again.');
        } else if (response.status === 403) {
          throw new Error('You do not have permission to perform this action.');
        } else if (response.status === 429) {
          throw new Error('Too many requests. Please try again later.');
        }
        // Generic error for unknown cases (don't expose raw API errors)
        throw new Error('Failed to send invite. Please try again.');
      }

      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle timeout specifically
      if (error.name === 'AbortError') {
        throw new Error('Request timed out. Please try again.');
      }

      // Re-throw known errors (already sanitized above)
      if (error.message.includes('Please')) {
        throw error;
      }

      // SECURITY: Sanitize unexpected errors
      logErrorDev('Unexpected Edge Function error:', error);
      throw new Error('Failed to send invite. Please try again.');
    }
  },

  /**
   * Resend invite to an existing barber
   * @param {string} barberId
   * @returns {Promise<{success: boolean}>}
   */
  resendInvite: async (barberId) => {
    const { data: barber, error } = await supabase
      .from('barbers')
      .select('email, name, branch_id')
      .eq('id', barberId)
      .single();

    if (error) throw error;
    if (!barber) throw new Error('Barber not found');

    // Pass isResend=true to delete existing user and send fresh invite
    return barbersService.sendInvite(
      barberId,
      barber.email,
      barber.name,
      barber.branch_id,
      true
    );
  },
};

export default barbersService;
