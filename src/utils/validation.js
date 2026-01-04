import { GCC_COUNTRIES } from '../constants/countries';

// SECURITY: Common passwords to reject (top 100 most common)
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789',
  '1234567890', 'qwerty', 'qwerty123', 'abc123', 'letmein', 'welcome',
  'monkey', 'dragon', 'master', 'admin', 'login', 'sunshine', 'princess',
  'football', 'baseball', 'iloveyou', 'trustno1', 'password1!', 'changeme',
  'passw0rd', 'p@ssword', 'p@ssw0rd', 'welcome1', 'welcome123', 'admin123',
  'admin1234', 'root', 'toor', 'guest', 'test', 'test123', 'demo', 'demo123',
]);

/**
 * Validate a phone number against country-specific patterns
 * SECURITY: Rejects unknown countries instead of allowing them
 * @param {string} phone - The phone number to validate
 * @param {string} countryCode - The country dialing code (e.g., '+965')
 * @returns {{ valid: boolean, error?: string }}
 */
export const validatePhoneNumber = (phone, countryCode) => {
  if (!phone || !phone.trim()) {
    return { valid: false, error: 'Phone number is required' };
  }

  const country = GCC_COUNTRIES.find(c => c.code === countryCode);
  if (!country) {
    // SECURITY: Reject unknown country codes instead of allowing
    return { valid: false, error: 'Please select a valid country code' };
  }

  const cleanPhone = phone.replace(/\s/g, '');
  if (!country.pattern.test(cleanPhone)) {
    const countryName = country.label.split(' ')[0];
    return { valid: false, error: `Invalid ${countryName} phone number` };
  }

  return { valid: true };
};

/**
 * Validate an email address using RFC 5322 simplified pattern
 * @param {string} email - The email to validate
 * @returns {{ valid: boolean, error?: string }}
 */
export const validateEmail = (email) => {
  if (!email || !email.trim()) {
    return { valid: false, error: 'Email is required' };
  }

  // RFC 5322 simplified pattern
  const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  if (!emailPattern.test(email)) {
    return { valid: false, error: 'Please enter a valid email address' };
  }

  return { valid: true };
};

/**
 * Validate password strength
 * SECURITY: Uses OWASP recommendations (12+ chars, common password blacklist)
 * @param {string} password - The password to validate
 * @returns {{ valid: boolean, error?: string, message?: string }}
 */
export const validatePassword = (password) => {
  if (!password) {
    return { valid: false, error: 'Password is required', message: 'Password is required' };
  }

  // SECURITY: Increased to 12 characters per OWASP guidelines
  if (password.length < 12) {
    return { valid: false, error: 'Password must be at least 12 characters', message: 'Password must be at least 12 characters' };
  }

  // SECURITY: Check against common passwords
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, error: 'This password is too common. Please choose a stronger password.', message: 'This password is too common. Please choose a stronger password.' };
  }

  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter', message: 'Password must contain at least one uppercase letter' };
  }

  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter', message: 'Password must contain at least one lowercase letter' };
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number', message: 'Password must contain at least one number' };
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character', message: 'Password must contain at least one special character' };
  }

  return { valid: true };
};

/**
 * Validate a required field
 * @param {string} value - The value to validate
 * @param {string} fieldName - The field name for error message
 * @returns {{ valid: boolean, error?: string }}
 */
export const validateRequired = (value, fieldName = 'This field') => {
  if (!value || (typeof value === 'string' && !value.trim())) {
    return { valid: false, error: `${fieldName} is required` };
  }
  return { valid: true };
};

/**
 * Validate an array has at least one item
 * @param {Array} arr - The array to validate
 * @param {string} fieldName - The field name for error message
 * @returns {{ valid: boolean, error?: string }}
 */
export const validateArrayNotEmpty = (arr, fieldName = 'Selection') => {
  if (!arr || !Array.isArray(arr) || arr.length === 0) {
    return { valid: false, error: `Please select at least one ${fieldName.toLowerCase()}` };
  }
  return { valid: true };
};

/**
 * Validate a URL (http/https only)
 * @param {string} url - The URL to validate
 * @param {boolean} required - Whether the field is required
 * @returns {{ valid: boolean, error?: string }}
 */
export const validateUrl = (url, required = false) => {
  if (!url || !url.trim()) {
    if (required) {
      return { valid: false, error: 'URL is required' };
    }
    return { valid: true }; // Empty is OK if not required
  }

  try {
    const parsed = new URL(url);
    // Only allow http and https protocols (prevent javascript:, data:, etc.)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use http or https protocol' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Please enter a valid URL' };
  }
};

/**
 * Validate a text field with length limits
 * @param {string} text - The text to validate
 * @param {Object} options - Validation options
 * @param {number} options.minLength - Minimum length (default: 0)
 * @param {number} options.maxLength - Maximum length (default: 500)
 * @param {boolean} options.required - Whether field is required
 * @param {string} options.fieldName - Field name for error messages
 * @returns {{ valid: boolean, error?: string }}
 */
export const validateText = (text, options = {}) => {
  const {
    minLength = 0,
    maxLength = 500,
    required = false,
    fieldName = 'This field',
  } = options;

  if (!text || !text.trim()) {
    if (required) {
      return { valid: false, error: `${fieldName} is required` };
    }
    return { valid: true };
  }

  const trimmed = text.trim();

  if (trimmed.length < minLength) {
    return { valid: false, error: `${fieldName} must be at least ${minLength} characters` };
  }

  if (trimmed.length > maxLength) {
    return { valid: false, error: `${fieldName} cannot exceed ${maxLength} characters` };
  }

  return { valid: true };
};

/**
 * Validate a name field (letters, spaces, hyphens, apostrophes only)
 * @param {string} name - The name to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.required - Whether field is required
 * @param {number} options.maxLength - Maximum length (default: 100)
 * @param {string} options.fieldName - Field name for error messages
 * @returns {{ valid: boolean, error?: string }}
 */
export const validateName = (name, options = {}) => {
  const { required = false, maxLength = 100, fieldName = 'Name' } = options;

  if (!name || !name.trim()) {
    if (required) {
      return { valid: false, error: `${fieldName} is required` };
    }
    return { valid: true };
  }

  const trimmed = name.trim();

  if (trimmed.length > maxLength) {
    return { valid: false, error: `${fieldName} cannot exceed ${maxLength} characters` };
  }

  // Allow letters (including Arabic/international), spaces, hyphens, apostrophes
  // eslint-disable-next-line no-misleading-character-class
  if (!/^[\p{L}\s'\-]+$/u.test(trimmed)) {
    return { valid: false, error: `${fieldName} contains invalid characters` };
  }

  return { valid: true };
};

/**
 * Sanitize a string by removing potentially dangerous characters
 * @param {string} input - The string to sanitize
 * @returns {string} - Sanitized string
 */
export const sanitizeString = (input) => {
  if (!input || typeof input !== 'string') return '';
  // Remove HTML tags and potentially dangerous characters
  return input
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>'"&]/g, '') // Remove special HTML chars
    .trim();
};
