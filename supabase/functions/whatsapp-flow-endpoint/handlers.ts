// WhatsApp Flow Screen Data Handlers
import { getSupabaseClient } from '../_shared/supabase.ts';
import {
  getKuwaitDate,
  formatDateString,
  getDayName,
  timeToMinutes,
  minutesToTime,
  filterPastSlots,
} from '../_shared/utils.ts';

export interface FlowResponse {
  version: string;
  screen: string;
  data: Record<string, unknown>;
}

export interface FlowErrorResponse {
  version: string;
  data: {
    error: boolean;
    error_message: string;
  };
}

/**
 * Handle INIT action - return initial screen with branches
 */
export async function handleInit(
  flowToken: string,
  language: string = 'ar'
): Promise<FlowResponse> {
  const supabase = getSupabaseClient();
  const isEnglish = language === 'en';

  // Get active branches
  const { data: branches, error } = await supabase
    .from('branches')
    .select('id, name, name_ar')
    .eq('status', 'active')
    .order('name');

  if (error || !branches || branches.length === 0) {
    console.error('Failed to load branches:', error);
    return {
      version: '5.1',
      screen: 'BRANCH_SELECT',
      data: {
        branches: [],
        error_message: isEnglish
          ? 'No branches available'
          : 'لا توجد فروع متاحة',
      },
    };
  }

  return {
    version: '5.1',
    screen: 'BRANCH_SELECT',
    data: {
      branches: branches.map((b) => ({
        id: b.id,
        title: isEnglish ? b.name : b.name_ar || b.name,
      })),
    },
  };
}

/**
 * Handle data exchange from BRANCH_SELECT screen
 * Returns list of barbers for the selected branch
 */
export async function handleBranchSelect(
  branchId: string,
  language: string = 'ar'
): Promise<FlowResponse> {
  const supabase = getSupabaseClient();
  const isEnglish = language === 'en';

  // Get branch info
  const { data: branch } = await supabase
    .from('branches')
    .select('name, name_ar')
    .eq('id', branchId)
    .single();

  // Get active barbers for this branch
  const { data: barbers, error } = await supabase
    .from('barbers')
    .select('id, name, name_ar')
    .eq('branch_id', branchId)
    .eq('status', 'active')
    .order('name');

  if (error || !barbers || barbers.length === 0) {
    console.error('Failed to load barbers:', error);
    return {
      version: '5.1',
      screen: 'BARBER_SELECT',
      data: {
        branch_id: branchId,
        branch_name: branch?.name_ar || branch?.name || 'Branch',
        barbers: [],
        error_message: isEnglish
          ? 'No barbers available at this branch'
          : 'لا يوجد حلاقين متاحين في هذا الفرع',
      },
    };
  }

  return {
    version: '5.1',
    screen: 'BARBER_SELECT',
    data: {
      branch_id: branchId,
      branch_name: isEnglish
        ? branch?.name || 'Branch'
        : branch?.name_ar || branch?.name || 'الفرع',
      barbers: barbers.map((b) => ({
        id: b.id,
        title: isEnglish ? b.name : b.name_ar || b.name,
      })),
    },
  };
}

/**
 * Handle data exchange from BARBER_SELECT screen
 * Returns list of services the barber can perform
 */
export async function handleBarberSelect(
  branchId: string,
  barberId: string,
  language: string = 'ar'
): Promise<FlowResponse> {
  const supabase = getSupabaseClient();
  const isEnglish = language === 'en';
  const currencyLabel = isEnglish ? 'KWD' : 'د.ك';

  // Get barber info with their service_ids
  const { data: barber } = await supabase
    .from('barbers')
    .select('name, name_ar, service_ids')
    .eq('id', barberId)
    .single();

  if (!barber) {
    return {
      version: '5.1',
      screen: 'SERVICE_SELECT',
      data: {
        branch_id: branchId,
        barber_id: barberId,
        barber_name: 'Barber',
        services: [],
        error_message: isEnglish ? 'Barber not found' : 'الحلاق غير موجود',
      },
    };
  }

  // Get services this barber can perform
  const serviceIds = barber.service_ids || [];
  let services: Array<{
    id: string;
    name: string;
    name_ar: string | null;
    duration: number;
    price: string;
  }> = [];

  if (serviceIds.length > 0) {
    const { data: svcData } = await supabase
      .from('services')
      .select('id, name, name_ar, duration, price')
      .in('id', serviceIds)
      .eq('status', 'active')
      .order('name');

    services = svcData || [];
  } else {
    // If barber has no specific services, get all branch services
    const { data: svcData } = await supabase
      .from('services')
      .select('id, name, name_ar, duration, price')
      .eq('branch_id', branchId)
      .eq('status', 'active')
      .order('name');

    services = svcData || [];
  }

  return {
    version: '5.1',
    screen: 'SERVICE_SELECT',
    data: {
      branch_id: branchId,
      barber_id: barberId,
      barber_name: isEnglish
        ? barber.name
        : barber.name_ar || barber.name,
      services: services.map((s) => ({
        id: s.id,
        title: `${isEnglish ? s.name : s.name_ar || s.name} - ${parseFloat(s.price).toFixed(2)} ${currencyLabel}`,
        description: `${s.duration} ${isEnglish ? 'min' : 'دقيقة'}`,
      })),
    },
  };
}

/**
 * Handle data exchange from SERVICE_SELECT screen
 * Returns date constraints and summary
 */
export async function handleServiceSelect(
  branchId: string,
  barberId: string,
  serviceIds: string[],
  language: string = 'ar'
): Promise<FlowResponse> {
  const supabase = getSupabaseClient();
  const isEnglish = language === 'en';
  const currencyLabel = isEnglish ? 'KWD' : 'د.ك';

  // Get branch info
  const { data: branch } = await supabase
    .from('branches')
    .select('name, name_ar')
    .eq('id', branchId)
    .single();

  // Get barber info
  const { data: barber } = await supabase
    .from('barbers')
    .select('name, name_ar, max_booking_days, availability, vacations')
    .eq('id', barberId)
    .single();

  // Get service details
  const { data: services } = await supabase
    .from('services')
    .select('id, name, name_ar, duration, price')
    .in('id', serviceIds);

  const totalDuration = services?.reduce((sum, s) => sum + s.duration, 0) || 0;
  const totalPrice =
    services?.reduce((sum, s) => sum + parseFloat(s.price), 0) || 0;
  const serviceNames =
    services
      ?.map((s) => (isEnglish ? s.name : s.name_ar || s.name))
      .join(' + ') || '';

  // Calculate date constraints
  const today = getKuwaitDate();
  const minDate = formatDateString(today);

  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + (barber?.max_booking_days || 30));
  const maxDateStr = formatDateString(maxDate);

  // Calculate unavailable dates (vacations + non-working days)
  const unavailableDates = calculateUnavailableDates(
    barber?.availability || {},
    barber?.vacations || [],
    today,
    maxDate
  );

  return {
    version: '5.1',
    screen: 'DATETIME_SELECT',
    data: {
      branch_id: branchId,
      branch_name: isEnglish
        ? branch?.name || 'Branch'
        : branch?.name_ar || branch?.name || 'الفرع',
      barber_id: barberId,
      barber_name: isEnglish
        ? barber?.name || 'Barber'
        : barber?.name_ar || barber?.name || 'الحلاق',
      service_ids: serviceIds,
      service_names: serviceNames,
      total_duration: totalDuration,
      total_price: totalPrice,
      summary: `${serviceNames}\n${totalPrice.toFixed(2)} ${currencyLabel}`,
      min_date: minDate,
      max_date: maxDateStr,
      unavailable_dates: unavailableDates,
      time_slots: [], // Will be populated when date is selected
    },
  };
}

/**
 * Handle date selection - load available time slots
 */
export async function handleDateSelect(
  barberId: string,
  selectedDate: string,
  totalDuration: number,
  existingData: Record<string, unknown>,
  language: string = 'ar'
): Promise<FlowResponse> {
  const supabase = getSupabaseClient();
  const isEnglish = language === 'en';

  // Get barber availability
  const { data: barber } = await supabase
    .from('barbers')
    .select('availability, time_offs, vacations, branch_id')
    .eq('id', barberId)
    .single();

  if (!barber) {
    return {
      version: '5.1',
      screen: 'DATETIME_SELECT',
      data: {
        ...existingData,
        time_slots: [],
        error_message: isEnglish ? 'Barber not found' : 'الحلاق غير موجود',
      },
    };
  }

  // Get existing bookings for that date
  const { data: bookings } = await supabase
    .from('bookings')
    .select('time, duration')
    .eq('barber_id', barberId)
    .eq('date', selectedDate)
    .in('status', ['pending', 'confirmed']);

  // Calculate available slots
  const slots = calculateAvailableSlots(
    barber.availability || {},
    barber.time_offs || [],
    bookings || [],
    selectedDate,
    totalDuration
  );

  return {
    version: '5.1',
    screen: 'DATETIME_SELECT',
    data: {
      ...existingData,
      selected_date: selectedDate,
      time_slots: slots.map((slot) => ({
        id: slot,
        title: formatTime12Hour(slot, isEnglish),
      })),
    },
  };
}

/**
 * Calculate unavailable dates based on barber availability and vacations
 */
function calculateUnavailableDates(
  availability: Record<string, { start?: string; end?: string; enabled?: boolean; available?: boolean }>,
  vacations: Array<{ startDate: string; endDate: string }>,
  startDate: Date,
  endDate: Date
): string[] {
  const unavailable: string[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    const dateStr = formatDateString(current);
    const dayName = getDayName(dateStr).toLowerCase();

    // Check if day is disabled in availability
    const dayAvailability = availability[dayName];
    if (dayAvailability) {
      const isEnabled =
        dayAvailability.enabled !== false && dayAvailability.available !== false;
      if (!isEnabled) {
        unavailable.push(dateStr);
        current.setDate(current.getDate() + 1);
        continue;
      }
    }

    // Check if date falls within a vacation
    for (const vacation of vacations) {
      const vacStart = new Date(vacation.startDate);
      const vacEnd = new Date(vacation.endDate);
      if (current >= vacStart && current <= vacEnd) {
        unavailable.push(dateStr);
        break;
      }
    }

    current.setDate(current.getDate() + 1);
  }

  return unavailable;
}

/**
 * Calculate available time slots for a given date
 */
function calculateAvailableSlots(
  availability: Record<string, { start?: string; end?: string; enabled?: boolean }>,
  timeOffs: Array<{ day?: string; date?: string; start: string; end: string }>,
  bookings: Array<{ time: string; duration: number }>,
  date: string,
  duration: number
): string[] {
  const slots: string[] = [];
  const dateObj = new Date(date + 'T00:00:00');
  const dayName = getDayName(date).toLowerCase();

  // Get working hours for this day
  const dayAvailability = availability[dayName];
  if (
    !dayAvailability ||
    !dayAvailability.start ||
    !dayAvailability.end
  ) {
    return [];
  }

  const workStart = timeToMinutes(dayAvailability.start);
  const workEnd = timeToMinutes(dayAvailability.end);

  // Collect blocked time ranges
  const blockedRanges: Array<{ start: number; end: number }> = [];

  // Add time offs for this day
  for (const timeOff of timeOffs) {
    if (
      timeOff.date === date ||
      timeOff.day?.toLowerCase() === dayName
    ) {
      blockedRanges.push({
        start: timeToMinutes(timeOff.start),
        end: timeToMinutes(timeOff.end),
      });
    }
  }

  // Add existing bookings
  for (const booking of bookings) {
    const bookingStart = timeToMinutes(booking.time);
    blockedRanges.push({
      start: bookingStart,
      end: bookingStart + booking.duration,
    });
  }

  // Generate 30-minute interval slots
  const SLOT_INTERVAL = 30;

  for (let time = workStart; time + duration <= workEnd; time += SLOT_INTERVAL) {
    const slotEnd = time + duration;

    // Check if slot overlaps with any blocked range
    const isBlocked = blockedRanges.some(
      (range) => time < range.end && slotEnd > range.start
    );

    if (!isBlocked) {
      slots.push(minutesToTime(time));
    }
  }

  // Filter out past slots if booking is for today (30 min buffer)
  return filterPastSlots(date, slots, 30);
}

/**
 * Format time to 12-hour format
 */
function formatTime12Hour(time: string, isEnglish: boolean): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? (isEnglish ? 'PM' : 'م') : (isEnglish ? 'AM' : 'ص');
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
}
