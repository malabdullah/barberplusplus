/**
 * Consolidated date helper functions
 * Used across admin.service.js, bookings.service.js, AppContext.jsx,
 * availabilityFiltering.js, and bookingConflicts.js
 */

/**
 * Get today's date as ISO string (YYYY-MM-DD)
 * @returns {string}
 */
export const getToday = () => new Date().toISOString().split('T')[0];

/**
 * Get the start of the current week (Monday) as ISO string
 * @returns {string}
 */
export const getWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.getFullYear(), now.getMonth(), diff).toISOString().split('T')[0];
};

/**
 * Get the end of the current week (Sunday) as ISO string
 * @returns {string}
 */
export const getWeekEnd = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? 0 : 7);
  return new Date(now.getFullYear(), now.getMonth(), diff).toISOString().split('T')[0];
};

/**
 * Convert time string (HH:MM) to minutes since midnight
 * @param {string} timeStr - Time in HH:MM format
 * @returns {number} Minutes since midnight
 */
export const toMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * Convert minutes since midnight to time string (HH:MM)
 * @param {number} minutes - Minutes since midnight
 * @returns {string} Time in HH:MM format
 */
export const fromMinutes = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};
