import { supabase } from '../lib/supabase';
import { escapeLikeWildcards, logErrorDev } from '../utils/security';
import { getToday } from '../utils/dateHelpers';

/**
 * Agent Service - Operations for WhatsApp customer support agents
 * Agents can create/edit bookings for any branch and view customer data
 */

// Convert booking to frontend format
const bookingToFrontend = (booking) => {
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

// Convert booking to database format
const bookingToDatabase = (data) => {
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
        .eq('added_by_type', 'agent')
        .eq('added_by_user_id', agentUserId)
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`);

      if (bookingsError) throw bookingsError;

      // Get active conversations (conversations with messages in last 24 hours)
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const { count: activeConversations, error: convError } = await supabase
        .from('whatsapp_conversations')
        .select('id', { count: 'exact', head: true })
        .gte('last_message_at', oneDayAgo.toISOString());

      if (convError) throw convError;

      // Get unique customers helped by this agent (distinct customer phones from their bookings)
      const { data: customersHelped, error: customersError } = await supabase
        .from('bookings')
        .select('customer_phone')
        .eq('added_by_type', 'agent')
        .eq('added_by_user_id', agentUserId);

      if (customersError) throw customersError;

      const uniqueCustomers = new Set(customersHelped?.map(b => b.customer_phone) || []);

      return {
        bookingsCreatedToday: todayBookings?.length || 0,
        activeConversations: activeConversations || 0,
        customersHelped: uniqueCustomers.size,
      };
    } catch (error) {
      logErrorDev('Error fetching agent metrics:', error);
      return {
        bookingsCreatedToday: 0,
        activeConversations: 0,
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
      let query = supabase
        .from('bookings')
        .select('*', { count: 'exact' })
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

      // Search filter (customer name or phone)
      if (search) {
        const escapedSearch = escapeLikeWildcards(search);
        query = query.or(`customer_name.ilike.%${escapedSearch}%,customer_phone.ilike.%${escapedSearch}%`);
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
   * Create a new booking (tracks agent as creator)
   * @param {object} bookingData
   */
  createBooking: async (bookingData) => {
    try {
      const dbData = bookingToDatabase({
        ...bookingData,
        addedByType: 'agent',
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
        modifiedByType: 'agent',
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
  // CUSTOMERS
  // ===========================

  /**
   * Search customers by phone number or name (from bookings)
   * @param {string} query - Search query (min 3 chars)
   */
  searchCustomers: async (query) => {
    try {
      if (!query || query.length < 3) {
        return [];
      }

      const escapedQuery = escapeLikeWildcards(query);

      // Search bookings for matching customer details
      const { data, error } = await supabase
        .from('bookings')
        .select('customer_name, customer_phone, customer_country_code')
        .or(`customer_name.ilike.%${escapedQuery}%,customer_phone.ilike.%${escapedQuery}%`)
        .limit(100);

      if (error) throw error;

      // Deduplicate by phone number and aggregate
      const customerMap = new Map();
      (data || []).forEach(booking => {
        const phone = booking.customer_phone;
        if (!customerMap.has(phone)) {
          customerMap.set(phone, {
            name: booking.customer_name,
            phone: booking.customer_phone,
            countryCode: booking.customer_country_code,
          });
        }
      });

      return Array.from(customerMap.values()).slice(0, 20); // Max 20 results
    } catch (error) {
      logErrorDev('Error searching customers:', error);
      throw error;
    }
  },

  /**
   * Get booking history for a customer
   * @param {string} phone - Customer phone number
   */
  getCustomerBookings: async (phone) => {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          branches:branch_id (name),
          barbers:barber_id (name)
        `)
        .eq('customer_phone', phone)
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
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone,
        date: booking.date,
        time: booking.time,
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

  // ===========================
  // WHATSAPP CONVERSATIONS
  // ===========================

  /**
   * Get conversations list (paginated)
   * @param {object} options - { page, limit, search }
   */
  getConversations: async ({ page = 1, limit = 20, search = null } = {}) => {
    try {
      let query = supabase
        .from('whatsapp_conversations')
        .select('*', { count: 'exact' })
        .order('last_message_at', { ascending: false, nullsFirst: false });

      // Search filter
      if (search) {
        const escapedSearch = escapeLikeWildcards(search);
        query = query.or(`phone_number.ilike.%${escapedSearch}%,customer_name.ilike.%${escapedSearch}%`);
      }

      // Pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      return {
        conversations: (data || []).map(conv => ({
          id: conv.id,
          phoneNumber: conv.phone_number,
          phoneCountryCode: conv.phone_country_code,
          customerName: conv.customer_name,
          currentState: conv.current_state,
          language: conv.language,
          lastMessageAt: conv.last_message_at,
          createdAt: conv.created_at,
        })),
        total: count || 0,
        page,
        limit,
      };
    } catch (error) {
      logErrorDev('Error fetching conversations:', error);
      throw error;
    }
  },

  /**
   * Get recent conversations (for dashboard)
   * @param {number} limit - Number of recent conversations
   */
  getRecentConversations: async (limit = 5) => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_conversations')
        .select('id, phone_number, customer_name, last_message_at')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).map(conv => ({
        id: conv.id,
        phoneNumber: conv.phone_number,
        customerName: conv.customer_name,
        lastMessageAt: conv.last_message_at,
      }));
    } catch (error) {
      logErrorDev('Error fetching recent conversations:', error);
      return [];
    }
  },

  /**
   * Get messages for a conversation
   * @param {string} conversationId
   */
  getConversationMessages: async (conversationId) => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return (data || []).map(msg => ({
        id: msg.id,
        conversationId: msg.conversation_id,
        direction: msg.direction,
        messageType: msg.message_type,
        content: msg.content,
        status: msg.status,
        metadata: msg.metadata,
        createdAt: msg.created_at,
      }));
    } catch (error) {
      logErrorDev('Error fetching conversation messages:', error);
      throw error;
    }
  },

  /**
   * Get full conversation details including current_state
   * @param {string} conversationId
   */
  getConversationDetails: async (conversationId) => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (error) throw error;

      return {
        id: data.id,
        phoneNumber: data.phone_number,
        phoneCountryCode: data.phone_country_code,
        customerName: data.customer_name,
        currentState: data.current_state,
        language: data.language,
        context: data.context,
        lastMessageAt: data.last_message_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    } catch (error) {
      logErrorDev('Error fetching conversation details:', error);
      throw error;
    }
  },

  /**
   * Send a WhatsApp message to a customer (via Edge Function)
   * @param {string} conversationId - The conversation ID
   * @param {string} phoneNumber - Customer phone number
   * @param {string} phoneCountryCode - Country code (e.g., '965')
   * @param {string} content - Message content
   * @param {string} agentUserId - The agent's user ID
   */
  sendMessage: async (conversationId, phoneNumber, phoneCountryCode, content, agentUserId) => {
    try {
      const { data, error } = await supabase.functions.invoke('send-whatsapp-message', {
        body: {
          conversationId,
          phoneNumber,
          phoneCountryCode,
          content,
          agentUserId,
        },
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'Failed to send message');
      }

      return data;
    } catch (error) {
      logErrorDev('Error sending WhatsApp message:', error);
      throw error;
    }
  },

  /**
   * Release conversation back to AI bot
   * @param {string} conversationId
   */
  releaseConversation: async (conversationId) => {
    try {
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({
          current_state: 'greeting',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);

      if (error) throw error;
      return true;
    } catch (error) {
      logErrorDev('Error releasing conversation:', error);
      throw error;
    }
  },

  /**
   * Take over a conversation (set state to agent_takeover without sending message)
   * @param {string} conversationId
   */
  takeoverConversation: async (conversationId) => {
    try {
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({
          current_state: 'agent_takeover',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);

      if (error) throw error;
      return true;
    } catch (error) {
      logErrorDev('Error taking over conversation:', error);
      throw error;
    }
  },

  // ===========================
  // REALTIME SUBSCRIPTIONS
  // ===========================

  /**
   * Subscribe to new messages for a specific conversation
   * @param {string} conversationId
   * @param {function} onNewMessage - Callback when new message arrives
   * @returns {object} Supabase channel (for cleanup)
   */
  subscribeToMessages: (conversationId, onNewMessage) => {
    const messageToFrontend = (msg) => ({
      id: msg.id,
      conversationId: msg.conversation_id,
      direction: msg.direction,
      messageType: msg.message_type,
      content: msg.content,
      status: msg.status,
      metadata: msg.metadata,
      createdAt: msg.created_at,
    });

    const channel = supabase
      .channel(`whatsapp-messages-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        onNewMessage(messageToFrontend(payload.new));
      })
      .subscribe();

    return channel;
  },

  /**
   * Subscribe to conversation state changes
   * @param {string} conversationId
   * @param {function} onUpdate - Callback when conversation is updated
   * @returns {object} Supabase channel (for cleanup)
   */
  subscribeToConversation: (conversationId, onUpdate) => {
    const conversationToFrontend = (conv) => ({
      id: conv.id,
      phoneNumber: conv.phone_number,
      phoneCountryCode: conv.phone_country_code,
      customerName: conv.customer_name,
      currentState: conv.current_state,
      language: conv.language,
      context: conv.context,
      lastMessageAt: conv.last_message_at,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
    });

    const channel = supabase
      .channel(`whatsapp-conversation-${conversationId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_conversations',
        filter: `id=eq.${conversationId}`,
      }, (payload) => {
        onUpdate(conversationToFrontend(payload.new));
      })
      .subscribe();

    return channel;
  },

  /**
   * Unsubscribe from a realtime channel
   * @param {object} channel - Supabase channel to unsubscribe from
   */
  unsubscribe: (channel) => {
    if (channel) {
      supabase.removeChannel(channel);
    }
  },
};

export default agentService;
