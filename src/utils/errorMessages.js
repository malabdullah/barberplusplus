/**
 * Error message mapping utility
 * Maps Supabase/database error codes to user-friendly messages
 * Prevents sensitive information from leaking to users
 */

// Common Supabase/PostgreSQL error patterns
const ERROR_PATTERNS = {
  // Authentication errors
  'Invalid login credentials': 'auth.invalidCredentials',
  'Email not confirmed': 'auth.emailNotConfirmed',
  'User already registered': 'auth.userExists',
  'Password should be at least': 'auth.passwordTooWeak',
  'Email rate limit exceeded': 'auth.rateLimitExceeded',
  'invalid_grant': 'auth.invalidCredentials',
  'user_not_found': 'auth.userNotFound',

  // Database constraint errors
  'duplicate key': 'errors.duplicateEntry',
  'unique constraint': 'errors.duplicateEntry',
  'foreign key constraint': 'errors.referenceError',
  'not-null constraint': 'errors.missingRequired',
  'check constraint': 'errors.invalidData',

  // Network/connection errors
  'Failed to fetch': 'errors.networkError',
  'NetworkError': 'errors.networkError',
  'network request failed': 'errors.networkError',
  'ECONNREFUSED': 'errors.serverUnavailable',
  'timeout': 'errors.timeout',

  // RLS/Permission errors
  'new row violates row-level security': 'errors.permissionDenied',
  'permission denied': 'errors.permissionDenied',
  'JWT expired': 'auth.sessionExpired',
  'invalid JWT': 'auth.sessionInvalid',

  // Storage errors
  'Bucket not found': 'errors.storageError',
  'Object not found': 'errors.fileNotFound',
  'Payload too large': 'errors.fileTooLarge',
  'Invalid file type': 'errors.invalidFileType',
};

// Default fallback messages by error type
const DEFAULT_MESSAGES = {
  auth: 'auth.genericError',
  database: 'errors.databaseError',
  network: 'errors.networkError',
  storage: 'errors.storageError',
  unknown: 'errors.generic',
};

/**
 * Get a user-friendly error message translation key
 * @param {Error|string} error - The error object or message
 * @param {string} context - Optional context (auth, database, etc.)
 * @returns {string} Translation key for the error message
 */
export const getErrorKey = (error, context = 'unknown') => {
  const errorMessage = typeof error === 'string' ? error : error?.message || '';

  // Check for known error patterns
  for (const [pattern, key] of Object.entries(ERROR_PATTERNS)) {
    if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
      return key;
    }
  }

  // Check for Supabase error codes
  if (error?.code) {
    const codePatterns = {
      '23505': 'errors.duplicateEntry', // unique_violation
      '23503': 'errors.referenceError', // foreign_key_violation
      '23502': 'errors.missingRequired', // not_null_violation
      '42501': 'errors.permissionDenied', // insufficient_privilege
      'PGRST': 'errors.databaseError', // PostgREST errors
    };

    for (const [code, key] of Object.entries(codePatterns)) {
      if (error.code.toString().includes(code)) {
        return key;
      }
    }
  }

  // Return default message based on context
  return DEFAULT_MESSAGES[context] || DEFAULT_MESSAGES.unknown;
};

/**
 * Get a user-friendly error message (direct string, not translation key)
 * Use this when translation is not available
 * @param {Error|string} error - The error object or message
 * @param {string} fallback - Fallback message if no match found
 * @returns {string} User-friendly error message
 */
export const getErrorMessage = (error, fallback = 'An error occurred. Please try again.') => {
  const errorMessage = typeof error === 'string' ? error : error?.message || '';

  // Direct message mappings for non-i18n contexts
  const directMappings = {
    'Invalid login credentials': 'Invalid email or password',
    'Email not confirmed': 'Please verify your email address',
    'User already registered': 'An account with this email already exists',
    'duplicate key': 'This record already exists',
    'Failed to fetch': 'Unable to connect. Please check your internet connection.',
    'JWT expired': 'Your session has expired. Please log in again.',
    'permission denied': 'You do not have permission to perform this action.',
    'Too many login attempts': 'Too many login attempts',
    'Too many signup attempts': 'Too many signup attempts',
    'Too many reset attempts': 'Too many reset attempts',
    'Account has invalid role': 'Account configuration error. Please contact support.',
  };

  for (const [pattern, message] of Object.entries(directMappings)) {
    if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
      return message;
    }
  }

  return fallback;
};

/**
 * Log error safely (strips sensitive information)
 * @param {Error} error - The error to log
 * @param {string} context - Context for the error
 */
export const logErrorSafely = (error, context = '') => {
  if (import.meta.env.DEV) {
    console.error(`[${context}]`, error);
  }
  // In production, we only log non-sensitive details
  // Full errors should go to server-side logging
};

export default {
  getErrorKey,
  getErrorMessage,
  logErrorSafely,
};
