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
