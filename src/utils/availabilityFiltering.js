/**
 * Availability filtering utilities for booking form
 * Provides proactive date and time slot filtering based on barber availability
 */

import { addDays, format, parseISO, isBefore, isAfter } from 'date-fns';
import { TIME_SLOTS } from '../constants/time';

// Map JavaScript getDay() (0=Sunday) to day keys
const JS_DAY_TO_KEY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Convert time string "HH:MM" to minutes since midnight
 * @param {string} time - Time in "HH:MM" format
 * @returns {number} Minutes since midnight
 */
export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Check if two time ranges overlap
 * @param {string} start1 - Start time "HH:MM"
 * @param {number} duration1 - Duration in minutes
 * @param {string} start2 - Start time "HH:MM"
 * @param {number} duration2 - Duration in minutes
 * @returns {boolean}
 */
function timeRangesOverlap(start1, duration1, start2, duration2) {
  const s1 = toMinutes(start1);
  const e1 = s1 + duration1;
  const s2 = toMinutes(start2);
  const e2 = s2 + duration2;
  return s1 < e2 && s2 < e1;
}

/**
 * Check if a date falls within any vacation period
 * @param {string} date - Date string "YYYY-MM-DD"
 * @param {Array} vacations - Array of vacation objects with startDate/endDate
 * @returns {boolean}
 */
function isDateOnVacation(date, vacations = []) {
  if (!vacations.length) return false;

  const dateObj = parseISO(date);

  return vacations.some(v => {
    const start = parseISO(v.startDate);
    const end = parseISO(v.endDate);
    return dateObj >= start && dateObj <= end;
  });
}

/**
 * Get the day key for a given date
 * @param {string} date - Date string "YYYY-MM-DD"
 * @returns {string} Day key (e.g., 'monday', 'tuesday')
 */
function getDayKey(date) {
  const dateObj = parseISO(date);
  return JS_DAY_TO_KEY[dateObj.getDay()];
}

/**
 * Check if a specific day of week is a working day
 * @param {string} date - Date string "YYYY-MM-DD"
 * @param {Object} availability - Weekly availability schedule
 * @returns {boolean}
 */
function isDayEnabled(date, availability) {
  if (!availability) return true;

  const dayKey = getDayKey(date);
  const daySchedule = availability[dayKey];

  return daySchedule?.enabled ?? daySchedule?.available ?? false;
}

/**
 * Get working hours for a specific date
 * @param {string} date - Date string "YYYY-MM-DD"
 * @param {Object} availability - Weekly availability schedule
 * @returns {{ start: string, end: string } | null}
 */
function getWorkingHours(date, availability) {
  if (!availability) return { start: '07:00', end: '21:00' };

  const dayKey = getDayKey(date);
  const daySchedule = availability[dayKey];

  if (!daySchedule?.enabled && !daySchedule?.available) {
    return null;
  }

  return {
    start: daySchedule.start || '09:00',
    end: daySchedule.end || '18:00'
  };
}

/**
 * Get time-offs that apply to a specific date
 * @param {string} date - Date string "YYYY-MM-DD"
 * @param {Array} timeOffs - Array of time-off objects
 * @returns {Array}
 */
function getTimeOffsForDate(date, timeOffs = []) {
  if (!timeOffs.length) return [];

  const dayKey = getDayKey(date);

  return timeOffs.filter(t => {
    // One-time time-off on this specific date
    if (t.type === 'one-time' && t.date === date) return true;
    // Recurring time-off on this day of week
    if (t.type === 'recurring' && t.day === dayKey) return true;
    return false;
  });
}

/**
 * Get availability status for a specific date
 * @param {string} date - Date string "YYYY-MM-DD"
 * @param {Object} barberData - Barber object with availability, vacations, maxBookingDays
 * @returns {{ available: boolean, reason: string | null }}
 */
export function getDateAvailability(date, barberData) {
  if (!barberData) return { available: true, reason: null };

  const { availability, vacations, maxBookingDays = 30 } = barberData;
  const dateObj = parseISO(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if date is in the past
  if (isBefore(dateObj, today)) {
    return { available: false, reason: 'pastDate' };
  }

  // Check max booking window
  const maxDate = addDays(today, maxBookingDays);
  if (isAfter(dateObj, maxDate)) {
    return { available: false, reason: 'beyondBookingWindow' };
  }

  // Check if on vacation
  if (isDateOnVacation(date, vacations)) {
    return { available: false, reason: 'onVacation' };
  }

  // Check if day is enabled (not a regular day off)
  if (!isDayEnabled(date, availability)) {
    return { available: false, reason: 'dayOff' };
  }

  return { available: true, reason: null };
}

/**
 * Get availability status for a specific time slot
 * @param {Object} params
 * @param {string} params.slot - Time slot "HH:MM"
 * @param {string} params.date - Date string "YYYY-MM-DD"
 * @param {number} params.duration - Booking duration in minutes
 * @param {Object} params.barberData - Barber object
 * @param {Array} params.existingBookings - Existing bookings
 * @param {string} [params.editingBookingId] - ID of booking being edited
 * @returns {{ available: boolean, reason: string | null }}
 */
export function getTimeSlotAvailability({
  slot,
  date,
  duration,
  barberData,
  existingBookings = [],
  editingBookingId = null
}) {
  const workingHours = getWorkingHours(date, barberData?.availability);

  // Day is not enabled
  if (!workingHours) {
    return { available: false, reason: 'dayOff' };
  }

  const slotMins = toMinutes(slot);
  const slotEndMins = slotMins + duration;
  const workStart = toMinutes(workingHours.start);
  const workEnd = toMinutes(workingHours.end);

  // Before working hours
  if (slotMins < workStart) {
    return { available: false, reason: 'beforeWorkingHours' };
  }

  // After working hours (slot end exceeds work end)
  if (slotEndMins > workEnd) {
    return { available: false, reason: 'afterWorkingHours' };
  }

  // Check time-offs
  const applicableTimeOffs = getTimeOffsForDate(date, barberData?.timeOffs);
  for (const timeOff of applicableTimeOffs) {
    const timeOffDuration = toMinutes(timeOff.end) - toMinutes(timeOff.start);
    if (timeRangesOverlap(slot, duration, timeOff.start, timeOffDuration)) {
      return { available: false, reason: 'timeOff' };
    }
  }

  // Check existing bookings
  const dateBookings = existingBookings.filter(b => b.date === date);
  for (const booking of dateBookings) {
    // Skip cancelled/no-show bookings
    if (['cancelled', 'no-show'].includes(booking.status)) continue;
    // Skip the booking being edited
    if (editingBookingId && booking.id === editingBookingId) continue;

    if (timeRangesOverlap(slot, duration, booking.time, booking.duration || 30)) {
      return { available: false, reason: 'booked' };
    }
  }

  return { available: true, reason: null };
}

/**
 * Get all time slots with availability status for a date
 * @param {Object} params
 * @param {string} params.date - Date string "YYYY-MM-DD"
 * @param {number} params.duration - Booking duration in minutes
 * @param {Object} params.barberData - Barber object
 * @param {Array} params.existingBookings - Existing bookings
 * @param {string} [params.editingBookingId] - ID of booking being edited
 * @returns {Array<{ slot: string, available: boolean, reason: string | null }>}
 */
export function getFilteredTimeSlots({
  date,
  duration,
  barberData,
  existingBookings = [],
  editingBookingId = null
}) {
  return TIME_SLOTS.map(slot => ({
    slot,
    ...getTimeSlotAvailability({
      slot,
      date,
      duration: duration || 30,
      barberData,
      existingBookings,
      editingBookingId
    })
  }));
}
