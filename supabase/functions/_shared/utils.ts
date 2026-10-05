// Utility functions for WhatsApp AI Agent

/**
 * Detect language from text
 * Supports: English, Arabic (Standard), Kuwaiti dialect
 */
export function detectLanguage(text: string): 'en' | 'ar' {
  // Check for Arabic characters
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

  if (arabicPattern.test(text)) {
    return 'ar';
  }

  return 'en';
}
/**
 * Check if text contains Kuwaiti dialect markers
 */
export function isKuwaitiDialect(text: string): boolean {
  // Common Kuwaiti dialect words and patterns
  const kuwaitiPatterns = [
    /شلون/, // shloon (how)
    /هلا/, // hala (hello)
    /شسمه/, // shisma (what's its name)
    /لو سمحت/, // law samaht (please - Gulf style)
    /زين/, // zain (good)
    /مافي/, // mafi (there isn't)
    /وين/, // wain (where)
    /ليش/, // laish (why)
    /شنو/, // shinu (what)
    /اشوف/, // ashoof (I see)
    /عيل/, // a'yal (so/then)
    /جذي/, // chithi (like this)
    /اوكي/, // okay
    /يالله/, // yalla
  ];

  return kuwaitiPatterns.some((pattern) => pattern.test(text));
}

/**
 * Get current date/time in Kuwait timezone (Asia/Kuwait, UTC+3)
 */
export function getKuwaitDate(): Date {
  // Create date string in Kuwait timezone, then parse it
  const kuwaitStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuwait' });
  return new Date(kuwaitStr);
}

/**
 * Parse a date string as Kuwait date (avoid UTC midnight issue)
 * When parsing "YYYY-MM-DD", JavaScript creates UTC midnight which can cause
 * day-of-week mismatches. This function parses as noon Kuwait time (9am UTC).
 */
export function parseKuwaitDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Create date at noon Kuwait time (9am UTC) to avoid day boundary issues
  return new Date(Date.UTC(year, month - 1, day, 9, 0, 0));
}

/**
 * Format a Date object as YYYY-MM-DD string
 */
export function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Format date for display
 */
export function formatDate(date: string, language: 'en' | 'ar'): string {
  const d = parseKuwaitDate(date); // Use Kuwait-aware parsing

  if (language === 'ar') {
    return d.toLocaleDateString('ar-KW', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format time for display (12-hour format)
 */
export function formatTime(time: string, language: 'en' | 'ar'): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? (language === 'ar' ? 'م' : 'PM') : (language === 'ar' ? 'ص' : 'AM');
  const hour12 = hours % 12 || 12;

  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Format price for display
 */
export function formatPrice(price: number, language: 'en' | 'ar'): string {
  if (language === 'ar') {
    return `${price.toFixed(2)} د.ك`;
  }
  return `${price.toFixed(2)} KWD`;
}

/**
 * Format duration for display
 */
export function formatDuration(minutes: number, language: 'en' | 'ar'): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (language === 'ar') {
    if (hours > 0 && mins > 0) {
      return `${hours} ساعة و ${mins} دقيقة`;
    } else if (hours > 0) {
      return `${hours} ساعة`;
    }
    return `${mins} دقيقة`;
  }

  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}min`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return `${mins} minutes`;
}

/**
 * Get day name from date (uses Kuwait timezone parsing)
 */
export function getDayName(date: string): string {
  const d = parseKuwaitDate(date); // Use Kuwait-aware parsing
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[d.getDay()];
}

/**
 * Parse time string to minutes since midnight
 */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convert minutes since midnight to time string
 */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Check if a date is within max booking days
 */
export function isWithinBookingWindow(date: string, maxDays: number): boolean {
  const targetDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + maxDays);

  return targetDate >= today && targetDate <= maxDate;
}

/**
 * Check if a given date and time is in the past (Kuwait timezone)
 * @param date - Date string in YYYY-MM-DD format
 * @param time - Time string in HH:MM format (24-hour)
 * @param bufferMinutes - Optional buffer in minutes (default: 0)
 *                        e.g., 30 means slot must be at least 30 min in the future
 * @returns true if the date/time is in the past (or within buffer period)
 */
export function isDateTimeInPast(
  date: string,
  time: string,
  bufferMinutes: number = 0
): boolean {
  const now = getKuwaitDate();
  const todayStr = formatDateString(now);

  // If date is before today, it's definitely in the past
  if (date < todayStr) {
    return true;
  }

  // If date is after today, it's definitely in the future
  if (date > todayStr) {
    return false;
  }

  // Date is today - compare times
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = timeToMinutes(time);

  // Check if target time (minus buffer) has already passed
  return targetMinutes <= currentMinutes + bufferMinutes;
}

/**
 * Filter out past time slots from an array (for today's date)
 * @param date - The date for these slots (YYYY-MM-DD)
 * @param slots - Array of time slots in HH:MM format
 * @param bufferMinutes - Minimum minutes from now (default: 30)
 * @returns Filtered array with only future slots
 */
export function filterPastSlots(
  date: string,
  slots: string[],
  bufferMinutes: number = 30
): string[] {
  const todayStr = formatDateString(getKuwaitDate());

  // If not today, all slots are valid
  if (date !== todayStr) {
    return slots;
  }

  // Filter out past slots for today
  return slots.filter((slot) => !isDateTimeInPast(date, slot, bufferMinutes));
}

/**
 * Check if a date falls within a vacation period
 */
export function isOnVacation(
  date: string,
  vacations: Array<{ startDate: string; endDate: string }>
): boolean {
  const targetDate = new Date(date);

  for (const vacation of vacations) {
    const start = new Date(vacation.startDate);
    const end = new Date(vacation.endDate);

    if (targetDate >= start && targetDate <= end) {
      return true;
    }
  }

  return false;
}

/**
 * Generate a short booking reference
 */
export function generateBookingReference(bookingId: string): string {
  // Take first 8 characters of UUID and convert to uppercase
  return bookingId.substring(0, 8).toUpperCase();
}

// ===========================================
// SECURITY: Input Validation Functions
// ===========================================

/**
 * Validate UUID format (v4)
 */
export function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Validate date format YYYY-MM-DD
 */
export function isValidDateFormat(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;

  const [year, month, day] = str.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year &&
         date.getMonth() === month - 1 &&
         date.getDate() === day;
}

/**
 * Validate time format HH:MM or HH:MM:SS (24-hour)
 */
export function isValidTimeFormat(str: string): boolean {
  // Accept HH:MM or HH:MM:SS (PostgreSQL stores with seconds)
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(str)) return false;

  const [hours, minutes] = str.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

// ===========================================
// SECURITY: Prompt Injection Detection
// ===========================================

/**
 * Patterns that indicate prompt injection attempts
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Instruction override attempts
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /forget\s+(all\s+)?(previous|prior|your)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior)\s+instructions?/i,
  /override\s+(your\s+)?instructions?/i,
  /new\s+instructions?:/i,
  /you\s+are\s+now\s+/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /act\s+as\s+(if\s+you\s+are|a)/i,
  /roleplay\s+as/i,

  // System prompt extraction attempts
  /what\s+(are\s+)?your\s+(system\s+)?instructions?/i,
  /show\s+(me\s+)?your\s+(system\s+)?prompt/i,
  /reveal\s+your\s+(system\s+)?prompt/i,
  /print\s+your\s+(system\s+)?prompt/i,
  /output\s+(your\s+)?instructions?/i,
  /repeat\s+(your\s+)?(system\s+)?instructions?/i,

  // Jailbreak patterns
  /\bDAN\b/,  // "Do Anything Now"
  /jailbreak/i,
  /bypass\s+(your\s+)?(safety|restrictions?|filters?)/i,

  // Code/XML injection
  /<\/?system>/i,
  /<\/?user>/i,
  /<\/?assistant>/i,
  /```(system|prompt|instructions)/i,

  // Arabic variants
  /تجاهل\s+(كل\s+)?التعليمات/,  // ignore instructions
  /انسى\s+التعليمات/,  // forget instructions
  /ما\s+هي\s+تعليماتك/,  // what are your instructions
];

/**
 * Check if input contains prompt injection attempts
 */
export function detectPromptInjection(input: string): {
  detected: boolean;
  pattern?: string;
} {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return { detected: true, pattern: pattern.source };
    }
  }
  return { detected: false };
}

// ===========================================
// SECURITY: Input Sanitization
// ===========================================

/**
 * Sanitize user input - enhanced version with injection protection
 */
export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '')  // Remove HTML-like brackets
    .replace(/```[\s\S]*?```/g, '[code removed]')  // Remove code blocks
    .replace(/\[SYSTEM\][\s\S]*?\[\/SYSTEM\]/gi, '')  // Remove fake system tags
    .replace(/\[INST\][\s\S]*?\[\/INST\]/gi, '')  // Remove fake instruction tags
    .substring(0, 1000);  // Limit length
}

/**
 * Parse date from natural language (simple implementation)
 */
export function parseDateFromText(text: string, language: 'en' | 'ar'): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const lowerText = text.toLowerCase();

  // English patterns
  if (language === 'en') {
    if (lowerText.includes('today')) {
      return today.toISOString().split('T')[0];
    }
    if (lowerText.includes('tomorrow')) {
      return tomorrow.toISOString().split('T')[0];
    }
  }

  // Arabic patterns
  if (language === 'ar') {
    if (text.includes('اليوم')) {
      return today.toISOString().split('T')[0];
    }
    if (text.includes('بكرة') || text.includes('غدا') || text.includes('باجر')) {
      return tomorrow.toISOString().split('T')[0];
    }
  }

  // Try to parse YYYY-MM-DD format
  const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (dateMatch) {
    return dateMatch[0];
  }

  // Try to parse DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return null;
}

/**
 * Parse time from natural language (simple implementation)
 */
export function parseTimeFromText(text: string): string | null {
  // Match patterns like "10:30", "10:30 AM", "10:30am", "10 AM"
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM|ص|م)?/);

  if (!timeMatch) {
    return null;
  }

  let hours = parseInt(timeMatch[1], 10);
  const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
  const period = timeMatch[3]?.toLowerCase();

  // Handle 12-hour format
  if (period === 'pm' || period === 'م') {
    if (hours !== 12) hours += 12;
  } else if (period === 'am' || period === 'ص') {
    if (hours === 12) hours = 0;
  }

  // Validate hours and minutes
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Get Kuwait timezone offset
 */
export function getKuwaitTime(): Date {
  const now = new Date();
  // Kuwait is UTC+3
  const kuwaitOffset = 3 * 60; // 3 hours in minutes
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + kuwaitOffset * 60000);
}

/**
 * Check if current time is within business hours
 */
export function isWithinBusinessHours(
  workingHours: { open: string | null; close: string | null }
): boolean {
  if (!workingHours.open || !workingHours.close) {
    return false; // Closed on this day
  }

  const now = getKuwaitTime();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const openMinutes = timeToMinutes(workingHours.open);
  const closeMinutes = timeToMinutes(workingHours.close);

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}
