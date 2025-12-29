/**
 * Booking conflict detection utilities
 */

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Convert time string "HH:MM" to minutes since midnight
 */
function toMinutes(time) {
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
export function timeRangesOverlap(start1, duration1, start2, duration2) {
  const s1 = toMinutes(start1);
  const e1 = s1 + duration1;
  const s2 = toMinutes(start2);
  const e2 = s2 + duration2;

  // Overlap if one starts before the other ends
  return s1 < e2 && s2 < e1;
}

/**
 * Check for booking conflicts
 * @param {Object} params
 * @param {string} params.barberId - The barber's ID
 * @param {string} params.date - Booking date "YYYY-MM-DD"
 * @param {string} params.time - Booking start time "HH:MM"
 * @param {number} params.duration - Booking duration in minutes
 * @param {Array} params.existingBookings - Array of existing bookings to check against
 * @param {Object} params.barberData - Barber object with availability, timeOffs, vacations
 * @param {string} [params.editingBookingId] - ID of booking being edited (to exclude from overlap check)
 * @returns {{ hasConflict: boolean, reason: string }}
 */
export function checkBookingConflicts({
  barberId,
  date,
  time,
  duration,
  existingBookings = [],
  barberData,
  editingBookingId = null,
}) {
  // Default response
  const noConflict = { hasConflict: false, reason: '' };

  if (!barberId || !date || !time || !duration) {
    return noConflict;
  }

  const dateObj = new Date(date + 'T00:00:00');
  const dayKey = DAY_KEYS[dateObj.getDay()];

  // 1. Check if barber is on vacation
  if (barberData?.vacations?.length > 0) {
    const isOnVacation = barberData.vacations.some(v => {
      const start = new Date(v.startDate + 'T00:00:00');
      const end = new Date(v.endDate + 'T23:59:59');
      return dateObj >= start && dateObj <= end;
    });

    if (isOnVacation) {
      return { hasConflict: true, reason: 'Barber is on vacation on this date' };
    }
  }

  // 2. Check if it's barber's day off
  if (barberData?.availability) {
    const daySchedule = barberData.availability[dayKey];
    if (!daySchedule?.enabled) {
      return { hasConflict: true, reason: 'Barber is not available on this day' };
    }

    // 3. Check if booking is within working hours
    const bookingStart = toMinutes(time);
    const bookingEnd = bookingStart + duration;
    const workStart = toMinutes(daySchedule.start);
    const workEnd = toMinutes(daySchedule.end);

    if (bookingStart < workStart) {
      return {
        hasConflict: true,
        reason: `Booking starts before working hours (${daySchedule.start})`,
      };
    }

    if (bookingEnd > workEnd) {
      return {
        hasConflict: true,
        reason: `Booking ends after working hours (${daySchedule.end})`,
      };
    }
  }

  // 4. Check for time-off conflicts
  if (barberData?.timeOffs?.length > 0) {
    // One-time time-offs on this specific date
    const oneTimeConflict = barberData.timeOffs.find(t => {
      if (t.type !== 'one-time' || t.date !== date) return false;
      const timeOffDuration = toMinutes(t.end) - toMinutes(t.start);
      return timeRangesOverlap(time, duration, t.start, timeOffDuration);
    });

    if (oneTimeConflict) {
      return {
        hasConflict: true,
        reason: `Barber has time-off from ${oneTimeConflict.start} to ${oneTimeConflict.end}`,
      };
    }

    // Recurring time-offs on this day of week
    const recurringConflict = barberData.timeOffs.find(t => {
      if (t.type !== 'recurring' || t.day !== dayKey) return false;
      const timeOffDuration = toMinutes(t.end) - toMinutes(t.start);
      return timeRangesOverlap(time, duration, t.start, timeOffDuration);
    });

    if (recurringConflict) {
      return {
        hasConflict: true,
        reason: `Barber has recurring time-off from ${recurringConflict.start} to ${recurringConflict.end}`,
      };
    }
  }

  // 5. Check for overlapping bookings
  const conflictingBooking = existingBookings.find(booking => {
    // Skip if different barber
    if (booking.barberId !== barberId) return false;

    // Skip if different date
    if (booking.date !== date) return false;

    // Skip cancelled/no-show bookings
    if (['cancelled', 'no-show'].includes(booking.status)) return false;

    // Skip the booking being edited
    if (editingBookingId && booking.id === editingBookingId) return false;

    // Check for time overlap
    return timeRangesOverlap(time, duration, booking.time, booking.duration);
  });

  if (conflictingBooking) {
    const conflictEnd = toMinutes(conflictingBooking.time) + conflictingBooking.duration;
    const endHour = Math.floor(conflictEnd / 60);
    const endMin = conflictEnd % 60;
    const endTimeStr = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

    return {
      hasConflict: true,
      reason: `Time conflicts with existing booking (${conflictingBooking.time} - ${endTimeStr})`,
    };
  }

  return noConflict;
}
