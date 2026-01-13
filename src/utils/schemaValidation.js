/**
 * Schema Validation Utility
 * SECURITY: Validates data before database operations to prevent invalid/malicious data
 */

// UUID v4 pattern
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Date pattern (YYYY-MM-DD)
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Time pattern (HH:MM or HH:MM:SS)
const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * Validate a value against a type
 * @param {*} value - The value to validate
 * @param {string} type - The expected type
 * @returns {boolean}
 */
const validateType = (value, type) => {
  if (value === null || value === undefined) {
    return false;
  }

  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'uuid':
      return typeof value === 'string' && UUID_PATTERN.test(value);
    case 'date':
      return typeof value === 'string' && DATE_PATTERN.test(value);
    case 'time':
      return typeof value === 'string' && TIME_PATTERN.test(value);
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    case 'email':
      return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case 'phone':
      return typeof value === 'string' && /^\d{6,15}$/.test(value.replace(/[\s-]/g, ''));
    default:
      return true; // Unknown type, allow
  }
};

/**
 * Validate data against a schema
 * @param {Object} data - The data object to validate
 * @param {Object} schema - The validation schema
 * @param {string[]} schema.required - Required field names
 * @param {Object} schema.types - Field type mappings { fieldName: 'type' }
 * @param {Object} schema.constraints - Additional constraints { fieldName: { min, max, pattern, enum } }
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateSchema = (data, schema) => {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Data must be an object'] };
  }

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      const value = data[field];
      if (value === null || value === undefined || value === '') {
        errors.push(`${field} is required`);
      }
    }
  }

  // Check types
  if (schema.types) {
    for (const [field, type] of Object.entries(schema.types)) {
      const value = data[field];
      // Skip undefined/null for optional fields (required check handles them)
      if (value !== null && value !== undefined && value !== '') {
        if (!validateType(value, type)) {
          errors.push(`${field} must be a valid ${type}`);
        }
      }
    }
  }

  // Check constraints
  if (schema.constraints) {
    for (const [field, constraint] of Object.entries(schema.constraints)) {
      const value = data[field];
      if (value !== null && value !== undefined) {
        // Min length/value
        if (constraint.min !== undefined) {
          if (typeof value === 'string' && value.length < constraint.min) {
            errors.push(`${field} must be at least ${constraint.min} characters`);
          } else if (typeof value === 'number' && value < constraint.min) {
            errors.push(`${field} must be at least ${constraint.min}`);
          }
        }

        // Max length/value
        if (constraint.max !== undefined) {
          if (typeof value === 'string' && value.length > constraint.max) {
            errors.push(`${field} cannot exceed ${constraint.max} characters`);
          } else if (typeof value === 'number' && value > constraint.max) {
            errors.push(`${field} cannot exceed ${constraint.max}`);
          }
        }

        // Pattern
        if (constraint.pattern && typeof value === 'string') {
          const regex = new RegExp(constraint.pattern);
          if (!regex.test(value)) {
            errors.push(`${field} format is invalid`);
          }
        }

        // Enum (allowed values)
        if (constraint.enum && !constraint.enum.includes(value)) {
          errors.push(`${field} must be one of: ${constraint.enum.join(', ')}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

// ============================================================
// Pre-defined Schemas for Common Entities
// ============================================================

export const bookingSchema = {
  required: ['branchId', 'barberId', 'date', 'time', 'duration'],
  types: {
    branchId: 'uuid',
    barberId: 'uuid',
    customerId: 'uuid',
    date: 'date',
    time: 'time',
    duration: 'number',
    price: 'number',
    status: 'string',
    notes: 'string',
    serviceIds: 'array',
  },
  constraints: {
    duration: { min: 5, max: 480 }, // 5 min to 8 hours
    price: { min: 0, max: 10000 },
    notes: { max: 1000 },
    status: { enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'] },
  },
};

/**
 * Validate booking data
 * @param {Object} data - Booking data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateBooking = (data) => validateSchema(data, bookingSchema);
