import { supabase } from '../lib/supabase';

// Default preferences for new users (all enabled)
const DEFAULT_PREFERENCES = {
  newBookings: true,
  bookingUpdates: true,
  cancellations: true,
  barberUpdates: true,
  teamInvites: true,
  systemAlerts: true,
};

// Map notification types to preference keys
const TYPE_TO_PREFERENCE = {
  booking_created: 'newBookings',
  booking_reminder: 'newBookings',
  booking_status_changed: 'bookingUpdates',
  booking_completed: 'bookingUpdates',
  booking_cancelled: 'cancellations',
  barber_profile_updated: 'barberUpdates',
  barber_availability_updated: 'barberUpdates',
  barber_invite_accepted: 'teamInvites',
  system_alert: 'systemAlerts',
  low_availability_warning: 'systemAlerts',
};

// Convert snake_case DB columns to camelCase for frontend
const toFrontend = (prefs) => {
  if (!prefs) return null;
  return {
    id: prefs.id,
    userId: prefs.user_id,
    newBookings: prefs.new_bookings,
    bookingUpdates: prefs.booking_updates,
    cancellations: prefs.cancellations,
    barberUpdates: prefs.barber_updates,
    teamInvites: prefs.team_invites,
    systemAlerts: prefs.system_alerts,
    // Enable timestamps - track when each preference was last enabled
    newBookingsEnabledAt: prefs.new_bookings_enabled_at,
    bookingUpdatesEnabledAt: prefs.booking_updates_enabled_at,
    cancellationsEnabledAt: prefs.cancellations_enabled_at,
    systemAlertsEnabledAt: prefs.system_alerts_enabled_at,
    createdAt: prefs.created_at,
    updatedAt: prefs.updated_at,
  };
};

// Map preference keys to their enabled_at column names
const PREFERENCE_TO_ENABLED_AT_COLUMN = {
  newBookings: 'new_bookings_enabled_at',
  bookingUpdates: 'booking_updates_enabled_at',
  cancellations: 'cancellations_enabled_at',
  systemAlerts: 'system_alerts_enabled_at',
};

// Map preference keys to their enabled_at frontend keys
const PREFERENCE_TO_ENABLED_AT_KEY = {
  newBookings: 'newBookingsEnabledAt',
  bookingUpdates: 'bookingUpdatesEnabledAt',
  cancellations: 'cancellationsEnabledAt',
  systemAlerts: 'systemAlertsEnabledAt',
};

// Convert camelCase frontend data to snake_case for DB
const toDatabase = (data) => {
  const result = {};
  if (data.userId !== undefined) result.user_id = data.userId;
  if (data.newBookings !== undefined) result.new_bookings = data.newBookings;
  if (data.bookingUpdates !== undefined) result.booking_updates = data.bookingUpdates;
  if (data.cancellations !== undefined) result.cancellations = data.cancellations;
  if (data.barberUpdates !== undefined) result.barber_updates = data.barberUpdates;
  if (data.teamInvites !== undefined) result.team_invites = data.teamInvites;
  if (data.systemAlerts !== undefined) result.system_alerts = data.systemAlerts;
  return result;
};

export const notificationPreferencesService = {
  /**
   * Get preferences for current user
   * @returns {Promise<object>} User preferences or defaults if none exist
   */
  get: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('user_notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // If no preferences exist, return defaults
    if (error && error.code === 'PGRST116') {
      return { ...DEFAULT_PREFERENCES, userId: user.id };
    }
    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Create or update all preferences
   * @param {object} preferences
   * @returns {Promise<object>}
   */
  upsert: async (preferences) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const dbData = { ...toDatabase(preferences), user_id: user.id };

    const { data, error } = await supabase
      .from('user_notification_preferences')
      .upsert(dbData, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;
    return toFrontend(data);
  },

  /**
   * Update a single preference
   * @param {string} key - The preference key (e.g., 'newBookings')
   * @param {boolean} value - The new value
   * @returns {Promise<object>}
   */
  updateSingle: async (key, value) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Convert the key to database column name
    const dbColumn = toDatabase({ [key]: value });
    const columnName = Object.keys(dbColumn)[0];

    // Build update data - include enabled_at timestamp if toggling ON
    const updateData = { [columnName]: value };
    if (value === true && PREFERENCE_TO_ENABLED_AT_COLUMN[key]) {
      updateData[PREFERENCE_TO_ENABLED_AT_COLUMN[key]] = new Date().toISOString();
    }

    // Try to update existing row first
    const { data: existing } = await supabase
      .from('user_notification_preferences')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (existing) {
      // Update existing row
      const { data, error } = await supabase
        .from('user_notification_preferences')
        .update(updateData)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;
      return toFrontend(data);
    } else {
      // Create new row with defaults and the specified preference
      const defaultDbData = toDatabase(DEFAULT_PREFERENCES);
      const { data, error } = await supabase
        .from('user_notification_preferences')
        .insert({
          user_id: user.id,
          ...defaultDbData,
          ...updateData
        })
        .select()
        .single();

      if (error) throw error;
      return toFrontend(data);
    }
  },

  /**
   * Check if a notification type is enabled for given preferences
   * @param {object} preferences - User's notification preferences
   * @param {string} notificationType - The notification type to check
   * @param {string} notificationCreatedAt - When the notification was created (ISO string)
   * @returns {boolean}
   */
  isTypeEnabled: (preferences, notificationType, notificationCreatedAt) => {
    const preferenceKey = TYPE_TO_PREFERENCE[notificationType];
    if (!preferenceKey) return true; // Unknown types are allowed by default

    // If preference is disabled, don't show
    if (!preferences?.[preferenceKey]) return false;

    // Check if notification was created after preference was enabled
    const enabledAtKey = PREFERENCE_TO_ENABLED_AT_KEY[preferenceKey];
    if (enabledAtKey && preferences[enabledAtKey] && notificationCreatedAt) {
      return new Date(notificationCreatedAt) >= new Date(preferences[enabledAtKey]);
    }

    return true;
  },

  /**
   * Get preference key for a notification type
   * @param {string} notificationType
   * @returns {string|null}
   */
  getPreferenceKey: (notificationType) => {
    return TYPE_TO_PREFERENCE[notificationType] || null;
  },

  // Export constants for external use
  DEFAULT_PREFERENCES,
  TYPE_TO_PREFERENCE,
};

export default notificationPreferencesService;
