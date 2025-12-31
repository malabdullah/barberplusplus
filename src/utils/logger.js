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
   * Warning level logging (always shown)
   * Use for potential issues that don't break functionality
   */
  warn: (...args) => {
    console.warn('[WARN]', ...args);
  },

  /**
   * Error level logging (always shown, but sanitized)
   * Use for errors that need attention
   * SECURITY: Do not include sensitive data in error messages
   */
  error: (message, error = null) => {
    // In production, only log the message without stack traces
    if (isDev) {
      console.error('[ERROR]', message, error);
    } else {
      // In production, log only the error message without details
      console.error('[ERROR]', message);
    }
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
