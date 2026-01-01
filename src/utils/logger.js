/**
 * Secure logging utility for Barber++
 * Only logs in development mode to prevent sensitive data exposure in production
 */

const isDev = import.meta.env.DEV;

/**
 * Logger utility that only outputs in development mode
 * SECURITY: Never logs sensitive data like user IDs, tokens, or personal info in production
 */
export const logger = {
  /**
   * Debug level logging (development only)
   * Use for detailed debugging information
   */
  debug: (...args) => {
    if (isDev) {
      console.log('[DEBUG]', ...args);
    }
  },

  /**
   * Info level logging (development only)
   * Use for general information messages
   */
  info: (...args) => {
    if (isDev) {
      console.info('[INFO]', ...args);
    }
  },

  /**
   * Warning level logging (development only)
   * Use for potential issues that don't break functionality
   */
  warn: (...args) => {
    if (isDev) {
      console.warn('[WARN]', ...args);
    }
  },

  /**
   * Error level logging (development only with full details)
   * Use for errors that need attention
   * SECURITY: Only logs full error details in development
   */
  error: (message, error = null) => {
    if (isDev) {
      console.error('[ERROR]', message, error);
    }
    // In production, errors should be sent to server-side logging
    // via loggingService, not console
  },

  /**
   * Log an action (development only)
   * Use for tracking user actions or system events
   */
  action: (actionName, details = {}) => {
    if (isDev) {
      console.log('[ACTION]', actionName, details);
    }
  },
};

export default logger;
