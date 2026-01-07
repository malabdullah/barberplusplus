/**
 * Security utility functions for input sanitization and validation
 * These functions help prevent common security vulnerabilities like
 * SQL injection, XSS, and CSV injection.
 */

/**
 * Escape special characters used in SQL LIKE patterns
 * Prevents LIKE wildcard injection attacks that could enumerate data
 * @param {string} input - User input to escape
 * @returns {string} - Escaped string safe for LIKE queries
 */
export const escapeLikeWildcards = (input) => {
  if (!input || typeof input !== 'string') return input;
  // Escape backslash first (since it's the escape char), then % and _
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
};

/**
 * Sanitize a value for safe CSV export
 * Prevents CSV injection attacks where cell values starting with =, +, -, @
 * could be interpreted as formulas by spreadsheet applications
 * @param {any} value - Value to sanitize
 * @returns {string} - Sanitized string safe for CSV
 */
export const sanitizeForCSV = (value) => {
  if (value === null || value === undefined) return '';

  const stringValue = String(value);

  // Characters that trigger formula interpretation in Excel/Google Sheets
  const dangerousChars = ['=', '+', '-', '@', '\t', '\r', '\n'];

  // If starts with a dangerous character, prefix with single quote
  if (dangerousChars.some(char => stringValue.startsWith(char))) {
    return `'${stringValue}`;
  }

  // Escape double quotes by doubling them (CSV standard)
  if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
};

/**
 * Sanitize an entire row of values for CSV export
 * @param {Array} row - Array of values to sanitize
 * @returns {Array} - Array of sanitized values
 */
export const sanitizeCSVRow = (row) => {
  if (!Array.isArray(row)) return [];
  return row.map(sanitizeForCSV);
};

/**
 * Convert an array of rows to a safe CSV string
 * @param {Array} headers - Array of header strings
 * @param {Array} rows - Array of row arrays
 * @returns {string} - Safe CSV string
 */
export const toSafeCSV = (headers, rows) => {
  const sanitizedHeaders = sanitizeCSVRow(headers);
  const sanitizedRows = rows.map(sanitizeCSVRow);

  return [
    sanitizedHeaders.join(','),
    ...sanitizedRows.map(row => row.join(','))
  ].join('\n');
};

/**
 * Validate and sanitize a UUID string
 * @param {string} uuid - UUID to validate
 * @returns {string|null} - Valid UUID or null
 */
export const sanitizeUUID = (uuid) => {
  if (!uuid || typeof uuid !== 'string') return null;

  // UUID v4 regex pattern
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const trimmed = uuid.trim().toLowerCase();
  return uuidRegex.test(trimmed) ? trimmed : null;
};

/**
 * Sanitize a string for safe use in Supabase filters
 * Removes any characters that could be used for filter injection
 * @param {string} input - Input string
 * @returns {string} - Sanitized string
 */
export const sanitizeFilterValue = (input) => {
  if (!input || typeof input !== 'string') return input;

  // Remove characters that could break out of Supabase filter syntax
  // Keep only alphanumeric, spaces, and common punctuation
  return input.replace(/[^a-zA-Z0-9\s\-_@.]/g, '');
};

/**
 * Check if a string contains potentially malicious patterns
 * @param {string} input - Input to check
 * @returns {boolean} - True if suspicious patterns found
 */
export const hasSuspiciousPatterns = (input) => {
  if (!input || typeof input !== 'string') return false;

  const suspiciousPatterns = [
    /(\bOR\b|\bAND\b|\bUNION\b|\bSELECT\b|\bDROP\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b)/i,
    /--/, // SQL comment
    /;/, // Statement terminator
    /\/\*/, // Block comment start
    /\*\//, // Block comment end
    /<script/i, // XSS attempt
    /javascript:/i, // JavaScript protocol
    /on\w+=/i, // Event handlers
  ];

  return suspiciousPatterns.some(pattern => pattern.test(input));
};

/**
 * Log errors only in development mode
 * In production, errors should be logged to a proper monitoring service
 * @param {string} message - Error message
 * @param {Error|any} error - Error object
 */
export const logErrorDev = (message, error) => {
  if (import.meta.env.DEV) {
    console.error(message, error);
  }
  // In production, errors are silently swallowed by the service layer
  // The actual error handling is done by throwing to the caller
};

/**
 * Rate limiter for preventing brute force attacks
 * Uses exponential backoff with configurable parameters
 */
const rateLimitStore = new Map();

/**
 * Create a rate limiter for a specific action
 * @param {string} key - Unique key for the action (e.g., 'login', 'signup')
 * @param {number} maxAttempts - Maximum attempts before lockout
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} lockoutMs - Lockout duration in milliseconds
 * @returns {object} - Rate limiter object with check and reset methods
 */
export const createRateLimiter = (key, maxAttempts = 5, windowMs = 60000, lockoutMs = 300000) => {
  return {
    /**
     * Check if action is rate limited
     * @param {string} identifier - Unique identifier (e.g., email, IP)
     * @returns {{ allowed: boolean, remainingAttempts: number, retryAfter: number | null }}
     */
    check: (identifier) => {
      const storeKey = `${key}:${identifier}`;
      const now = Date.now();
      let record = rateLimitStore.get(storeKey);

      // Clean up expired records
      if (record && record.windowStart + windowMs < now && !record.lockedUntil) {
        record = null;
        rateLimitStore.delete(storeKey);
      }

      // Check if locked out
      if (record?.lockedUntil) {
        if (record.lockedUntil > now) {
          return {
            allowed: false,
            remainingAttempts: 0,
            retryAfter: Math.ceil((record.lockedUntil - now) / 1000),
          };
        }
        // Lockout expired, reset
        rateLimitStore.delete(storeKey);
        record = null;
      }

      // Initialize or update record
      if (!record) {
        record = { attempts: 0, windowStart: now, lockedUntil: null };
      }

      record.attempts++;

      if (record.attempts > maxAttempts) {
        record.lockedUntil = now + lockoutMs;
        rateLimitStore.set(storeKey, record);
        return {
          allowed: false,
          remainingAttempts: 0,
          retryAfter: Math.ceil(lockoutMs / 1000),
        };
      }

      rateLimitStore.set(storeKey, record);
      return {
        allowed: true,
        remainingAttempts: maxAttempts - record.attempts,
        retryAfter: null,
      };
    },

    /**
     * Reset rate limit for identifier (on successful action)
     * @param {string} identifier - Unique identifier
     */
    reset: (identifier) => {
      const storeKey = `${key}:${identifier}`;
      rateLimitStore.delete(storeKey);
    },
  };
};

// Pre-configured rate limiters for common actions
export const authRateLimiter = createRateLimiter('auth', 5, 60000, 300000); // 5 attempts per minute, 5min lockout
export const signupRateLimiter = createRateLimiter('signup', 3, 3600000, 3600000); // 3 per hour
export const passwordResetRateLimiter = createRateLimiter('password-reset', 3, 3600000, 3600000); // 3 per hour
export const apiRateLimiter = createRateLimiter('api', 100, 60000, 60000); // 100 per minute

/**
 * Validate user role from JWT metadata
 * @param {string} role - Role from user_metadata
 * @returns {{ valid: boolean, role: string | null, error: string | null }}
 */
export const validateUserRole = (role) => {
  const validRoles = ['admin', 'manager', 'barber', 'agent'];

  if (!role || typeof role !== 'string') {
    return { valid: false, role: null, error: 'Missing or invalid role' };
  }

  const normalizedRole = role.toLowerCase().trim();

  if (!validRoles.includes(normalizedRole)) {
    return { valid: false, role: null, error: `Invalid role: ${role}` };
  }

  return { valid: true, role: normalizedRole, error: null };
};

/**
 * Validate and sanitize redirect URL
 * Only allows same-origin redirects to prevent open redirect vulnerabilities
 * @param {string} url - URL to validate
 * @returns {string} - Safe redirect URL
 */
export const validateRedirectUrl = (url) => {
  const allowedOrigin = window.location.origin;

  try {
    const parsed = new URL(url, allowedOrigin);
    // Only allow same-origin redirects
    if (parsed.origin !== allowedOrigin) {
      return allowedOrigin;
    }
    return parsed.href;
  } catch {
    return allowedOrigin;
  }
};

/**
 * Sanitize URL for logging - strip sensitive query parameters
 * @param {string} url - Full URL
 * @returns {string} - Sanitized URL without sensitive params
 */
export const sanitizeUrlForLogging = (url) => {
  if (!url || typeof url !== 'string') return '';

  try {
    const parsed = new URL(url);
    // Only keep pathname, remove query params and hash
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // If URL parsing fails, return just the path before any ? or #
    return url.split('?')[0].split('#')[0];
  }
};

/**
 * Hash or anonymize user agent for privacy
 * @param {string} userAgent - Full user agent string
 * @returns {string} - Anonymized user agent
 */
export const anonymizeUserAgent = (userAgent) => {
  if (!userAgent || typeof userAgent !== 'string') return 'unknown';

  // Extract just browser and OS info, remove version details
  const patterns = [
    { regex: /Chrome\/[\d.]+/, replace: 'Chrome' },
    { regex: /Firefox\/[\d.]+/, replace: 'Firefox' },
    { regex: /Safari\/[\d.]+/, replace: 'Safari' },
    { regex: /Edge\/[\d.]+/, replace: 'Edge' },
    { regex: /Windows NT [\d.]+/, replace: 'Windows' },
    { regex: /Mac OS X [\d_.]+/, replace: 'macOS' },
    { regex: /Linux/, replace: 'Linux' },
    { regex: /Android [\d.]+/, replace: 'Android' },
    { regex: /iPhone OS [\d_]+/, replace: 'iOS' },
  ];

  let simplified = userAgent;
  for (const { regex, replace } of patterns) {
    simplified = simplified.replace(regex, replace);
  }

  // Extract key components only
  const browser = simplified.match(/(Chrome|Firefox|Safari|Edge|Opera)/)?.[0] || 'Unknown';
  const os = simplified.match(/(Windows|macOS|Linux|Android|iOS)/)?.[0] || 'Unknown';

  return `${browser}/${os}`;
};

export default {
  escapeLikeWildcards,
  sanitizeForCSV,
  sanitizeCSVRow,
  toSafeCSV,
  sanitizeUUID,
  sanitizeFilterValue,
  hasSuspiciousPatterns,
  logErrorDev,
  createRateLimiter,
  authRateLimiter,
  signupRateLimiter,
  passwordResetRateLimiter,
  apiRateLimiter,
  validateUserRole,
  validateRedirectUrl,
  sanitizeUrlForLogging,
  anonymizeUserAgent,
};
