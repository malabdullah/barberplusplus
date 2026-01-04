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
    const isEnabled = daySchedule?.enabled ?? daySchedule?.available;
    if (!isEnabled) {
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

/**
 * Convert minutes since midnight to time string "HH:MM"
 */
function toTimeString(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Calculate maximum allowed total duration for a booking
 * This calculates the maximum duration a booking can have from its start time
 * before conflicting with next booking, working hours, or time-offs.
 * @param {Object} params
 * @param {Object} params.booking - The booking to extend
 * @param {Array} params.existingBookings - All bookings for the barber
 * @param {Object} params.barberData - Barber availability data
 * @returns {number} Maximum allowed total duration in minutes (0 if no extension possible)
 */
export function getMaxAllowedDuration({ booking, existingBookings = [], barberData }) {
  if (!booking || !booking.time || !booking.date) {
    return 0;
  }

  const dateObj = new Date(booking.date + 'T00:00:00');
  const dayKey = DAY_KEYS[dateObj.getDay()];
  const bookingStartMins = toMinutes(booking.time);

  // Start with a large max (e.g., 8 hours = 480 minutes)
  let maxAllowedEnd = bookingStartMins + 480;

  // 1. Limit by working hours end
  if (barberData?.availability) {
    const daySchedule = barberData.availability[dayKey];
    const isEnabled = daySchedule?.enabled ?? daySchedule?.available;
    if (isEnabled && daySchedule.end) {
      const workEndMins = toMinutes(daySchedule.end);
      maxAllowedEnd = Math.min(maxAllowedEnd, workEndMins);
    }
  }

  // 2. Limit by next booking for this barber on this date
  const sameDayBookings = existingBookings
    .filter(b => {
      if (b.barberId !== booking.barberId) return false;
      if (b.date !== booking.date) return false;
      if (b.id === booking.id) return false; // Exclude current booking
      if (['cancelled', 'no-show'].includes(b.status)) return false;
      return true;
    })
    .map(b => toMinutes(b.time))
    .sort((a, b) => a - b);

  // Find next booking that starts after current booking starts
  const nextBookingStart = sameDayBookings.find(start => start > bookingStartMins);
  if (nextBookingStart !== undefined) {
    maxAllowedEnd = Math.min(maxAllowedEnd, nextBookingStart);
  }

  // 3. Limit by time-offs that start after booking starts
  if (barberData?.timeOffs?.length > 0) {
    // One-time time-offs on this date
    barberData.timeOffs
      .filter(t => t.type === 'one-time' && t.date === booking.date)
      .forEach(t => {
        const timeOffStart = toMinutes(t.start);
        if (timeOffStart > bookingStartMins) {
          maxAllowedEnd = Math.min(maxAllowedEnd, timeOffStart);
        }
      });

    // Recurring time-offs on this day of week
    barberData.timeOffs
      .filter(t => t.type === 'recurring' && t.day === dayKey)
      .forEach(t => {
        const timeOffStart = toMinutes(t.start);
        if (timeOffStart > bookingStartMins) {
          maxAllowedEnd = Math.min(maxAllowedEnd, timeOffStart);
        }
      });
  }

  // Return maximum allowed duration (from start to max allowed end)
  return Math.max(0, maxAllowedEnd - bookingStartMins);
}

/**
 * Calculate maximum additional time available for extending a booking
 * This is a convenience wrapper for backward compatibility
 * @param {Object} params
 * @param {Object} params.booking - The booking to extend
 * @param {number} params.currentServicesDuration - Current total duration from services
 * @param {Array} params.existingBookings - All bookings for the barber
 * @param {Object} params.barberData - Barber availability data
 * @returns {number} Maximum additional minutes available (0 if no extension possible)
 */
export function getMaxExtension({ booking, currentServicesDuration = null, existingBookings = [], barberData }) {
  const maxAllowed = getMaxAllowedDuration({ booking, existingBookings, barberData });
  // If currentServicesDuration provided, return how much MORE can be added
  // Otherwise fall back to old behavior using booking.duration
  const currentDuration = currentServicesDuration ?? booking?.duration ?? 0;
  return Math.max(0, maxAllowed - currentDuration);
}

/**
 * Check if a booking can be extended to a new total duration
 * @param {Object} params
 * @param {Object} params.booking - The booking to extend
 * @param {number} params.newTotalDuration - The new total duration (sum of all services)
 * @param {Array} params.existingBookings - All bookings for the barber
 * @param {Object} params.barberData - Barber availability data
 * @returns {{ canExtend: boolean, reason: string }}
 */
export function checkExtensionConflicts({
  booking,
  newTotalDuration,
  existingBookings = [],
  barberData,
}) {
  if (!booking || !newTotalDuration || newTotalDuration <= 0) {
    return { canExtend: false, reason: 'Invalid extension parameters' };
  }

  // Get maximum allowed duration from booking start time
  const maxAllowedDuration = getMaxAllowedDuration({ booking, existingBookings, barberData });

  if (newTotalDuration > maxAllowedDuration) {
    // Determine the specific reason
    const dateObj = new Date(booking.date + 'T00:00:00');
    const dayKey = DAY_KEYS[dateObj.getDay()];
    const bookingStartMins = toMinutes(booking.time);
    const newEndMins = bookingStartMins + newTotalDuration;

    // Check working hours
    if (barberData?.availability) {
      const daySchedule = barberData.availability[dayKey];
      if (daySchedule?.end) {
        const workEndMins = toMinutes(daySchedule.end);
        if (newEndMins > workEndMins) {
          return {
            canExtend: false,
            reason: `Extension would exceed working hours (ends at ${daySchedule.end})`,
          };
        }
      }
    }

    // Check next booking
    const sameDayBookings = existingBookings
      .filter(b => {
        if (b.barberId !== booking.barberId) return false;
        if (b.date !== booking.date) return false;
        if (b.id === booking.id) return false;
        if (['cancelled', 'no-show'].includes(b.status)) return false;
        return true;
      })
      .sort((a, b) => toMinutes(a.time) - toMinutes(b.time));

    const nextBooking = sameDayBookings.find(b => toMinutes(b.time) > bookingStartMins);
    if (nextBooking && newEndMins > toMinutes(nextBooking.time)) {
      return {
        canExtend: false,
        reason: `Extension would conflict with next booking at ${nextBooking.time}`,
      };
    }

    return {
      canExtend: false,
      reason: `Maximum allowed duration is ${maxAllowedDuration} minutes`,
    };
  }

  return { canExtend: true, reason: '' };
}
