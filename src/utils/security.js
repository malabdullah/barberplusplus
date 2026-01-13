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

// ===========================
// PII REDACTION FUNCTIONS
// ===========================

/**
 * Redact email address for export/display
 * Shows first 2 characters + domain
 * @param {string} email - Email to redact
 * @returns {string} - Redacted email (e.g., "jo***@example.com")
 */
export const redactEmail = (email) => {
  if (!email || typeof email !== 'string') return '';

  const atIndex = email.indexOf('@');
  if (atIndex === -1) return '***';

  const localPart = email.substring(0, atIndex);
  const domain = email.substring(atIndex);

  if (localPart.length <= 2) {
    return `${localPart[0] || '*'}***${domain}`;
  }

  return `${localPart.substring(0, 2)}***${domain}`;
};

/**
 * Redact phone number for export/display
 * Shows only last 4 digits
 * @param {string} phone - Phone number to redact
 * @returns {string} - Redacted phone (e.g., "***-***-1234")
 */
export const redactPhone = (phone) => {
  if (!phone || typeof phone !== 'string') return '';

  // Remove non-digits to get just the number
  const digits = phone.replace(/\D/g, '');

  if (digits.length < 4) return '****';

  // Show last 4 digits only
  return `***-***-${digits.slice(-4)}`;
};

/**
 * Redact IP address for export/display
 * Shows first 3 octets with last octet masked
 * @param {string} ip - IP address to redact
 * @returns {string} - Redacted IP (e.g., "192.168.1.xxx")
 */
export const redactIP = (ip) => {
  if (!ip || typeof ip !== 'string') return '';

  // Handle IPv4
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/);
  if (ipv4Match) {
    return `${ipv4Match[1]}.${ipv4Match[2]}.${ipv4Match[3]}.xxx`;
  }

  // Handle IPv6 (just mask last segment)
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length > 1) {
      return parts.slice(0, -1).join(':') + ':xxxx';
    }
  }

  return '***';
};

/**
 * Redact name (show first letter + asterisks)
 * @param {string} name - Name to redact
 * @returns {string} - Redacted name (e.g., "J*** D***")
 */
export const redactName = (name) => {
  if (!name || typeof name !== 'string') return '';

  return name.split(' ').map(part => {
    if (part.length === 0) return '';
    if (part.length === 1) return part[0];
    return part[0] + '***';
  }).join(' ');
};

/**
 * Redact PII from an object based on field names
 * Automatically detects and redacts common PII fields
 * @param {object} obj - Object with potential PII
 * @returns {object} - Object with redacted PII
 */
export const redactPII = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;

  const result = { ...obj };

  // Field names that contain emails
  const emailFields = ['email', 'mail', 'emailAddress', 'userEmail'];
  // Field names that contain phone numbers
  const phoneFields = ['phone', 'phoneNumber', 'mobile', 'cell', 'telephone'];
  // Field names that contain IP addresses
  const ipFields = ['ip', 'ipAddress', 'ip_address', 'clientIp', 'client_ip'];
  // Field names that contain names
  const nameFields = ['name', 'firstName', 'lastName', 'fullName', 'customerName', 'customer_name'];

  for (const key of Object.keys(result)) {
    const lowerKey = key.toLowerCase();

    if (emailFields.some(f => lowerKey.includes(f.toLowerCase()))) {
      result[key] = redactEmail(result[key]);
    } else if (phoneFields.some(f => lowerKey.includes(f.toLowerCase()))) {
      result[key] = redactPhone(result[key]);
    } else if (ipFields.some(f => lowerKey.includes(f.toLowerCase()))) {
      result[key] = redactIP(result[key]);
    } else if (nameFields.some(f => lowerKey === f.toLowerCase())) {
      // Only redact exact name field matches to avoid over-redacting
      result[key] = redactName(result[key]);
    } else if (typeof result[key] === 'object' && result[key] !== null) {
      // Recursively redact nested objects
      result[key] = redactPII(result[key]);
    }
  }

  return result;
};

export default {
  escapeLikeWildcards,
  sanitizeForCSV,
  sanitizeUUID,
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
  redactEmail,
  redactPhone,
  redactIP,
  redactName,
  redactPII,
};
