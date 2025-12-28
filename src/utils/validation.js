import { GCC_COUNTRIES } from '../constants/countries';

/**
 * Validate a phone number against country-specific patterns
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
    return { valid: true }; // Allow if country not found
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
 * @param {string} password - The password to validate
 * @returns {{ valid: boolean, error?: string }}
 */
export const validatePassword = (password) => {
  if (!password) {
    return { valid: false, error: 'Password is required' };
  }

  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }

  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }

  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character' };
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
