/**
 * Case conversion utilities for transforming between snake_case (DB) and camelCase (frontend)
 */

/**
 * Convert a string from camelCase to snake_case
 * @param {string} str
 * @returns {string}
 */
export const camelToSnake = (str) =>
  str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/**
 * Convert a string from snake_case to camelCase
 * @param {string} str
 * @returns {string}
 */
export const snakeToCamel = (str) =>
  str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

/**
 * Transform an object's keys from snake_case to camelCase
 * Useful for converting DB results to frontend format
 * @param {object} obj - Object with snake_case keys
 * @param {object} customMapping - Optional custom field mappings (dbKey: frontendKey)
 * @returns {object}
 */
export const snakeToCamelObject = (obj, customMapping = {}) => {
  if (!obj || typeof obj !== 'object') return obj;

  const result = {};
  for (const key of Object.keys(obj)) {
    // Check for custom mapping first
    const newKey = customMapping[key] || snakeToCamel(key);
    result[newKey] = obj[key];
  }
  return result;
};

/**
 * Transform an object's keys from camelCase to snake_case
 * Only includes properties that are not undefined
 * Useful for converting frontend data to DB format
 * @param {object} obj - Object with camelCase keys
 * @param {object} customMapping - Optional custom field mappings (frontendKey: dbKey)
 * @returns {object}
 */
export const camelToSnakeObject = (obj, customMapping = {}) => {
  if (!obj || typeof obj !== 'object') return obj;

  const result = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) continue;
    // Check for custom mapping first
    const newKey = customMapping[key] || camelToSnake(key);
    result[newKey] = obj[key];
  }
  return result;
};

/**
 * Create a transformer function with predefined field mappings
 * @param {object} fieldMapping - Mapping of DB fields to frontend fields
 * @returns {{ toFrontend: function, toDatabase: function }}
 */
export const createTransformer = (fieldMapping) => {
  // Build reverse mapping (frontend -> db)
  const reverseMapping = {};
  for (const [dbKey, frontendKey] of Object.entries(fieldMapping)) {
    reverseMapping[frontendKey] = dbKey;
  }

  return {
    /**
     * Convert DB record to frontend format
     * @param {object} dbRecord
     * @returns {object}
     */
    toFrontend: (dbRecord) => {
      if (!dbRecord) return null;
      return snakeToCamelObject(dbRecord, fieldMapping);
    },

    /**
     * Convert frontend data to DB format (only defined properties)
     * @param {object} frontendData
     * @returns {object}
     */
    toDatabase: (frontendData) => {
      if (!frontendData) return {};
      return camelToSnakeObject(frontendData, reverseMapping);
    },
  };
};

export default {
  camelToSnake,
  snakeToCamel,
  snakeToCamelObject,
  camelToSnakeObject,
  createTransformer,
};
