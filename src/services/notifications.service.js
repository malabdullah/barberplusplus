import { supabase } from '../lib/supabase';
import { notificationPreferencesService } from './notificationPreferences.service';

const toFrontend = n => ({
  id: n.id, recipientUserId: n.recipient_user_id, recipientBranchId: n.recipient_branch_id,
  recipientRole: n.recipient_role, type: n.type, title: n.title, message: n.message,
  entityType: n.entity_type, entityId: n.entity_id, isRead: n.is_read,
  readAt: n.read_at, metadata: n.metadata, createdAt: n.created_at,
});

// Apply identical preference/cutoff rules to history and the full unread count.
// Values originate from our fixed type map and validated ISO timestamps.
export const preferenceFilter = preferences => {
  if (!preferences) return null;
  const types = Object.keys(notificationPreferencesService.TYPE_TO_PREFERENCE);
  const enabled = types.flatMap(type => {
    if (!notificationPreferencesService.isTypeEnabled(preferences, type)) return [];
    const key = notificationPreferencesService.getPreferenceKey(type);
    const cutoff = preferences[`${key}EnabledAt`];
    return cutoff && Number.isFinite(Date.parse(cutoff))
      ? [`and(type.eq.${type},created_at.gte.${new Date(cutoff).toISOString()})`]
      : [`type.eq.${type}`];
  });
  return [`type.not.in.(${types.join(',')})`, ...enabled].join(',');
};
const applyPreferences = (query, preferences) => {
  const filter = preferenceFilter(preferences);
  return filter ? query.or(filter) : query;
};

export const notificationsService = {
  getAll: async ({ limit = 50, offset = 0, unreadOnly = false, preferences } = {}) => {
    let query = supabase.from('notifications').select('*')
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (unreadOnly) query = query.eq('is_read', false);
    const { data, error } = await applyPreferences(query, preferences);
    if (error) throw error;
    return (data || []).map(toFrontend);
  },
  getUnreadCount: async preferences => {
    const { count, error } = await applyPreferences(supabase.from('notifications')
      .select('*', { count: 'exact', head: true }).eq('is_read', false), preferences);
    if (error) throw error;
    return count || 0;
  },
  markRead: async id => {
    const { error } = await supabase.from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id).eq('is_read', false);
    if (error) throw error;
  },
  markAllRead: async () => {
    const { error } = await supabase.from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() }).eq('is_read', false);
    if (error) throw error;
  },
  subscribe: (onInsert, onUpdate, userId, onStatus) => supabase
    .channel(`dashboard-notifications:${userId}:${crypto.randomUUID()}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${userId}`,
    }, payload => onInsert(toFrontend(payload.new)))
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${userId}`,
    }, payload => onUpdate(toFrontend(payload.new)))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') onStatus?.();
    }),
};
export default notificationsService;
