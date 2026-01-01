// Audit action types with display configuration (keys match database constraint - lowercase)
export const AUDIT_ACTION_TYPES = {
  // User Management
  manager_enabled: { color: 'success', label: 'Manager Enabled', icon: 'UserCheck', category: 'user' },
  manager_disabled: { color: 'warning', label: 'Manager Disabled', icon: 'UserX', category: 'user' },
  barber_enabled: { color: 'success', label: 'Barber Enabled', icon: 'UserCheck', category: 'user' },
  barber_disabled: { color: 'warning', label: 'Barber Disabled', icon: 'UserX', category: 'user' },
  user_created: { color: 'success', label: 'User Created', icon: 'UserPlus', category: 'user' },
  user_updated: { color: 'info', label: 'User Updated', icon: 'UserCog', category: 'user' },
  user_disabled: { color: 'warning', label: 'User Disabled', icon: 'UserX', category: 'user' },
  user_enabled: { color: 'success', label: 'User Enabled', icon: 'UserCheck', category: 'user' },
  user_deleted: { color: 'error', label: 'User Deleted', icon: 'UserMinus', category: 'user' },
  role_assigned: { color: 'info', label: 'Role Assigned', icon: 'Shield', category: 'user' },

  // Configuration
  settings_changed: { color: 'info', label: 'Settings Changed', icon: 'Settings', category: 'config' },
  template_updated: { color: 'info', label: 'Template Updated', icon: 'FileText', category: 'config' },
  location_modified: { color: 'info', label: 'Location Modified', icon: 'MapPin', category: 'config' },
  branch_modified: { color: 'info', label: 'Branch Modified', icon: 'Building', category: 'config' },
  barber_modified: { color: 'info', label: 'Barber Modified', icon: 'Scissors', category: 'config' },
  service_modified: { color: 'info', label: 'Service Modified', icon: 'Tag', category: 'config' },
  booking_modified: { color: 'info', label: 'Booking Modified', icon: 'Calendar', category: 'config' },
  system_config: { color: 'info', label: 'System Config', icon: 'Cog', category: 'config' },

  // Security Events
  login_success: { color: 'success', label: 'Successful Login', icon: 'LogIn', category: 'security' },
  login_failure: { color: 'error', label: 'Failed Login', icon: 'AlertTriangle', category: 'security' },
  logout: { color: 'info', label: 'Logout', icon: 'LogOut', category: 'security' },
  password_reset_requested: { color: 'warning', label: 'Password Reset Requested', icon: 'Key', category: 'security' },
  password_reset_completed: { color: 'success', label: 'Password Reset Completed', icon: 'Key', category: 'security' },
  permission_denied: { color: 'error', label: 'Permission Denied', icon: 'ShieldX', category: 'security' },
  suspicious_activity: { color: 'error', label: 'Suspicious Activity', icon: 'AlertOctagon', category: 'security' },
  session_expired: { color: 'warning', label: 'Session Expired', icon: 'Clock', category: 'security' },
  account_locked: { color: 'error', label: 'Account Locked', icon: 'Lock', category: 'security' },
  account_unlocked: { color: 'success', label: 'Account Unlocked', icon: 'Unlock', category: 'security' },
  security_event: { color: 'warning', label: 'Security Event', icon: 'Shield', category: 'security' },

  // Admin Actions
  data_export: { color: 'info', label: 'Data Exported', icon: 'Download', category: 'admin' },
  import_data: { color: 'info', label: 'Data Imported', icon: 'Upload', category: 'admin' },
  bulk_operation: { color: 'warning', label: 'Bulk Operation', icon: 'Layers', category: 'admin' },
};

// All action types as an array
export const AUDIT_ACTION_TYPE_LIST = Object.keys(AUDIT_ACTION_TYPES);

// Security-specific event types for SecurityEvents page (lowercase to match DB)
export const SECURITY_EVENT_TYPES = [
  'login_success',
  'login_failure',
  'logout',
  'password_reset_requested',
  'password_reset_completed',
  'permission_denied',
  'suspicious_activity',
  'session_expired',
  'account_locked',
  'account_unlocked',
  'security_event',
];

// Severity configuration for security events (lowercase keys)
export const SEVERITY_CONFIG = {
  login_failure: { severity: 'warning', priority: 2 },
  permission_denied: { severity: 'error', priority: 3 },
  suspicious_activity: { severity: 'critical', priority: 4 },
  account_locked: { severity: 'error', priority: 3 },
  login_success: { severity: 'info', priority: 0 },
  logout: { severity: 'info', priority: 0 },
  password_reset_requested: { severity: 'warning', priority: 2 },
  password_reset_completed: { severity: 'success', priority: 1 },
  account_unlocked: { severity: 'success', priority: 1 },
  session_expired: { severity: 'info', priority: 1 },
  security_event: { severity: 'warning', priority: 2 },
};

// Severity levels with display configuration
export const SEVERITY_LEVELS = {
  critical: { color: 'critical', label: 'Critical', icon: 'AlertOctagon' },
  error: { color: 'error', label: 'Error', icon: 'AlertTriangle' },
  warning: { color: 'warning', label: 'Warning', icon: 'AlertCircle' },
  success: { color: 'success', label: 'Success', icon: 'CheckCircle' },
  info: { color: 'info', label: 'Info', icon: 'Info' },
};

// Entity types that can be audited
export const AUDIT_ENTITY_TYPES = [
  'manager',
  'barber',
  'branch',
  'service',
  'booking',
  'governorate',
  'area',
  'setting',
  'template',
  'user',
];

// Action categories for filtering
export const ACTION_CATEGORIES = {
  user: { label: 'User Management', icon: 'Users' },
  config: { label: 'Configuration', icon: 'Settings' },
  security: { label: 'Security', icon: 'Shield' },
  admin: { label: 'Admin Actions', icon: 'Activity' },
};

// Get actions by category
export const getActionsByCategory = (category) => {
  return Object.entries(AUDIT_ACTION_TYPES)
    .filter(([_, config]) => config.category === category)
    .map(([key]) => key);
};
