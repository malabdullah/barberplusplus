/**
 * Constants for booking actor types (who added/modified a booking)
 */

export const ADDED_BY_TYPES = {
  MANAGER: 'manager',
  BARBER: 'barber',
  WHATSAPP_AGENT: 'whatsapp_agent',
  ADMIN: 'admin',
  SYSTEM: 'system',
};

/**
 * Configuration for each actor type including i18n keys and icons
 */
export const ADDED_BY_CONFIG = {
  manager: {
    labelKey: 'bookings.addedBy.manager',
    icon: 'UserCog',
  },
  barber: {
    labelKey: 'bookings.addedBy.barber',
    icon: 'Scissors',
  },
  whatsapp_agent: {
    labelKey: 'bookings.addedBy.whatsapp',
    icon: 'MessageCircle',
  },
  admin: {
    labelKey: 'bookings.addedBy.admin',
    icon: 'Shield',
  },
  system: {
    labelKey: 'bookings.addedBy.system',
    icon: 'Bot',
  },
};

/**
 * Get config for an actor type, with fallback to system
 * @param {string} type - The actor type
 * @returns {object} Configuration object with labelKey and icon
 */
export const getAddedByConfig = (type) =>
  ADDED_BY_CONFIG[type] || ADDED_BY_CONFIG.system;
