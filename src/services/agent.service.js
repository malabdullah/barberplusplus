import { supabase } from '../lib/supabase';
import { escapeLikeWildcards, logErrorDev } from '../utils/security';
import { getToday } from '../utils/dateHelpers';

/**
 * Agent Service - Operations for customer support agents
 * Agents can create/edit bookings for any branch and view customer data
 */

// Convert booking to frontend format (customer data comes from joined customer object)
const bookingToFrontend = (booking) => {
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
    time: booking.time?.slice(0, 5), // "12:30:00" -> "12:30"
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

// Convert booking to database format (customer fields removed - use customer_id only)
const bookingToDatabase = (data) => {
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

// Convert barber to frontend format
const barberToFrontend = (barber) => {
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
    avatarUrl: barber.avatar_url,
    services: barber.service_ids || [],
    availability: barber.availability,
    maxBookingDays: barber.max_booking_days ?? 30,
  };
};

// Convert service to frontend format
const serviceToFrontend = (service) => {
  if (!service) return null;
  return {
    id: service.id,
    branchId: service.branch_id,
    name: service.name,
    description: service.description,
    duration: service.duration,
    price: parseFloat(service.price),
    status: service.status,
  };
};

// Convert customer to frontend format
const customerToFrontend = (customer) => {
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.name,
    nameAr: customer.name_ar,
    countryCode: customer.country_code,
    phone: customer.phone,
    email: customer.email,
    notes: customer.staff_details?.notes,
    tags: customer.staff_details?.tags || [],
    preferredBarberId: customer.preferred_barber_id,
    preferredBranchId: customer.preferred_branch_id,
    status: customer.status,
    totalBookings: customer.total_bookings || 0,
    lastBookingDate: customer.last_booking_date,
    createdByType: customer.created_by_type,
    createdByUserId: customer.created_by_user_id,
    createdAt: customer.created_at,
    updatedAt: customer.updated_at,
  };
};

// Convert customer to database format
const customerToDatabase = (data) => {
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

// Convert branch to frontend format
const branchToFrontend = (branch) => {
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
    status: branch.status,
    openingHours: branch.working_hours,
    imageUrl: branch.image_url,
  };
};

export const agentService = {
  // ===========================
  // AGENT METRICS
  // ===========================

  /**
   * Get metrics for agent dashboard
   * @param {string} agentUserId - The agent's user ID
   */
  getAgentMetrics: async (agentUserId) => {
    try {
      const today = getToday();

      // Get bookings created by this agent today
      const { data: todayBookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('id')
        .eq('added_by_type', 'whatsapp_agent')
        .eq('added_by_user_id', agentUserId)
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`);

      if (bookingsError) throw bookingsError;

      // The legacy database value also identifies staff-agent bookings; preserve historical attribution.
      // Get unique customers helped by this agent (distinct customer_id from their bookings)
      const { data: customersHelped, error: customersError } = await supabase
        .from('bookings')
        .select('customer_id')
        .eq('added_by_type', 'whatsapp_agent')
        .eq('added_by_user_id', agentUserId)
        .not('customer_id', 'is', null);

      if (customersError) throw customersError;

      const uniqueCustomers = new Set(customersHelped?.map(b => b.customer_id) || []);

      return {
        bookingsCreatedToday: todayBookings?.length || 0,
        customersHelped: uniqueCustomers.size,
      };
    } catch (error) {
      logErrorDev('Error fetching agent metrics:', error);
      return {
        bookingsCreatedToday: 0,
        customersHelped: 0,
      };
    }
  },

  // ===========================
  // BOOKINGS
  // ===========================

  /**
   * Get bookings for a branch with optional filters
   * @param {object} filters - { branchId, date, status, search }
   */
  getBookings: async ({ branchId, date, status, search, page = 1, limit = 50 } = {}) => {
    try {
      // Join customers table to get customer details
      let query = supabase
        .from('bookings')
        .select('*, customer:customers(id, name, country_code, phone)', { count: 'exact' })
        .order('date', { ascending: false })
        .order('time', { ascending: false });

      // Branch filter (required for agents)
      if (branchId) {
        query = query.eq('branch_id', branchId);
      }

      // Date filter
      if (date) {
        query = query.eq('date', date);
      }

      // Status filter
      if (status) {
        query = query.eq('status', status);
      }

      // Search filter - search via customer relation
      // Note: Supabase doesn't support filtering on joined tables directly in .or()
      // So we search customers separately and filter by customer_id
      if (search && search.length >= 2) {
        const escapedSearch = escapeLikeWildcards(search);
        // Get matching customer IDs first
        const { data: matchingCustomers } = await supabase
          .from('customers')
          .select('id')
          .or(`name.ilike.%${escapedSearch}%,phone.ilike.%${escapedSearch}%`);

        if (matchingCustomers && matchingCustomers.length > 0) {
          const customerIds = matchingCustomers.map(c => c.id);
          query = query.in('customer_id', customerIds);
        } else {
          // No matching customers, return empty result
          return { bookings: [], total: 0, page, limit };
        }
      }

      // Pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      return {
        bookings: (data || []).map(bookingToFrontend),
        total: count || 0,
        page,
        limit,
      };
    } catch (error) {
      logErrorDev('Error fetching bookings:', error);
      throw error;
    }
  },

  /**
   * Get a single booking by ID
   * @param {string} bookingId - The booking ID
   */
  getBookingById: async (bookingId) => {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*, customer:customers(id, name, country_code, phone)')
        .eq('id', bookingId)
        .single();

      if (error) throw error;
      return bookingToFrontend(data);
    } catch (error) {
      logErrorDev('Error fetching booking:', error);
      throw error;
    }
  },

  /**
   * Find or create a customer by phone number
   * @param {string} countryCode - Country code (e.g., '+965')
   * @param {string} phone - Phone number
   * @param {string} name - Customer name
   * @param {string} agentUserId - Agent's user ID for tracking
   * @returns {object} Customer record
   */
  findOrCreateCustomer: async (countryCode, phone, name, agentUserId) => {
    try {
      // Try to find existing customer by country_code + phone
      const { data: existing, error: findError } = await supabase
        .from('customers')
        .select('*')
        .eq('country_code', countryCode)
        .eq('phone', phone)
        .single();

      if (existing && !findError) {
        return customerToFrontend(existing);
      }

      // Customer not found, create new one
      const { data: created, error: createError } = await supabase
        .from('customers')
        .insert([{
          name,
          country_code: countryCode,
          phone,
          status: 'active',
          created_by_type: 'agent',
          created_by_user_id: agentUserId,
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
            .eq('phone', phone)
            .single();
          if (retry) return customerToFrontend(retry);
        }
        throw createError;
      }

      return customerToFrontend(created);
    } catch (error) {
      logErrorDev('Error in findOrCreateCustomer:', error);
      throw error;
    }
  },

  /**
   * Create a new booking (tracks agent as creator, auto-links customer)
   * @param {object} bookingData
   */
  createBooking: async (bookingData) => {
    try {
      // Explicit customer references remain stable even without a phone.
      let customerId = bookingData.customerId || null;
      if (customerId) {
        const customer = await agentService.getCustomerById(customerId);
        if (!customer || customer.status !== 'active') throw new Error('INVALID_CUSTOMER');
      } else if (bookingData.customerPhone && bookingData.customerCountryCode) {
        const customer = await agentService.findOrCreateCustomer(
          bookingData.customerCountryCode,
          bookingData.customerPhone,
          bookingData.customerName,
          bookingData.agentUserId
        );
        customerId = customer?.id;
      }

      const dbData = bookingToDatabase({
        ...bookingData,
        customerId,
        addedByType: 'whatsapp_agent',
        addedByUserId: bookingData.agentUserId,
      });

      const { data, error } = await supabase
        .from('bookings')
        .insert([dbData])
        .select()
        .single();

      if (error) throw error;
      return bookingToFrontend(data);
    } catch (error) {
      logErrorDev('Error creating booking:', error);
      throw error;
    }
  },

  /**
   * Update an existing booking (tracks agent as modifier)
   * @param {string} bookingId
   * @param {object} bookingData
   * @param {string} agentUserId
   */
  updateBooking: async (bookingId, bookingData, agentUserId) => {
    try {
      const dbData = bookingToDatabase({
        ...bookingData,
        modifiedByType: 'whatsapp_agent',
        modifiedByUserId: agentUserId,
      });

      const { data, error } = await supabase
        .from('bookings')
        .update(dbData)
        .eq('id', bookingId)
        .select()
        .single();

      if (error) throw error;
      return bookingToFrontend(data);
    } catch (error) {
      logErrorDev('Error updating booking:', error);
      throw error;
    }
  },

  // ===========================
  // BRANCH DATA
  // ===========================

  /**
   * Get all branches (agents can access all branches)
   */
  getAllBranches: async () => {
    try {
      const { data, error } = await supabase
        .from('branches')
        .select(`
          *,
          governorates:governorate_id (name_en, name_ar),
          areas:area_id (name_en, name_ar)
        `)
        .eq('status', 'active')
        .order('name');

      if (error) throw error;
      return (data || []).map(branchToFrontend);
    } catch (error) {
      logErrorDev('Error fetching branches:', error);
      throw error;
    }
  },

  /**
   * Get barbers for a specific branch
   * @param {string} branchId
   */
  getBarbers: async (branchId) => {
    try {
      const { data, error } = await supabase
        .from('barbers')
        .select('*')
        .eq('branch_id', branchId)
        .eq('status', 'active')
        .order('name');

      if (error) throw error;
      return (data || []).map(barberToFrontend);
    } catch (error) {
      logErrorDev('Error fetching barbers:', error);
      throw error;
    }
  },

  /**
   * Get services for a specific branch
   * @param {string} branchId
   */
  getServices: async (branchId) => {
    try {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('branch_id', branchId)
        .eq('status', 'active')
        .order('name');

      if (error) throw error;
      return (data || []).map(serviceToFrontend);
    } catch (error) {
      logErrorDev('Error fetching services:', error);
      throw error;
    }
  },

  // ===========================
  // CUSTOMERS - CRUD Operations
  // ===========================

  /**
   * Get all customers with optional filters
   * @param {object} options - { search, status, page, limit }
   */
  getAllCustomers: async ({ search, status, page = 1, limit = 50 } = {}) => {
    try {
      let query = supabase
        .from('customers')
        .select('*, staff_details:customer_staff_details(notes,tags)', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Status filter
      if (status) {
        query = query.eq('status', status);
      } else {
        // By default, show active customers
        query = query.eq('status', 'active');
      }

      // Search filter (name or phone)
      if (search && search.length >= 2) {
        const escapedSearch = escapeLikeWildcards(search);
        query = query.or(`name.ilike.%${escapedSearch}%,phone.ilike.%${escapedSearch}%`);
      }

      // Pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      return {
        customers: (data || []).map(customerToFrontend),
        total: count || 0,
        page,
        limit,
      };
    } catch (error) {
      logErrorDev('Error fetching customers:', error);
      throw error;
    }
  },

  /**
   * Get a single customer by ID
   * @param {string} customerId
   */
  getCustomerById: async (customerId) => {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*, staff_details:customer_staff_details(notes,tags)')
        .eq('id', customerId)
        .single();

      if (error) throw error;
      return customerToFrontend(data);
    } catch (error) {
      logErrorDev('Error fetching customer:', error);
      throw error;
    }
  },

  /**
   * Create a new customer
   * @param {object} customerData
   * @param {string} agentUserId
   */
  createCustomer: async (customerData, agentUserId) => {
    try {
      const dbData = customerToDatabase({
        ...customerData,
        createdByType: 'agent',
        createdByUserId: agentUserId,
      });

      const { data, error } = await supabase
        .rpc('save_customer_profile', { p_id: null, p_data: dbData });

      if (error) {
        // Handle unique constraint violation
        if (error.code === '23505') {
          throw new Error('PHONE_EXISTS');
        }
        throw error;
      }
      return customerToFrontend(data);
    } catch (error) {
      logErrorDev('Error creating customer:', error);
      throw error;
    }
  },

  /**
   * Update an existing customer
   * @param {string} customerId
   * @param {object} customerData
   */
  updateCustomer: async (customerId, customerData) => {
    try {
      const dbData = customerToDatabase(customerData);

      const { data, error } = await supabase
        .rpc('save_customer_profile', { p_id: customerId, p_data: dbData });

      if (error) {
        // Handle unique constraint violation
        if (error.code === '23505') {
          throw new Error('PHONE_EXISTS');
        }
        throw error;
      }
      return customerToFrontend(data);
    } catch (error) {
      logErrorDev('Error updating customer:', error);
      throw error;
    }
  },

  /**
   * Delete a customer (soft delete by setting status to inactive)
   * @param {string} customerId
   */
  deleteCustomer: async (customerId) => {
    try {
      const { error } = await supabase
        .from('customers')
        .update({ status: 'inactive' })
        .eq('id', customerId);

      if (error) throw error;
      return true;
    } catch (error) {
      logErrorDev('Error deleting customer:', error);
      throw error;
    }
  },

  /**
   * Search customers by phone number or name (from customers table)
   * @param {string} query - Search query (min 3 chars)
   */
  searchCustomers: async (query) => {
    try {
      if (!query || query.length < 3) {
        return [];
      }

      const escapedQuery = escapeLikeWildcards(query);

      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('status', 'active')
        .or(`name.ilike.%${escapedQuery}%,phone.ilike.%${escapedQuery}%`)
        .order('last_booking_date', { ascending: false, nullsFirst: false })
        .limit(20);

      if (error) throw error;

      return (data || []).map(customerToFrontend);
    } catch (error) {
      logErrorDev('Error searching customers:', error);
      throw error;
    }
  },

  /**
   * Get booking history for a customer by customer ID
   * @param {string} customerId - Customer ID (UUID)
   */
  getCustomerBookings: async (customerId) => {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          customer:customers(id, name, country_code, phone),
          branches:branch_id (name),
          barbers:barber_id (name)
        `)
        .eq('customer_id', customerId)
        .order('date', { ascending: false })
        .order('time', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Get service details for each booking
      const serviceIds = new Set();
      (data || []).forEach(b => {
        (b.service_ids || []).forEach(id => serviceIds.add(id));
      });

      let servicesMap = {};
      if (serviceIds.size > 0) {
        const { data: services } = await supabase
          .from('services')
          .select('id, name')
          .in('id', Array.from(serviceIds));

        services?.forEach(s => {
          servicesMap[s.id] = s;
        });
      }

      return (data || []).map(booking => ({
        id: booking.id,
        branchId: booking.branch_id,
        branchName: booking.branches?.name,
        barberId: booking.barber_id,
        barber: booking.barbers ? { name: booking.barbers.name } : null,
        customerId: booking.customer_id,
        customer: booking.customer ? {
          id: booking.customer.id,
          name: booking.customer.name,
          countryCode: booking.customer.country_code,
          phone: booking.customer.phone,
        } : null,
        // Backward compatibility
        customerName: booking.customer?.name || null,
        customerPhone: booking.customer?.phone || null,
        date: booking.date,
        time: booking.time?.slice(0, 5), // "12:30:00" -> "12:30"
        duration: booking.duration,
        price: parseFloat(booking.price),
        status: booking.status,
        services: (booking.service_ids || []).map(id => servicesMap[id]).filter(Boolean),
        createdAt: booking.created_at,
      }));
    } catch (error) {
      logErrorDev('Error fetching customer bookings:', error);
      throw error;
    }
  },

};

export default agentService;
