import { supabase } from '../lib/supabase';

// Log types for categorization
const LOG_TYPES = {
  ERROR: 'error',
  ACTION: 'action',
  NAVIGATION: 'navigation',
  SYSTEM: 'system',
  AUTH: 'auth',
};

// Convert snake_case DB columns to camelCase for frontend
const toFrontend = (log) => {
  if (!log) return null;
  return {
    id: log.id,
    level: log.level,
    logType: log.log_type,
    userId: log.user_id,
    userRole: log.user_role,
    branchId: log.branch_id,
    barberId: log.barber_id,
    entityType: log.entity_type,
    entityId: log.entity_id,
    action: log.action,
    message: log.message,
    stackTrace: log.stack_trace,
    metadata: log.metadata,
    userAgent: log.user_agent,
    pageUrl: log.page_url,
    createdAt: log.created_at,
  };
};

// Convert camelCase frontend data to snake_case for DB
const toDatabase = (logData) => ({
  level: logData.level,
  log_type: logData.logType,
  user_id: logData.userId || null,
  user_role: logData.userRole || null,
  branch_id: logData.branchId || null,
  barber_id: logData.barberId || null,
  entity_type: logData.entityType || null,
  entity_id: logData.entityId || null,
  action: logData.action || null,
  message: logData.message,
  stack_trace: logData.stackTrace || null,
  metadata: logData.metadata || {},
  user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  page_url: typeof window !== 'undefined' ? window.location.href : null,
});

// Batch queue for performance optimization
let logQueue = [];
let flushTimeout = null;
const BATCH_SIZE = 10;
const FLUSH_INTERVAL = 5000; // 5 seconds

// Flush queued logs to database
const flushLogs = async () => {
  if (logQueue.length === 0) return;

  const logsToFlush = [...logQueue];
  logQueue = [];
  flushTimeout = null;

  try {
    const { error } = await supabase
      .from('logs')
      .insert(logsToFlush.map(toDatabase));

    if (error) {
      console.error('Failed to flush logs:', error);
      // Re-queue failed logs (with limit to prevent infinite growth)
      if (logQueue.length < 100) {
        logQueue = [...logsToFlush, ...logQueue];
      }
    }
  } catch (err) {
    console.error('Error flushing logs:', err);
  }
};

// Schedule a flush after interval
const scheduleFlush = () => {
  if (flushTimeout) return;
  flushTimeout = setTimeout(() => {
    flushTimeout = null;
    flushLogs();
  }, FLUSH_INTERVAL);
};

// Add log to queue
const queueLog = (logData) => {
  logQueue.push(logData);

  if (logQueue.length >= BATCH_SIZE) {
    flushLogs();
  } else {
    scheduleFlush();
  }
};

// Context holder (set by AppContext)
let currentContext = {
  userId: null,
  userRole: null,
  branchId: null,
  barberId: null,
};

export const loggingService = {
  LOG_TYPES,

  /**
   * Set the current user context for all logs
   * @param {object} context
   */
  setContext: (context) => {
    currentContext = { ...currentContext, ...context };
  },

  /**
   * Clear the context (on logout)
   */
  clearContext: () => {
    currentContext = {
      userId: null,
      userRole: null,
      branchId: null,
      barberId: null,
    };
  },

  /**
   * Get current context
   */
  getContext: () => ({ ...currentContext }),

  /**
   * Core log method
   * @param {string} level - 'error' | 'warning' | 'info' | 'debug'
   * @param {string} logType - 'error' | 'action' | 'navigation' | 'system' | 'auth'
   * @param {string} message - Log message
   * @param {object} options - Additional options
   */
  log: (level, logType, message, options = {}) => {
    const logData = {
      level,
      logType,
      message,
      userId: options.userId || currentContext.userId,
      userRole: options.userRole || currentContext.userRole,
      branchId: options.branchId || currentContext.branchId,
      barberId: options.barberId || currentContext.barberId,
      entityType: options.entityType,
      entityId: options.entityId,
      action: options.action,
      stackTrace: options.stackTrace,
      metadata: options.metadata,
    };

    // Always log to console in development
    if (import.meta.env.DEV) {
      const consoleMethod =
        level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log';
      console[consoleMethod](`[${level.toUpperCase()}] ${logType}:`, message, options);
    }

    // Queue for batch insert
    queueLog(logData);
  },

  /**
   * Log an error
   * @param {string} message
   * @param {object} options
   */
  error: (message, options = {}) => {
    loggingService.log('error', options.logType || LOG_TYPES.ERROR, message, options);
  },

  /**
   * Log a warning
   * @param {string} message
   * @param {object} options
   */
  warn: (message, options = {}) => {
    loggingService.log('warning', options.logType || LOG_TYPES.SYSTEM, message, options);
  },

  /**
   * Log info
   * @param {string} message
   * @param {object} options
   */
  info: (message, options = {}) => {
    loggingService.log('info', options.logType || LOG_TYPES.SYSTEM, message, options);
  },

  /**
   * Log debug (only in development)
   * @param {string} message
   * @param {object} options
   */
  debug: (message, options = {}) => {
    if (import.meta.env.DEV) {
      loggingService.log('debug', options.logType || LOG_TYPES.SYSTEM, message, options);
    }
  },

  /**
   * Log CRUD actions
   * @param {string} action - 'create' | 'update' | 'delete' | 'view'
   * @param {string} entityType - 'branch' | 'barber' | 'service' | 'booking'
   * @param {string} entityId
   * @param {string} message
   * @param {object} metadata
   */
  logAction: (action, entityType, entityId, message, metadata = {}) => {
    loggingService.log('info', LOG_TYPES.ACTION, message, {
      action,
      entityType,
      entityId,
      metadata,
    });
  },

  /**
   * Log navigation events
   * @param {string} from - Previous path
   * @param {string} to - New path
   */
  logNavigation: (from, to) => {
    loggingService.log('info', LOG_TYPES.NAVIGATION, `Navigated from ${from} to ${to}`, {
      action: 'navigate',
      metadata: { from, to },
    });
  },

  /**
   * Log auth events
   * @param {string} action - 'login' | 'logout' | 'signup'
   * @param {string} userId
   * @param {string} role
   * @param {boolean} success
   * @param {string} error
   */
  logAuth: (action, userId, role, success = true, error = null) => {
    const level = success ? 'info' : 'warning';
    const message = success
      ? `User ${action} successful`
      : `User ${action} failed: ${error}`;

    loggingService.log(level, LOG_TYPES.AUTH, message, {
      action,
      userId,
      userRole: role,
      metadata: { success, error },
    });
  },

  /**
   * Log errors with stack trace
   * @param {Error} error
   * @param {object} context
   */
  logError: (error, context = {}) => {
    const message = error.message || String(error);
    const stackTrace = error.stack || null;

    loggingService.log('error', LOG_TYPES.ERROR, message, {
      ...context,
      stackTrace,
      metadata: {
        ...context.metadata,
        errorName: error.name,
      },
    });
  },

  /**
   * Force flush all queued logs
   */
  flush: flushLogs,

  /**
   * Get logs with filters
   * @param {object} filters
   * @returns {Promise<{logs: Array, total: number}>}
   */
  getAll: async (filters = {}) => {
    let query = supabase.from('logs').select('*', { count: 'exact' });

    if (filters.userId) query = query.eq('user_id', filters.userId);
    if (filters.branchId) query = query.eq('branch_id', filters.branchId);
    if (filters.barberId) query = query.eq('barber_id', filters.barberId);
    if (filters.level) query = query.eq('level', filters.level);
    if (filters.logType) query = query.eq('log_type', filters.logType);
    if (filters.entityType) query = query.eq('entity_type', filters.entityType);
    if (filters.action) query = query.eq('action', filters.action);
    if (filters.startDate) query = query.gte('created_at', filters.startDate);
    if (filters.endDate) query = query.lte('created_at', filters.endDate);
    if (filters.search) {
      query = query.ilike('message', `%${filters.search}%`);
    }

    // Pagination
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      logs: (data || []).map(toFrontend),
      total: count,
    };
  },

  /**
   * Get logs for current user (barber view)
   * @param {object} filters
   * @returns {Promise<{logs: Array, total: number}>}
   */
  getMyLogs: async (filters = {}) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    return loggingService.getAll({ ...filters, userId: user.id });
  },

  /**
   * Get logs for a branch (manager view)
   * @param {string} branchId
   * @param {object} filters
   * @returns {Promise<{logs: Array, total: number}>}
   */
  getBranchLogs: async (branchId, filters = {}) => {
    return loggingService.getAll({ ...filters, branchId });
  },

  /**
   * Get log statistics
   * @param {string} branchId
   * @param {number} days
   * @returns {Promise<object>}
   */
  getStats: async (branchId = null, days = 7) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query = supabase
      .from('logs')
      .select('level, log_type, created_at')
      .gte('created_at', startDate.toISOString());

    if (branchId) query = query.eq('branch_id', branchId);

    const { data, error } = await query;
    if (error) throw error;

    // Aggregate stats
    const stats = {
      total: data.length,
      byLevel: {},
      byType: {},
      byDay: {},
    };

    data.forEach((log) => {
      stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
      stats.byType[log.log_type] = (stats.byType[log.log_type] || 0) + 1;

      const day = log.created_at.split('T')[0];
      stats.byDay[day] = (stats.byDay[day] || 0) + 1;
    });

    return stats;
  },
};

// Flush logs before page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushLogs();
  });

  // Also flush on visibility change (tab becomes hidden)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushLogs();
    }
  });
}

export default loggingService;
