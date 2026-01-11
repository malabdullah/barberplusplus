import { supabase } from '../lib/supabase';
import { getToday, getWeekStart, getWeekEnd } from '../utils/dateHelpers';
import { validateBooking } from '../utils/schemaValidation';

// Convert snake_case DB columns to camelCase for frontend
// Customer data comes from joined customers table
const toFrontend = (booking) => {
  if (!booking) return null;
  const customer = booking.customer || {};
  return {
    id: booking.id,
    branchId: booking.branch_id,
    barberId: booking.barber_id,
    serviceIds: booking.service_ids || [],
    customerId: booking.customer_id,
    // Customer data from joined customers table
    customer: customer.id ? {
      id: customer.id,
      name: customer.name,
      countryCode: customer.country_code,
      phone: customer.phone,
    } : null,
    // Backward compatibility - flatten customer fields
    customerName: customer.name || null,
    customerCountryCode: customer.country_code || null,
    customerPhone: customer.phone || null,
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
// Customer fields removed - use customer_id only
const toDatabase = (data) => {
  const result = {};
  if (data.branchId !== undefined) result.branch_id = data.branchId;
  if (data.barberId !== undefined) result.barber_id = data.barberId;
  if (data.serviceIds !== undefined) result.service_ids = data.serviceIds;
  if (data.customerId !== undefined) result.customer_id = data.customerId;
  // Customer name/phone/countryCode removed - stored in customers table only
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
    // Join customers table to get customer details
    let query = supabase.from('bookings').select('*, customer:customers(id, name, country_code, phone)');
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
      .select('*, customer:customers(id, name, country_code, phone)')
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
    // SECURITY: Validate booking data before database operation
    const validation = validateBooking(bookingData);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

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
    // SECURITY: Validate booking data (partial validation for updates)
    // Only validate fields that are present in the update
    const fieldsToValidate = {};
    if (bookingData.branchId) fieldsToValidate.branchId = bookingData.branchId;
    if (bookingData.barberId) fieldsToValidate.barberId = bookingData.barberId;
    if (bookingData.date) fieldsToValidate.date = bookingData.date;
    if (bookingData.time) fieldsToValidate.time = bookingData.time;
    if (bookingData.duration) fieldsToValidate.duration = bookingData.duration;
    if (bookingData.price !== undefined) fieldsToValidate.price = bookingData.price;
    if (bookingData.status) fieldsToValidate.status = bookingData.status;

    // Validate with a schema that has no required fields (partial update)
    const partialSchema = {
      required: [],
      types: {
        branchId: 'uuid',
        barberId: 'uuid',
        date: 'date',
        time: 'time',
        duration: 'number',
        price: 'number',
        status: 'string',
      },
      constraints: {
        duration: { min: 5, max: 480 },
        price: { min: 0, max: 10000 },
        status: { enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'] },
      },
    };

    const { validateSchema } = await import('../utils/schemaValidation');
    const validation = validateSchema(fieldsToValidate, partialSchema);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

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
      .select('*, customer:customers(id, name, country_code, phone)')
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
