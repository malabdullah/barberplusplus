// Log severity levels (in priority order)
export const LOG_LEVELS = ['error', 'warning', 'info', 'debug'];

// Types of log events
export const LOG_TYPES = ['error', 'action', 'navigation', 'system', 'auth'];

// Entity types that can be logged
export const ENTITY_TYPES = ['branch', 'barber', 'service', 'booking'];

// Actions that can be logged
export const ACTIONS = [
  'create',
  'update',
  'delete',
  'view',
  'login',
  'logout',
  'signup',
  'navigate',
];

// Configuration for log level display
export const LOG_LEVEL_CONFIG = {
  error: { color: 'error', label: 'Error', icon: 'AlertTriangle' },
  warning: { color: 'warning', label: 'Warning', icon: 'AlertCircle' },
  info: { color: 'info', label: 'Info', icon: 'Info' },
  debug: { color: 'secondary', label: 'Debug', icon: 'Bug' },
};

// Configuration for log type display
export const LOG_TYPE_CONFIG = {
  error: { color: 'error', label: 'Error' },
  action: { color: 'success', label: 'Action' },
  navigation: { color: 'info', label: 'Navigation' },
  system: { color: 'secondary', label: 'System' },
  auth: { color: 'warning', label: 'Auth' },
};
