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

export default {
  escapeLikeWildcards,
  sanitizeForCSV,
  sanitizeCSVRow,
  toSafeCSV,
  sanitizeUUID,
  sanitizeFilterValue,
  hasSuspiciousPatterns,
  logErrorDev,
};
