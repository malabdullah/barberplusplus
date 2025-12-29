import { supabase } from '../lib/supabase';

// Convert snake_case DB columns to camelCase for frontend
const toFrontend = (notification) => {
  if (!notification) return null;
  return {
    id: notification.id,
    recipientUserId: notification.recipient_user_id,
    recipientBranchId: notification.recipient_branch_id,
    recipientRole: notification.recipient_role,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    entityType: notification.entity_type,
    entityId: notification.entity_id,
    isRead: notification.is_read,
    readAt: notification.read_at,
    metadata: notification.metadata,
    createdAt: notification.created_at,
  };
};

// Convert camelCase frontend data to snake_case for DB
const toDatabase = (data) => {
  const result = {};
  if (data.recipientUserId !== undefined) result.recipient_user_id = data.recipientUserId;
  if (data.recipientBranchId !== undefined) result.recipient_branch_id = data.recipientBranchId;
  if (data.recipientRole !== undefined) result.recipient_role = data.recipientRole;
  if (data.type !== undefined) result.type = data.type;
  if (data.title !== undefined) result.title = data.title;
  if (data.message !== undefined) result.message = data.message;
  if (data.entityType !== undefined) result.entity_type = data.entityType;
  if (data.entityId !== undefined) result.entity_id = data.entityId;
  if (data.isRead !== undefined) result.is_read = data.isRead;
  if (data.readAt !== undefined) result.read_at = data.readAt;
  if (data.metadata !== undefined) result.metadata = data.metadata;
  return result;
};

export const notificationsService = {
  /**
   * Get all notifications for current user
   * @param {object} options - { limit, offset, unreadOnly }
   * @returns {Promise<Array>}
   */
  getAll: async (options = {}) => {
    const { limit = 50, offset = 0, unreadOnly = false } = options;

    let query = supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(toFrontend);
  },

  /**
   * Get unread count for current user
   * @returns {Promise<number>}
   */
  getUnreadCount: async () => {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('is_read', false);

    if (error) throw error;
    return count || 0;
  },

  /**
   * Mark a single notification as read
   * @param {string} id
   * @returns {Promise<object>}
   */
  markRead: async (id) => {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Mark all notifications as read for current user
   * @returns {Promise<void>}
   */
  markAllRead: async () => {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('is_read', false);

    if (error) throw error;
  },

  /**
   * Create a notification
   * @param {object} notificationData
   * @returns {Promise<object>}
   */
  create: async (notificationData) => {
    const dbData = toDatabase(notificationData);

    const { error } = await supabase
      .from('notifications')
      .insert([dbData]);

    if (error) {
      console.error('[NotificationsService] create error:', error);
      throw error;
    }

    // Return the input data with a generated ID since we don't use .select()
    return toFrontend({
      ...dbData,
      id: crypto.randomUUID(), // Client-side ID for immediate use
      created_at: new Date().toISOString(),
      is_read: false,
    });
  },

  /**
   * Create multiple notifications (batch)
   * @param {Array} notifications
   * @returns {Promise<Array>}
   */
  createBatch: async (notifications) => {
    if (!notifications || notifications.length === 0) {
      console.log('[NotificationsService] createBatch: No notifications to create');
      return [];
    }

    const dbNotifications = notifications.map(toDatabase);
    console.log('[NotificationsService] createBatch: Inserting notifications:', dbNotifications);

    // Don't use .select() - it triggers SELECT RLS policies which may not match the inserting user
    const { error } = await supabase
      .from('notifications')
      .insert(dbNotifications);

    if (error) {
      console.error('[NotificationsService] createBatch error:', error);
      throw error;
    }

    console.log('[NotificationsService] createBatch success');

    // Return transformed input data with generated IDs
    return dbNotifications.map(dbNotif => toFrontend({
      ...dbNotif,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      is_read: false,
    }));
  },

  /**
   * Delete a notification
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  delete: async (id) => {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  },

  /**
   * Subscribe to real-time notifications
   * @param {function} onInsert - callback when new notification arrives
   * @param {function} onUpdate - callback when notification is updated
   * @param {string} userId - current user ID for filtering
   * @param {Array<string>} branchIds - branch IDs for manager filtering (optional)
   * @returns {object} - Supabase channel (call .unsubscribe() to cleanup)
   */
  subscribe: (onInsert, onUpdate, userId, branchIds = []) => {
    console.log('[NotificationsService] Setting up realtime subscription for userId:', userId, 'branchIds:', branchIds);
    const channel = supabase.channel('notifications-realtime');

    // Subscribe to notifications for this user
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
      },
      (payload) => {
        console.log('[NotificationsService] Realtime INSERT received:', payload.new);
        const notification = toFrontend(payload.new);
        // Filter on client side - check if notification is for this user or their branches
        if (
          notification.recipientUserId === userId ||
          branchIds.includes(notification.recipientBranchId)
        ) {
          console.log('[NotificationsService] Notification matches user/branch, calling onInsert');
          onInsert(notification);
        } else {
          console.log('[NotificationsService] Notification does not match user/branch, skipping');
        }
      }
    );

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
      },
      (payload) => {
        console.log('[NotificationsService] Realtime UPDATE received:', payload.new);
        const notification = toFrontend(payload.new);
        if (
          notification.recipientUserId === userId ||
          branchIds.includes(notification.recipientBranchId)
        ) {
          onUpdate(notification);
        }
      }
    );

    channel.subscribe((status) => {
      console.log('[NotificationsService] Realtime subscription status:', status);
    });
    return channel;
  },
};

export default notificationsService;
