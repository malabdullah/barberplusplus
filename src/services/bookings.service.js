import { supabase } from '../lib/supabase';
import { getToday, getWeekStart, getWeekEnd } from '../utils/dateHelpers';

// Convert snake_case DB columns to camelCase for frontend
const toFrontend = (booking) => {
  if (!booking) return null;
  return {
    id: booking.id,
    branchId: booking.branch_id,
    barberId: booking.barber_id,
    serviceIds: booking.service_ids || [],
    customerName: booking.customer_name,
    customerCountryCode: booking.customer_country_code,
    customerPhone: booking.customer_phone,
    date: booking.date,
    time: booking.time,
    duration: booking.duration,
    price: parseFloat(booking.price),
    status: booking.status,
    notes: booking.notes,
    createdAt: booking.created_at,
    updatedAt: booking.updated_at,
    addedByType: booking.added_by_type,
    addedByUserId: booking.added_by_user_id,
    modifiedByType: booking.modified_by_type,
    modifiedByUserId: booking.modified_by_user_id,
  };
};

// Convert camelCase frontend data to snake_case for DB
const toDatabase = (data) => {
  const result = {};
  if (data.branchId !== undefined) result.branch_id = data.branchId;
  if (data.barberId !== undefined) result.barber_id = data.barberId;
  if (data.serviceIds !== undefined) result.service_ids = data.serviceIds;
  if (data.customerName !== undefined) result.customer_name = data.customerName;
  if (data.customerCountryCode !== undefined) result.customer_country_code = data.customerCountryCode;
  if (data.customerPhone !== undefined) result.customer_phone = data.customerPhone;
  if (data.date !== undefined) result.date = data.date;
  if (data.time !== undefined) result.time = data.time;
  if (data.duration !== undefined) result.duration = data.duration;
  if (data.price !== undefined) result.price = data.price;
  if (data.status !== undefined) result.status = data.status;
  if (data.notes !== undefined) result.notes = data.notes;
  if (data.addedByType !== undefined) result.added_by_type = data.addedByType;
  if (data.addedByUserId !== undefined) result.added_by_user_id = data.addedByUserId;
  if (data.modifiedByType !== undefined) result.modified_by_type = data.modifiedByType;
  if (data.modifiedByUserId !== undefined) result.modified_by_user_id = data.modifiedByUserId;
  return result;
};

export const bookingsService = {
  /**
   * Get all bookings, optionally filtered
   * @param {object} filters - { branchId, barberId, date, status }
   * @returns {Promise<Array>}
   */
  getAll: async (filters = {}) => {
    let query = supabase.from('bookings').select('*');
    if (filters.branchId) query = query.eq('branch_id', filters.branchId);
    if (filters.barberId) query = query.eq('barber_id', filters.barberId);
    if (filters.date) query = query.eq('date', filters.date);
    if (filters.status) query = query.eq('status', filters.status);
    const { data, error } = await query.order('date').order('time');
    if (error) throw error;
    return (data || []).map(toFrontend);
  },

  /**
   * Get a single booking by ID
   * @param {string} id
   * @returns {Promise<object | null>}
   */
  getById: async (id) => {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Create a new booking
   * @param {object} bookingData
   * @returns {Promise<object | null>}
   */
  create: async (bookingData) => {
    const { data, error } = await supabase
      .from('bookings')
      .insert([toDatabase(bookingData)])
      .select()
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Update an existing booking
   * @param {string} id
   * @param {object} bookingData
   * @returns {Promise<object | null>}
   */
  update: async (id, bookingData) => {
    const { data, error } = await supabase
      .from('bookings')
      .update(toDatabase(bookingData))
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Cancel a booking
   * @param {string} id
   * @param {object} options - Optional params { modifiedByType, modifiedByUserId }
   * @returns {Promise<object | null>}
   */
  cancel: async (id, options = {}) => {
    const updateData = { status: 'cancelled' };
    if (options.modifiedByType) updateData.modified_by_type = options.modifiedByType;
    if (options.modifiedByUserId) updateData.modified_by_user_id = options.modifiedByUserId;

    const { data, error } = await supabase
      .from('bookings')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Get bookings for a specific date range
   * @param {string} startDate
   * @param {string} endDate
   * @param {string} branchId
   * @returns {Promise<Array>}
   */
  getByDateRange: async (startDate, endDate, branchId = null) => {
    let query = supabase
      .from('bookings')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate);
    if (branchId) query = query.eq('branch_id', branchId);
    const { data, error } = await query.order('date').order('time');
    if (error) throw error;
    return (data || []).map(toFrontend);
  },

  /**
   * Get dashboard metrics
   * @param {string} branchId
   * @returns {Promise<object>}
   */
  getMetrics: async (branchId = null) => {
    const today = getToday();
    const weekStart = getWeekStart();
    const weekEnd = getWeekEnd();

    // Get today's bookings
    let todayQuery = supabase
      .from('bookings')
      .select('*')
      .eq('date', today);
    if (branchId) todayQuery = todayQuery.eq('branch_id', branchId);
    const { data: todayBookings } = await todayQuery;

    // Get week's bookings for revenue
    let weekQuery = supabase
      .from('bookings')
      .select('*')
      .gte('date', weekStart)
      .lte('date', weekEnd);
    if (branchId) weekQuery = weekQuery.eq('branch_id', branchId);
    const { data: weekBookings } = await weekQuery;

    // Get barber count
    let barberQuery = supabase.from('barbers').select('id', { count: 'exact' });
    if (branchId) barberQuery = barberQuery.eq('branch_id', branchId);
    const { count: totalBarbers } = await barberQuery;

    // Get service count
    let serviceQuery = supabase.from('services').select('id', { count: 'exact' });
    if (branchId) serviceQuery = serviceQuery.eq('branch_id', branchId);
    const { count: totalServices } = await serviceQuery;

    const todayData = todayBookings || [];
    const weekData = weekBookings || [];

    return {
      todayTotal: todayData.length,
      todayCompleted: todayData.filter(b => b.status === 'completed').length,
      todayUpcoming: todayData.filter(b => b.status === 'confirmed' || b.status === 'pending').length,
      weekRevenue: weekData
        .filter(b => b.status === 'completed')
        .reduce((sum, b) => sum + parseFloat(b.price || 0), 0),
      weekBookings: weekData.length,
      totalBarbers: totalBarbers || 0,
      totalServices: totalServices || 0,
    };
  },

  /**
   * Get barber-specific metrics
   * @param {string} barberId
   * @returns {Promise<object>}
   */
  getBarberMetrics: async (barberId) => {
    const today = getToday();
    const weekStart = getWeekStart();
    const weekEnd = getWeekEnd();

    // Get today's bookings for this barber
    const { data: todayBookings } = await supabase
      .from('bookings')
      .select('*')
      .eq('barber_id', barberId)
      .eq('date', today);

    // Get week's bookings for this barber
    const { data: weekBookings } = await supabase
      .from('bookings')
      .select('*')
      .eq('barber_id', barberId)
      .gte('date', weekStart)
      .lte('date', weekEnd);

    const todayData = todayBookings || [];
    const weekData = weekBookings || [];
    const completedThisWeek = weekData.filter(b => b.status === 'completed').length;

    return {
      todayTotal: todayData.length,
      todayCompleted: todayData.filter(b => b.status === 'completed').length,
      todayUpcoming: todayData.filter(b => b.status === 'confirmed' || b.status === 'pending').length,
      weekTotal: weekData.length,
      weekEarnings: weekData
        .filter(b => b.status === 'completed')
        .reduce((sum, b) => sum + parseFloat(b.price || 0), 0),
      completionRate: weekData.length > 0 ? Math.round((completedThisWeek / weekData.length) * 100) : 0,
    };
  },
};

export default bookingsService;
