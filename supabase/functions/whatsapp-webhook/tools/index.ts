// Agent Tools - All tool definitions and handlers
import { getSupabaseClient } from '../../_shared/supabase.ts';
import { sendListMessage, sendTextMessage, sendButtonMessage, sendFlowMessage } from '../../_shared/whatsapp.ts';
import type { AgentTool, AgentToolResult } from '../../_shared/types.ts';
import {
  getDayName,
  timeToMinutes,
  minutesToTime,
  isWithinBookingWindow,
  isOnVacation,
  generateBookingReference,
  formatDate,
  formatTime,
  formatPrice,
  formatDuration,
  getKuwaitDate,
  formatDateString,
} from '../../_shared/utils.ts';

// ============================================
// Tool Definitions
// ============================================

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'get_branches',
    description: 'Get list of barbershop branches. Can filter by branch name (e.g., "Hair Crew", "هير كرو") or area name (in English or Arabic).',
    input_schema: {
      type: 'object',
      properties: {
        area_name: {
          type: 'string',
          description: 'Branch name OR area name to filter by (e.g., "Hair Crew", "هير كرو", "Salmiya", "السالمية")',
        },
      },
    },
  },
  {
    name: 'get_barbers',
    description: 'INTERNAL USE ONLY - Get barber data for lookups. DO NOT use this to show barbers to customers! Use send_barber_picker instead to send an interactive list.',
    input_schema: {
      type: 'object',
      properties: {
        branch_id: {
          type: 'string',
          description: 'The branch ID (required)',
        },
        date: {
          type: 'string',
          description: 'Optional date in YYYY-MM-DD format to check availability',
        },
      },
      required: ['branch_id'],
    },
  },
  {
    name: 'get_services',
    description: 'Get list of services offered at a branch with prices and durations.',
    input_schema: {
      type: 'object',
      properties: {
        branch_id: {
          type: 'string',
          description: 'The branch ID (required)',
        },
      },
      required: ['branch_id'],
    },
  },
  {
    name: 'check_availability',
    description: 'Check if a specific time slot is available for a barber.',
    input_schema: {
      type: 'object',
      properties: {
        barber_id: {
          type: 'string',
          description: 'The barber ID (required)',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format (required)',
        },
        time: {
          type: 'string',
          description: 'Time in HH:MM format, 24-hour (required)',
        },
        duration_minutes: {
          type: 'number',
          description: 'Total duration needed in minutes (required)',
        },
      },
      required: ['barber_id', 'date', 'time', 'duration_minutes'],
    },
  },
  {
    name: 'get_available_slots',
    description: 'Get all available time slots for a barber on a specific date. Use duration_minutes=30 as default if service not yet selected. Call this immediately when customer asks about barber availability with a date.',
    input_schema: {
      type: 'object',
      properties: {
        barber_id: {
          type: 'string',
          description: 'The barber ID (required)',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format (required). Convert "باجر"/"tomorrow" to actual date.',
        },
        duration_minutes: {
          type: 'number',
          description: 'Total duration needed in minutes. Use 30 as default if service not yet known.',
        },
      },
      required: ['barber_id', 'date', 'duration_minutes'],
    },
  },
  {
    name: 'create_booking',
    description: 'Create a new booking appointment.',
    input_schema: {
      type: 'object',
      properties: {
        branch_id: {
          type: 'string',
          description: 'The branch ID (required)',
        },
        barber_id: {
          type: 'string',
          description: 'The barber ID (required)',
        },
        service_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of service IDs (required)',
        },
        customer_name: {
          type: 'string',
          description: 'Customer name (required)',
        },
        customer_phone: {
          type: 'string',
          description: 'Customer phone number without country code (required)',
        },
        customer_country_code: {
          type: 'string',
          description: 'Customer country code, default +965',
        },
        date: {
          type: 'string',
          description: 'Booking date in YYYY-MM-DD format (required)',
        },
        time: {
          type: 'string',
          description: 'Booking time in HH:MM format, 24-hour (required)',
        },
        notes: {
          type: 'string',
          description: 'Optional notes for the booking',
        },
      },
      required: ['branch_id', 'barber_id', 'service_ids', 'customer_name', 'customer_phone', 'date', 'time'],
    },
  },
  {
    name: 'get_customer_bookings',
    description: 'Get upcoming bookings for a customer by their phone number.',
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Customer phone number without country code (required)',
        },
        country_code: {
          type: 'string',
          description: 'Country code, default +965',
        },
      },
      required: ['phone_number'],
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel an existing booking.',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: {
          type: 'string',
          description: 'The booking ID to cancel (required)',
        },
      },
      required: ['booking_id'],
    },
  },
  {
    name: 'reschedule_booking',
    description: 'Reschedule an existing booking to a new date and time.',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: {
          type: 'string',
          description: 'The booking ID to reschedule (required)',
        },
        new_date: {
          type: 'string',
          description: 'New date in YYYY-MM-DD format (required)',
        },
        new_time: {
          type: 'string',
          description: 'New time in HH:MM format, 24-hour (required)',
        },
      },
      required: ['booking_id', 'new_date', 'new_time'],
    },
  },
  {
    name: 'send_booking_picker',
    description: 'Send interactive list of customer upcoming bookings for selection (modify/cancel). Use this when customer wants to modify or cancel a booking instead of listing bookings as text.',
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Customer phone number (format: 96566xxxxxx, no +)',
        },
        action: {
          type: 'string',
          enum: ['modify', 'cancel'],
          description: 'Purpose of selection - "modify" or "cancel"',
        },
        language: {
          type: 'string',
          description: 'Customer language: "en" or "ar". Default: "ar"',
        },
      },
      required: ['phone_number', 'action', 'language'],
    },
  },
  {
    name: 'send_modify_options',
    description: 'Send buttons asking what customer wants to modify about their booking. Use after customer selects a booking to modify.',
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Customer phone number (format: 96566xxxxxx, no +)',
        },
        booking_id: {
          type: 'string',
          description: 'The booking ID being modified',
        },
        booking_reference: {
          type: 'string',
          description: 'Booking reference code (e.g., "392F63E8")',
        },
        current_date: {
          type: 'string',
          description: 'Current booking date in YYYY-MM-DD format',
        },
        current_time: {
          type: 'string',
          description: 'Current booking time in HH:MM format',
        },
        language: {
          type: 'string',
          description: 'Customer language: "en" or "ar". Default: "ar"',
        },
      },
      required: ['phone_number', 'booking_id', 'booking_reference', 'current_date', 'current_time', 'language'],
    },
  },
  {
    name: 'send_reschedule_confirmation',
    description: 'Send reschedule confirmation summary with confirm/cancel buttons. Use after customer selects new time for their booking.',
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Customer phone number (format: 96566xxxxxx, no +)',
        },
        booking_id: {
          type: 'string',
          description: 'The booking ID being rescheduled',
        },
        booking_reference: {
          type: 'string',
          description: 'Booking reference code',
        },
        branch_name: {
          type: 'string',
          description: 'Branch name in English',
        },
        branch_name_ar: {
          type: 'string',
          description: 'Branch name in Arabic',
        },
        barber_name: {
          type: 'string',
          description: 'Barber name in English',
        },
        barber_name_ar: {
          type: 'string',
          description: 'Barber name in Arabic',
        },
        service_names: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of service names',
        },
        new_date: {
          type: 'string',
          description: 'New date in YYYY-MM-DD format',
        },
        new_time: {
          type: 'string',
          description: 'New time in HH:MM format',
        },
        language: {
          type: 'string',
          description: 'Customer language: "en" or "ar". Default: "ar"',
        },
      },
      required: ['phone_number', 'booking_id', 'booking_reference', 'branch_name', 'branch_name_ar', 'barber_name', 'barber_name_ar', 'new_date', 'new_time', 'language'],
    },
  },
  {
    name: 'get_branch_location',
    description: 'Get the location and Google Maps link for a branch.',
    input_schema: {
      type: 'object',
      properties: {
        branch_id: {
          type: 'string',
          description: 'The branch ID (required)',
        },
      },
      required: ['branch_id'],
    },
  },
  {
    name: 'search_barber_by_name',
    description: 'PRIORITY: Use this FIRST when customer mentions a barber name (e.g., "احمد حمزة فاضي؟"). Returns barber ID needed for get_available_slots. Supports Arabic and English names.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Barber name to search for (partial match supported, e.g., "Ahmad", "احمد حمزة")',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'send_time_slot_picker',
    description: 'Send an interactive WhatsApp list message for customer to pick a time slot. Use this INSTEAD of listing times in text when showing available slots. Groups slots into morning/afternoon/evening sections.',
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Customer phone number (full format with country code, no +)',
        },
        barber_name: {
          type: 'string',
          description: 'Barber name in English',
        },
        barber_name_ar: {
          type: 'string',
          description: 'Barber name in Arabic',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format',
        },
        date_display: {
          type: 'string',
          description: 'Human-readable date in customer language (e.g., "باجر" or "Sunday 5 Jan")',
        },
        slots: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of available time slots in HH:MM format (e.g., ["10:00", "10:30", "11:00"])',
        },
        barber_id: {
          type: 'string',
          description: 'Barber ID for context in slot selection',
        },
        language: {
          type: 'string',
          description: 'Customer language: "en" for English, "ar" for Arabic. Default: "ar"',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (0-indexed). Shows 9 slots per page + "Show more" option. Default: 0',
        },
      },
      required: ['phone_number', 'barber_name', 'barber_name_ar', 'date', 'date_display', 'slots', 'barber_id', 'language'],
    },
  },
  {
    name: 'send_service_picker',
    description: 'Send an interactive WhatsApp list for customer to pick services. Shows only services the selected barber can perform. Use this after barber is selected.',
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Customer phone number (format: 96566xxxxxx, no +)',
        },
        barber_id: {
          type: 'string',
          description: 'Barber ID to get their services (required)',
        },
        barber_name: {
          type: 'string',
          description: 'Barber name in English',
        },
        barber_name_ar: {
          type: 'string',
          description: 'Barber name in Arabic',
        },
        language: {
          type: 'string',
          description: 'Customer language: "en" for English, "ar" for Arabic. Default: "ar"',
        },
      },
      required: ['phone_number', 'barber_id', 'barber_name', 'barber_name_ar', 'language'],
    },
  },
  {
    name: 'send_barber_picker',
    description: 'Send an interactive WhatsApp list for customer to pick a barber from a branch. Use this after customer provides branch name.',
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Customer phone number (format: 96566xxxxxx, no +)',
        },
        branch_id: {
          type: 'string',
          description: 'Branch ID to get barbers for',
        },
        branch_name: {
          type: 'string',
          description: 'Branch name in English (from get_branches "name" field)',
        },
        branch_name_ar: {
          type: 'string',
          description: 'Branch name in Arabic (from get_branches "name_ar" field)',
        },
        location_url: {
          type: 'string',
          description: 'Branch Google Maps location URL (from get_branches "location_url" field)',
        },
        language: {
          type: 'string',
          description: 'Customer language: "en" for English, "ar" for Arabic. Default: "ar"',
        },
      },
      required: ['phone_number', 'branch_id', 'branch_name', 'branch_name_ar', 'language'],
    },
  },
  {
    name: 'send_confirmation_buttons',
    description: 'Send booking summary with confirm/modify buttons. Use this after customer selects time slot to show all booking details and get confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Customer phone number (format: 96566xxxxxx, no +)',
        },
        branch_name: {
          type: 'string',
          description: 'Branch name in English',
        },
        branch_name_ar: {
          type: 'string',
          description: 'Branch name in Arabic',
        },
        barber_name: {
          type: 'string',
          description: 'Barber name in English',
        },
        barber_name_ar: {
          type: 'string',
          description: 'Barber name in Arabic',
        },
        service_names: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of selected service names in English',
        },
        service_names_ar: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of selected service names in Arabic',
        },
        date_display: {
          type: 'string',
          description: 'Human-readable date (e.g., "Sunday 5 Jan" or "باجر الأحد ٦-١")',
        },
        time: {
          type: 'string',
          description: 'Selected time (e.g., "13:00")',
        },
        total_duration: {
          type: 'number',
          description: 'Total duration in minutes',
        },
        total_price: {
          type: 'number',
          description: 'Total price in KWD',
        },
        language: {
          type: 'string',
          description: 'Customer language: "en" for English, "ar" for Arabic. Default: "ar"',
        },
        location_url: {
          type: 'string',
          description: 'Branch Google Maps location URL (optional)',
        },
      },
      required: ['phone_number', 'branch_name', 'branch_name_ar', 'barber_name', 'barber_name_ar', 'service_names', 'service_names_ar', 'date_display', 'time', 'total_duration', 'total_price', 'language'],
    },
  },
  {
    name: 'send_greeting_buttons',
    description: 'Send greeting message with action buttons (Book Now, Modify Booking, Cancel Booking). Use when customer sends a greeting and has no active booking context.',
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Customer phone number (format: 96566xxxxxx, no +)',
        },
        language: {
          type: 'string',
          description: 'Customer language: "en" or "ar". Default: "ar"',
        },
        is_kuwaiti: {
          type: 'boolean',
          description: 'Whether to use Kuwaiti dialect for Arabic. Default: false',
        },
      },
      required: ['phone_number', 'language'],
    },
  },
  {
    name: 'send_booking_flow',
    description: 'Send the comprehensive WhatsApp booking flow. This opens a multi-screen flow where customer can select branch, barber, services, and date/time all in one interactive form. Use this when customer wants to make a new booking.',
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Customer phone number (format: 96566xxxxxx, no +)',
        },
        language: {
          type: 'string',
          description: 'Customer language: "en" or "ar". Default: "ar"',
        },
      },
      required: ['phone_number'],
    },
  },
];

// ============================================
// Tool Handlers
// ============================================

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<AgentToolResult> {
  try {
    switch (toolName) {
      case 'get_branches':
        return await getBranches(input.area_name as string | undefined);
      case 'get_barbers':
        return await getBarbers(
          input.branch_id as string,
          input.date as string | undefined
        );
      case 'get_services':
        return await getServices(input.branch_id as string);
      case 'check_availability':
        return await checkAvailability(
          input.barber_id as string,
          input.date as string,
          input.time as string,
          input.duration_minutes as number
        );
      case 'get_available_slots':
        return await getAvailableSlots(
          input.barber_id as string,
          input.date as string,
          input.duration_minutes as number
        );
      case 'create_booking':
        return await createBooking(input);
      case 'get_customer_bookings':
        return await getCustomerBookings(
          input.phone_number as string,
          input.country_code as string | undefined
        );
      case 'cancel_booking':
        return await cancelBooking(input.booking_id as string);
      case 'reschedule_booking':
        return await rescheduleBooking(
          input.booking_id as string,
          input.new_date as string,
          input.new_time as string
        );
      case 'get_branch_location':
        return await getBranchLocation(input.branch_id as string);
      case 'search_barber_by_name':
        return await searchBarberByName(input.name as string);
      case 'send_time_slot_picker':
        return await sendTimeSlotPicker(
          input.phone_number as string,
          input.barber_name as string,
          (input.barber_name_ar as string) || '',
          input.date as string,
          input.date_display as string,
          input.slots as string[],
          input.barber_id as string,
          (input.language as string) || 'ar',
          (input.page as number) || 0
        );
      case 'send_service_picker':
        return await sendServicePicker(
          input.phone_number as string,
          input.barber_id as string,
          input.barber_name as string,
          (input.barber_name_ar as string) || '',
          (input.language as string) || 'ar'
        );
      case 'send_barber_picker':
        return await sendBarberPicker(
          input.phone_number as string,
          input.branch_id as string,
          input.branch_name as string,
          (input.branch_name_ar as string) || '',
          (input.location_url as string) || '',
          (input.language as string) || 'ar'
        );
      case 'send_confirmation_buttons':
        return await sendConfirmationButtons(
          input.phone_number as string,
          input.branch_name as string,
          (input.branch_name_ar as string) || '',
          input.barber_name as string,
          (input.barber_name_ar as string) || '',
          input.service_names as string[],
          (input.service_names_ar as string[]) || [],
          input.date_display as string,
          input.time as string,
          input.total_duration as number,
          input.total_price as number,
          (input.language as string) || 'ar',
          (input.location_url as string) || ''
        );
      case 'send_booking_picker':
        return await sendBookingPicker(
          input.phone_number as string,
          input.action as 'modify' | 'cancel',
          (input.language as string) || 'ar'
        );
      case 'send_modify_options':
        return await sendModifyOptions(
          input.phone_number as string,
          input.booking_id as string,
          input.booking_reference as string,
          input.current_date as string,
          input.current_time as string,
          (input.language as string) || 'ar'
        );
      case 'send_reschedule_confirmation':
        return await sendRescheduleConfirmation(
          input.phone_number as string,
          input.booking_id as string,
          input.booking_reference as string,
          input.branch_name as string,
          (input.branch_name_ar as string) || '',
          input.barber_name as string,
          (input.barber_name_ar as string) || '',
          (input.service_names as string[]) || [],
          input.new_date as string,
          input.new_time as string,
          (input.language as string) || 'ar'
        );
      case 'send_greeting_buttons':
        return await sendGreetingButtons(
          input.phone_number as string,
          (input.language as string) || 'ar',
          (input.is_kuwaiti as boolean) || false
        );
      case 'send_booking_flow':
        return await sendBookingFlow(
          input.phone_number as string,
          (input.language as string) || 'ar'
        );
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    console.error(`Tool ${toolName} error:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================
// Tool Implementations
// ============================================

async function getBranches(areaName?: string): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('branches')
    .select(`
      id,
      name,
      name_ar,
      phone,
      working_hours,
      location_url,
      governorate:governorates(name_en, name_ar),
      area:areas(name_en, name_ar)
    `)
    .eq('status', 'active');

  const { data, error } = await query;

  if (error) {
    return { success: false, error: error.message };
  }

  let branches = data || [];
  const allBranches = [...branches]; // Keep original for fuzzy matching

  // Filter by branch name OR area name if provided
  if (areaName) {
    const lowerSearch = areaName.toLowerCase();
    const normalizedSearch = normalizeArabic(areaName);

    // First try exact/substring matching
    const exactMatches = branches.filter((branch) => {
      // Match by branch name (English or Arabic)
      const branchNameEn = branch.name?.toLowerCase() || '';
      const branchNameAr = normalizeArabic(branch.name_ar || '');

      // Match by area
      const areaEn = (branch.area as any)?.name_en?.toLowerCase() || '';
      const areaAr = normalizeArabic((branch.area as any)?.name_ar || '');

      // Match by governorate
      const govEn = (branch.governorate as any)?.name_en?.toLowerCase() || '';
      const govAr = normalizeArabic((branch.governorate as any)?.name_ar || '');

      return (
        // Branch name matching (priority)
        branchNameEn.includes(lowerSearch) ||
        branchNameAr.includes(normalizedSearch) ||
        // Area matching
        areaEn.includes(lowerSearch) ||
        areaAr.includes(normalizedSearch) ||
        // Governorate matching
        govEn.includes(lowerSearch) ||
        govAr.includes(normalizedSearch)
      );
    });

    if (exactMatches.length > 0) {
      branches = exactMatches;
    } else {
      // No exact match - try fuzzy matching for suggestions
      const SIMILARITY_THRESHOLD = 0.6; // 60% similar

      let bestMatch: typeof branches[0] | null = null;
      let bestScore = 0;

      for (const branch of allBranches) {
        const branchNameAr = normalizeArabic(branch.name_ar || '');
        const branchNameEn = branch.name?.toLowerCase() || '';

        // Calculate similarity for both Arabic and English names
        const scoreAr = similarityRatio(normalizedSearch, branchNameAr);
        const scoreEn = similarityRatio(lowerSearch, branchNameEn);
        const maxScore = Math.max(scoreAr, scoreEn);

        if (maxScore > bestScore) {
          bestScore = maxScore;
          bestMatch = branch;
        }
      }

      if (bestMatch && bestScore >= SIMILARITY_THRESHOLD) {
        // Return empty results but include suggestion for "did you mean?"
        return {
          success: true,
          data: [],
          suggestion: {
            id: bestMatch.id,
            name: bestMatch.name,
            name_ar: bestMatch.name_ar,
            similarity: Math.round(bestScore * 100),
          },
        };
      }

      // No good fuzzy match found
      branches = [];
    }
  }

  return {
    success: true,
    data: branches.map((b) => ({
      id: b.id,
      name: b.name,
      name_ar: b.name_ar,
      phone: b.phone,
      area: (b.area as any)?.name_en || 'Unknown',
      area_ar: (b.area as any)?.name_ar || '',
      governorate: (b.governorate as any)?.name_en || '',
      governorate_ar: (b.governorate as any)?.name_ar || '',
      location_url: b.location_url,
    })),
  };
}

async function getBarbers(branchId: string, date?: string): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('barbers')
    .select('id, name, name_ar, availability, time_offs, vacations, service_ids, max_booking_days')
    .eq('branch_id', branchId)
    .eq('status', 'active');

  if (error) {
    return { success: false, error: error.message };
  }

  let barbers = data || [];

  // If date provided, filter out barbers on vacation
  if (date) {
    barbers = barbers.filter((barber) => {
      // Check vacation
      if (isOnVacation(date, barber.vacations || [])) {
        return false;
      }

      // Check if within booking window
      if (!isWithinBookingWindow(date, barber.max_booking_days || 30)) {
        return false;
      }

      // Check day availability
      const dayName = getDayName(date);
      const dayAvail = barber.availability?.[dayName];
      if (!dayAvail || dayAvail.available === false || dayAvail.enabled === false) {
        return false;
      }

      return true;
    });
  }

  return {
    success: true,
    data: barbers.map((b) => ({
      id: b.id,
      name: b.name,
      name_ar: b.name_ar,
      max_booking_days: b.max_booking_days,
    })),
    message: 'STOP! Do NOT list these barbers in text. You MUST call send_barber_picker tool to show barbers to customer as an interactive list.',
  };
}

async function getServices(branchId: string): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('services')
    .select('id, name, description, duration, price')
    .eq('branch_id', branchId)
    .eq('status', 'active');

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: (data || []).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      duration_minutes: s.duration,
      price: parseFloat(s.price),
    })),
  };
}

async function checkAvailability(
  barberId: string,
  date: string,
  time: string,
  durationMinutes: number,
  excludeBookingId?: string
): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();

  // Get barber details
  const { data: barber, error: barberError } = await supabase
    .from('barbers')
    .select('availability, time_offs, vacations, max_booking_days')
    .eq('id', barberId)
    .single();

  if (barberError || !barber) {
    return { success: false, error: 'Barber not found' };
  }

  // Check vacation
  if (isOnVacation(date, barber.vacations || [])) {
    return {
      success: true,
      data: { available: false, reason: 'Barber is on vacation on this date' },
    };
  }

  // Check booking window
  if (!isWithinBookingWindow(date, barber.max_booking_days || 30)) {
    return {
      success: true,
      data: { available: false, reason: `Bookings only available up to ${barber.max_booking_days} days in advance` },
    };
  }

  // Check day availability
  const dayName = getDayName(date);
  const dayAvail = barber.availability?.[dayName];
  if (!dayAvail || dayAvail.available === false || dayAvail.enabled === false) {
    return {
      success: true,
      data: { available: false, reason: 'Barber is not available on this day' },
    };
  }

  const requestedStart = timeToMinutes(time);
  const requestedEnd = requestedStart + durationMinutes;
  const dayStart = timeToMinutes(dayAvail.start);
  const dayEnd = timeToMinutes(dayAvail.end);

  // Check if within working hours
  if (requestedStart < dayStart || requestedEnd > dayEnd) {
    return {
      success: true,
      data: {
        available: false,
        reason: `Time is outside barber's working hours (${dayAvail.start} - ${dayAvail.end})`,
      },
    };
  }

  // Check time-offs for this day
  const timeOffs = (barber.time_offs || []).filter((to: any) => {
    if (to.type === 'one-time' && to.date === date) return true;
    if (to.day?.toLowerCase() === dayName.toLowerCase()) return true;
    return false;
  });

  for (const timeOff of timeOffs) {
    const offStart = timeToMinutes(timeOff.start);
    const offEnd = timeToMinutes(timeOff.end);
    if (requestedStart < offEnd && requestedEnd > offStart) {
      return {
        success: true,
        data: { available: false, reason: 'Barber has time-off during this slot' },
      };
    }
  }

  // Check existing bookings (exclude current booking when rescheduling)
  let bookingsQuery = supabase
    .from('bookings')
    .select('id, time, duration')
    .eq('barber_id', barberId)
    .eq('date', date)
    .in('status', ['pending', 'confirmed']);

  if (excludeBookingId) {
    bookingsQuery = bookingsQuery.neq('id', excludeBookingId);
  }

  const { data: bookings, error: bookingsError } = await bookingsQuery;

  if (bookingsError) {
    return { success: false, error: bookingsError.message };
  }

  for (const booking of bookings || []) {
    const bookingStart = timeToMinutes(booking.time);
    const bookingEnd = bookingStart + booking.duration;
    if (requestedStart < bookingEnd && requestedEnd > bookingStart) {
      return {
        success: true,
        data: { available: false, reason: 'Time slot is already booked' },
      };
    }
  }

  return {
    success: true,
    data: { available: true },
  };
}

async function getAvailableSlots(
  barberId: string,
  date: string,
  durationMinutes: number
): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();

  // Get barber details
  const { data: barber, error: barberError } = await supabase
    .from('barbers')
    .select('availability, time_offs, vacations, max_booking_days')
    .eq('id', barberId)
    .single();

  if (barberError || !barber) {
    return { success: false, error: 'Barber not found' };
  }

  // Check vacation
  if (isOnVacation(date, barber.vacations || [])) {
    return {
      success: true,
      data: { slots: [], reason: 'Barber is on vacation on this date' },
    };
  }

  // Check booking window
  if (!isWithinBookingWindow(date, barber.max_booking_days || 30)) {
    return {
      success: true,
      data: { slots: [], reason: `Bookings only available up to ${barber.max_booking_days} days in advance` },
    };
  }

  // Check day availability
  const dayName = getDayName(date);
  const dayAvail = barber.availability?.[dayName];
  if (!dayAvail || dayAvail.available === false || dayAvail.enabled === false) {
    return {
      success: true,
      data: { slots: [], reason: 'Barber is not available on this day' },
    };
  }

  const dayStart = timeToMinutes(dayAvail.start);
  const dayEnd = timeToMinutes(dayAvail.end);

  // Get existing bookings
  const { data: bookings } = await supabase
    .from('bookings')
    .select('time, duration')
    .eq('barber_id', barberId)
    .eq('date', date)
    .in('status', ['pending', 'confirmed']);

  // Get time-offs for this day
  const timeOffs = (barber.time_offs || []).filter((to: any) => {
    if (to.type === 'one-time' && to.date === date) return true;
    if (to.day?.toLowerCase() === dayName.toLowerCase()) return true;
    return false;
  });

  // Generate all possible slots (30-minute intervals)
  const slots: string[] = [];
  const slotInterval = 30;

  for (let time = dayStart; time + durationMinutes <= dayEnd; time += slotInterval) {
    const slotEnd = time + durationMinutes;
    let isAvailable = true;

    // Check against time-offs
    for (const timeOff of timeOffs) {
      const offStart = timeToMinutes(timeOff.start);
      const offEnd = timeToMinutes(timeOff.end);
      if (time < offEnd && slotEnd > offStart) {
        isAvailable = false;
        break;
      }
    }

    // Check against existing bookings
    if (isAvailable) {
      for (const booking of bookings || []) {
        const bookingStart = timeToMinutes(booking.time);
        const bookingEnd = bookingStart + booking.duration;
        if (time < bookingEnd && slotEnd > bookingStart) {
          isAvailable = false;
          break;
        }
      }
    }

    if (isAvailable) {
      slots.push(minutesToTime(time));
    }
  }

  return {
    success: true,
    data: { slots },
    message: 'STOP! Do NOT list these times in text. You MUST call send_time_slot_picker tool to show times to customer as an interactive list.',
  };
}

async function createBooking(input: Record<string, unknown>): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();

  const branchId = input.branch_id as string;
  const barberId = input.barber_id as string;
  const serviceIds = input.service_ids as string[];
  const customerName = input.customer_name as string;
  const customerPhone = input.customer_phone as string;
  const customerCountryCode = (input.customer_country_code as string) || '+965';
  const date = input.date as string;
  const time = input.time as string;
  const notes = input.notes as string | undefined;

  // Get services to calculate total duration and price
  const { data: services, error: servicesError } = await supabase
    .from('services')
    .select('id, name, duration, price')
    .in('id', serviceIds);

  if (servicesError || !services?.length) {
    return { success: false, error: 'Invalid services selected' };
  }

  const totalDuration = services.reduce((sum, s) => sum + s.duration, 0);
  const totalPrice = services.reduce((sum, s) => sum + parseFloat(s.price), 0);

  // Verify availability one more time
  const availCheck = await checkAvailability(barberId, date, time, totalDuration);
  if (!availCheck.success || !(availCheck.data as any)?.available) {
    return {
      success: false,
      error: (availCheck.data as any)?.reason || 'Time slot is not available',
    };
  }

  // Create booking
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .insert({
      branch_id: branchId,
      barber_id: barberId,
      service_ids: serviceIds,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_country_code: customerCountryCode,
      date,
      time,
      duration: totalDuration,
      price: totalPrice,
      status: 'confirmed',
      notes: notes || null,
      added_by_type: 'agent',
      added_by_user_id: 'agent@barber.com',
    })
    .select(`
      id,
      date,
      time,
      duration,
      price,
      branch:branches(name, name_ar),
      barber:barbers(name, name_ar)
    `)
    .single();

  if (bookingError) {
    return { success: false, error: bookingError.message };
  }

  return {
    success: true,
    data: {
      booking_id: booking.id,
      reference: generateBookingReference(booking.id),
      branch_name: (booking.branch as any)?.name,
      branch_name_ar: (booking.branch as any)?.name_ar,
      barber_name: (booking.barber as any)?.name,
      barber_name_ar: (booking.barber as any)?.name_ar,
      services: services.map((s) => s.name),
      date: booking.date,
      time: booking.time,
      duration_minutes: booking.duration,
      total_price: parseFloat(booking.price),
    },
  };
}

async function getCustomerBookings(
  phoneNumber: string,
  countryCode: string = '+965'
): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();

  // Use Kuwait timezone for "today" calculation
  const today = formatDateString(getKuwaitDate());

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id,
      date,
      time,
      duration,
      price,
      status,
      branch:branches(name, name_ar),
      barber:barbers(name, name_ar),
      service_ids
    `)
    .eq('customer_phone', phoneNumber)
    .eq('customer_country_code', countryCode)
    .gte('date', today)
    .in('status', ['pending', 'confirmed'])
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: (data || []).map((b) => ({
      booking_id: b.id,
      reference: generateBookingReference(b.id),
      branch_name: (b.branch as any)?.name,
      branch_name_ar: (b.branch as any)?.name_ar,
      barber_name: (b.barber as any)?.name,
      barber_name_ar: (b.barber as any)?.name_ar,
      date: b.date,
      time: b.time,
      duration_minutes: b.duration,
      total_price: parseFloat(b.price),
      status: b.status,
    })),
  };
}

async function cancelBooking(bookingId: string): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('bookings')
    .update({
      status: 'cancelled',
      modified_by_type: 'agent',
      modified_by_user_id: 'agent@barber.com',
    })
    .eq('id', bookingId)
    .in('status', ['pending', 'confirmed'])
    .select('id')
    .single();

  if (error || !data) {
    return { success: false, error: 'Booking not found or already cancelled' };
  }

  return {
    success: true,
    data: { cancelled: true, booking_id: bookingId },
  };
}

async function rescheduleBooking(
  bookingId: string,
  newDate: string,
  newTime: string
): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();

  // Get existing booking
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('barber_id, duration')
    .eq('id', bookingId)
    .in('status', ['pending', 'confirmed'])
    .single();

  if (fetchError || !booking) {
    return { success: false, error: 'Booking not found or cannot be rescheduled' };
  }

  // Check new slot availability (exclude current booking to avoid self-conflict)
  const availCheck = await checkAvailability(
    booking.barber_id,
    newDate,
    newTime,
    booking.duration,
    bookingId
  );

  if (!availCheck.success || !(availCheck.data as any)?.available) {
    return {
      success: false,
      error: (availCheck.data as any)?.reason || 'New time slot is not available',
    };
  }

  // Update booking
  const { data: updated, error: updateError } = await supabase
    .from('bookings')
    .update({
      date: newDate,
      time: newTime,
      modified_by_type: 'agent',
      modified_by_user_id: 'agent@barber.com',
    })
    .eq('id', bookingId)
    .select(`
      id,
      date,
      time,
      branch:branches(name, name_ar),
      barber:barbers(name, name_ar)
    `)
    .single();

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return {
    success: true,
    data: {
      rescheduled: true,
      booking_id: updated.id,
      reference: generateBookingReference(updated.id),
      new_date: updated.date,
      new_time: updated.time,
      branch_name: (updated.branch as any)?.name,
      branch_name_ar: (updated.branch as any)?.name_ar,
      barber_name: (updated.barber as any)?.name,
      barber_name_ar: (updated.barber as any)?.name_ar,
    },
  };
}

async function getBranchLocation(branchId: string): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('branches')
    .select(`
      id,
      name,
      name_ar,
      phone,
      location_url,
      governorate:governorates(name_en, name_ar),
      area:areas(name_en, name_ar)
    `)
    .eq('id', branchId)
    .single();

  if (error || !data) {
    return { success: false, error: 'Branch not found' };
  }

  return {
    success: true,
    data: {
      name: data.name,
      name_ar: data.name_ar,
      phone: data.phone,
      area: (data.area as any)?.name_en,
      area_ar: (data.area as any)?.name_ar,
      governorate: (data.governorate as any)?.name_en,
      governorate_ar: (data.governorate as any)?.name_ar,
      location_url: data.location_url,
    },
  };
}

/**
 * Normalize Arabic text for comparison
 * Handles different Unicode representations of same characters:
 * - Alef variants (أ إ آ ٱ ٲ ٳ ٵ) → ا
 * - Taa marbuta (ة) → ه
 * - Alef maksura (ى) → ي
 * - Removes diacritics (harakat)
 */
function normalizeArabic(text: string): string {
  return text
    // Normalize alef variants to plain alef
    .replace(/[أإآٱٲٳٵ]/g, 'ا')
    // Normalize taa marbuta to haa
    .replace(/ة/g, 'ه')
    // Normalize alef maksura to yaa
    .replace(/ى/g, 'ي')
    // Remove Arabic diacritics (harakat: fatha, damma, kasra, sukun, shadda, etc.)
    .replace(/[\u064B-\u065F]/g, '')
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching branch/barber names with typos
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // Create matrix
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // Fill matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity ratio (0-1) between two strings
 * Higher = more similar (1 = identical, 0 = completely different)
 */
function similarityRatio(str1: string, str2: string): number {
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  return maxLength === 0 ? 1 : (maxLength - distance) / maxLength;
}

async function searchBarberByName(name: string): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();
  const searchTerm = name.toLowerCase().trim();
  const normalizedSearch = normalizeArabic(name);

  const { data, error } = await supabase
    .from('barbers')
    .select(`
      id,
      name,
      name_ar,
      max_booking_days,
      branch:branches(id, name, name_ar)
    `)
    .eq('status', 'active');

  if (error) {
    return { success: false, error: error.message };
  }

  // Filter by name (case-insensitive, partial match for both English and Arabic)
  // Uses normalized Arabic for comparison to handle character variants
  const matches = (data || []).filter((barber) => {
    const nameEn = barber.name?.toLowerCase() || '';
    const nameAr = normalizeArabic(barber.name_ar || '');
    return nameEn.includes(searchTerm) || nameAr.includes(normalizedSearch);
  });

  if (matches.length === 0) {
    return {
      success: true,
      data: { found: false, message: 'No barber found with that name' },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      barbers: matches.map((b) => ({
        id: b.id,
        name: b.name,
        name_ar: b.name_ar,
        max_booking_days: b.max_booking_days || 30,
        branch_id: (b.branch as any)?.id,
        branch_name: (b.branch as any)?.name,
        branch_name_ar: (b.branch as any)?.name_ar,
      })),
    },
  };
}

/**
 * Send an interactive WhatsApp list message for time slot selection
 * Supports pagination - shows 9 slots per page + "Show more" option when more exist
 * WhatsApp API limit: 10 rows total per list message
 */
async function sendTimeSlotPicker(
  phoneNumber: string,
  barberName: string,
  barberNameAr: string,
  date: string,
  dateDisplay: string,
  slots: string[],
  barberId: string,
  language: string = 'ar',
  page: number = 0
): Promise<AgentToolResult> {
  if (!slots || slots.length === 0) {
    return { success: false, error: 'No slots available to show' };
  }

  const isEnglish = language === 'en';
  // Choose barber name based on language
  const displayBarberName = isEnglish ? barberName : (barberNameAr || barberName);

  // WhatsApp allows maximum 10 rows TOTAL
  const MAX_ROWS = 10;
  const SLOTS_PER_PAGE = 9; // Reserve 1 row for "Show more" option

  // Calculate pagination
  const startIndex = page * SLOTS_PER_PAGE;
  const remainingSlots = slots.slice(startIndex);
  const hasMoreSlots = remainingSlots.length > MAX_ROWS;

  // Get slots for this page
  const slotsToShow = hasMoreSlots
    ? remainingSlots.slice(0, SLOTS_PER_PAGE) // Show 9 slots + "more" option
    : remainingSlots.slice(0, MAX_ROWS); // Last page: show up to 10 slots

  // Group slots into morning/afternoon/evening sections for better UX
  const morning = slotsToShow.filter((s) => {
    const hour = parseInt(s.split(':')[0]);
    return hour >= 9 && hour < 12;
  });
  const afternoon = slotsToShow.filter((s) => {
    const hour = parseInt(s.split(':')[0]);
    return hour >= 12 && hour < 17;
  });
  const evening = slotsToShow.filter((s) => {
    const hour = parseInt(s.split(':')[0]);
    return hour >= 17;
  });

  const sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }> = [];

  if (morning.length > 0) {
    sections.push({
      title: isEnglish ? 'Morning' : 'الصباح',
      rows: morning.map((slot) => ({
        id: `slot_${barberId}_${date}_${slot.replace(':', '')}`,
        title: slot,
      })),
    });
  }

  if (afternoon.length > 0) {
    sections.push({
      title: isEnglish ? 'Afternoon' : 'الظهر',
      rows: afternoon.map((slot) => ({
        id: `slot_${barberId}_${date}_${slot.replace(':', '')}`,
        title: slot,
      })),
    });
  }

  if (evening.length > 0) {
    sections.push({
      title: isEnglish ? 'Evening' : 'المساء',
      rows: evening.map((slot) => ({
        id: `slot_${barberId}_${date}_${slot.replace(':', '')}`,
        title: slot,
      })),
    });
  }

  // Add "Show more times" option if there are more slots
  if (hasMoreSlots) {
    sections.push({
      title: isEnglish ? 'More Options' : 'خيارات أكثر',
      rows: [{
        id: 'more_times',
        title: isEnglish ? '➡️ Show more times' : '➡️ عرض أوقات أكثر',
        description: isEnglish
          ? `${slots.length - startIndex - SLOTS_PER_PAGE} more available`
          : `${slots.length - startIndex - SLOTS_PER_PAGE} وقت إضافي متاح`,
      }],
    });
  }

  if (sections.length === 0) {
    return { success: false, error: 'No slots available for any time period' };
  }

  // Show page info if not first page
  const pageInfo = page > 0 ? (isEnglish ? ` (Page ${page + 1})` : ` (صفحة ${page + 1})`) : '';
  const headerText = isEnglish
    ? `${displayBarberName} is available on ${dateDisplay}${pageInfo}. Choose a time:`
    : `${displayBarberName} فاضي ${dateDisplay}${pageInfo}. اختر الوقت:`;
  const buttonText = isEnglish ? 'Choose time' : 'اختر وقت';

  const result = await sendListMessage(
    phoneNumber,
    headerText,
    buttonText,
    sections
  );

  // If interactive list fails, fall back to plain text
  if (!result.success) {
    console.log('Interactive list failed, falling back to plain text:', result.error);

    // Format slots as plain text (show all slots in text mode)
    const slotsText = slots.join(isEnglish ? ', ' : '، ');
    const fallbackMessage = isEnglish
      ? `${displayBarberName} is available on ${dateDisplay}:\n${slotsText}\n\nWhich time works for you?`
      : `${displayBarberName} فاضي ${dateDisplay}:\n${slotsText}\n\nأي وقت يناسبك؟`;

    const textResult = await sendTextMessage(phoneNumber, fallbackMessage);

    if (!textResult.success) {
      // Even on complete failure, include slots data so Claude doesn't hallucinate
      return {
        success: false,
        error: textResult.error,
        data: {
          slots: slots,
          barber_name: barberName,
          date: date,
          date_display: dateDisplay,
          fallback_failed: true,
        },
      };
    }

    return {
      success: true,
      data: {
        message_sent: true,
        message_id: textResult.messageId,
        message_content: fallbackMessage,
        slots_shown: slots.length,
        fallback_used: true,
      },
    };
  }

  return {
    success: true,
    data: {
      message_sent: true,
      message_id: result.messageId,
      message_content: headerText,
      slots_shown: slotsToShow.length,
      total_slots: slots.length,
      current_page: page,
      has_more_slots: hasMoreSlots,
      sections_count: sections.length,
    },
  };
}

/**
 * Send an interactive WhatsApp list message for service selection
 * Shows only services the selected barber can perform (filtered by barber's service_ids)
 * Customer can tap to select a service from the list
 */
async function sendServicePicker(
  phoneNumber: string,
  barberId: string,
  barberName: string,
  barberNameAr: string,
  language: string = 'ar'
): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();

  // First get barber to find their service_ids and branch_id
  const { data: barber, error: barberError } = await supabase
    .from('barbers')
    .select('service_ids, branch_id')
    .eq('id', barberId)
    .single();

  if (barberError || !barber) {
    return { success: false, error: 'Barber not found' };
  }

  const serviceIds = barber.service_ids || [];

  if (serviceIds.length === 0) {
    // If barber has no service_ids, get all branch services (backward compatibility)
    const { data: branchServices, error: branchError } = await supabase
      .from('services')
      .select('id, name, name_ar, description, duration, price')
      .eq('branch_id', barber.branch_id)
      .eq('status', 'active');

    if (branchError || !branchServices || branchServices.length === 0) {
      return { success: false, error: 'No services available for this barber' };
    }

    return await sendServiceList(phoneNumber, barberName, barberNameAr, branchServices, barber.branch_id, language);
  }

  // Get only services this barber can perform
  const { data: services, error } = await supabase
    .from('services')
    .select('id, name, name_ar, description, duration, price')
    .in('id', serviceIds)
    .eq('status', 'active');

  if (error) {
    return { success: false, error: error.message };
  }

  if (!services || services.length === 0) {
    return { success: false, error: 'No services available for this barber' };
  }

  return await sendServiceList(phoneNumber, barberName, barberNameAr, services, barber.branch_id, language);
}

/**
 * Helper function to send service list message
 * Uses WhatsApp Flow for multi-select if WHATSAPP_SERVICE_FLOW_ID is configured,
 * otherwise falls back to plain text message
 */
async function sendServiceList(
  phoneNumber: string,
  barberName: string,
  barberNameAr: string,
  services: Array<{ id: string; name: string; name_ar: string | null; description: string | null; duration: number; price: string }>,
  branchId: string,
  language: string = 'ar'
): Promise<AgentToolResult> {
  const MAX_SERVICES = 10;
  const servicesToShow = services.slice(0, MAX_SERVICES);
  const isEnglish = language === 'en';
  const displayBarberName = isEnglish ? barberName : (barberNameAr || barberName);
  const currencyLabel = isEnglish ? 'KWD' : 'د.ك';

  // Check if WhatsApp Flow is configured for service selection
  const flowId = Deno.env.get('WHATSAPP_SERVICE_FLOW_ID');

  if (flowId) {
    // Use WhatsApp Flow for multi-select services
    const flowServices = servicesToShow.map((s) => ({
      id: s.id,
      title: `${isEnglish ? s.name : (s.name_ar || s.name)} - ${parseFloat(s.price).toFixed(2)} ${currencyLabel}`,
    }));

    // Generate unique flow token for this session
    const flowToken = `svc_${phoneNumber}_${Date.now()}`;

    const bodyText = isEnglish
      ? `Select services with ${displayBarberName}. You can choose multiple services.`
      : `اختر الخدمات عند ${displayBarberName}. يمكنك اختيار أكثر من خدمة.`;

    const ctaText = isEnglish ? 'Select Services' : 'اختر الخدمات';

    const result = await sendFlowMessage(
      phoneNumber,
      flowId,
      flowToken,
      {
        screen: 'SERVICE_SELECT',
        data: { services: flowServices },
      },
      ctaText,
      bodyText
    );

    if (result.success) {
      return {
        success: true,
        data: {
          message_sent: true,
          message_id: result.messageId,
          message_content: bodyText,
          flow_token: flowToken,
          flow_used: true,
          services_shown: servicesToShow.length,
          branch_id: branchId,
          services: servicesToShow.map((s) => ({
            id: s.id,
            name: s.name,
            name_ar: s.name_ar,
            duration: s.duration,
            price: parseFloat(s.price),
          })),
        },
      };
    }

    // If Flow fails, fall back to text-based approach
    console.log('WhatsApp Flow failed, falling back to text:', result.error);
  }

  // Fallback: Plain text message (single-select)
  const servicesText = servicesToShow
    .map((s) => {
      const displayName = isEnglish ? s.name : (s.name_ar || s.name);
      return `• ${displayName} - ${parseFloat(s.price).toFixed(2)} ${currencyLabel}`;
    })
    .join('\n');
  const message = isEnglish
    ? `What service would you like with ${displayBarberName}?\n\n${servicesText}`
    : `شنو الخدمة اللي تباها عند ${displayBarberName}؟\n\n${servicesText}`;

  const result = await sendTextMessage(phoneNumber, message);

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      data: {
        branch_id: branchId,
        barber_name: barberName,
        services: servicesToShow.map((s) => ({
          id: s.id,
          name: s.name,
          name_ar: s.name_ar,
          duration: s.duration,
          price: parseFloat(s.price),
        })),
      },
    };
  }

  return {
    success: true,
    data: {
      message_sent: true,
      message_id: result.messageId,
      message_content: message,
      flow_used: false,
      services_shown: servicesToShow.length,
      branch_id: branchId,
      services: servicesToShow.map((s) => ({
        id: s.id,
        name: s.name,
        name_ar: s.name_ar,
        duration: s.duration,
        price: parseFloat(s.price),
      })),
    },
  };
}

/**
 * Send an interactive WhatsApp list message for barber selection
 * Customer can tap to select a barber from the branch
 */
async function sendBarberPicker(
  phoneNumber: string,
  branchId: string,
  branchName: string,
  branchNameAr: string,
  locationUrl: string = '',
  language: string = 'ar'
): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();
  const isEnglish = language === 'en';
  // Choose branch name based on language
  const displayBranchName = isEnglish ? branchName : (branchNameAr || branchName);

  // Get active barbers for this branch
  const { data: barbers, error } = await supabase
    .from('barbers')
    .select('id, name, name_ar')
    .eq('branch_id', branchId)
    .eq('status', 'active');

  if (error) {
    return { success: false, error: error.message };
  }

  if (!barbers || barbers.length === 0) {
    return { success: false, error: 'No barbers available at this branch' };
  }

  // WhatsApp max 10 rows total
  const MAX_ROWS = 10;
  const barbersToShow = barbers.slice(0, MAX_ROWS);

  const sections = [
    {
      title: isEnglish ? 'Barbers' : 'الحلاقين',
      rows: barbersToShow.map((barber) => ({
        id: `barber_${barber.id}_${branchId}`,
        title: (isEnglish ? barber.name : (barber.name_ar || barber.name)).substring(0, 24), // WhatsApp max 24 chars
      })),
    },
  ];

  const headerText = isEnglish
    ? `Choose a barber at ${displayBranchName}:`
    : `اختر الحلاق في ${displayBranchName}:`;
  const buttonText = isEnglish ? 'Choose barber' : 'اختر حلاق';

  const result = await sendListMessage(
    phoneNumber,
    headerText,
    buttonText,
    sections
  );

  // Fallback to plain text if interactive list fails
  if (!result.success) {
    console.log('Barber picker failed, falling back to plain text:', result.error);

    const barbersText = barbersToShow
      .map((b, i) => `${i + 1}. ${isEnglish ? b.name : (b.name_ar || b.name)}`)
      .join('\n');
    const fallbackMessage = isEnglish
      ? `Barbers at ${displayBranchName}:\n\n${barbersText}\n\nType the barber's name`
      : `الحلاقين في ${displayBranchName}:\n\n${barbersText}\n\nاكتب اسم الحلاق`;

    const textResult = await sendTextMessage(phoneNumber, fallbackMessage);
    if (!textResult.success) {
      // Even on complete failure, include barber data so Claude doesn't hallucinate
      return {
        success: false,
        error: textResult.error,
        data: {
          barbers: barbersToShow.map((b) => ({
            id: b.id,
            name: b.name,
            name_ar: b.name_ar,
          })),
          branch_name: branchName,
          location_url: locationUrl,
          fallback_failed: true,
        },
      };
    }

    return {
      success: true,
      data: {
        message_sent: true,
        message_id: textResult.messageId,
        message_content: fallbackMessage,
        barbers_shown: barbersToShow.length,
        fallback_used: true,
        location_url: locationUrl,
        barbers: barbersToShow.map((b) => ({
          id: b.id,
          name: b.name,
          name_ar: b.name_ar,
        })),
      },
    };
  }

  return {
    success: true,
    data: {
      message_sent: true,
      message_id: result.messageId,
      message_content: headerText,
      barbers_shown: barbersToShow.length,
      location_url: locationUrl,
      barbers: barbersToShow.map((b) => ({
        id: b.id,
        name: b.name,
        name_ar: b.name_ar,
      })),
    },
  };
}

/**
 * Send booking summary with confirm/modify action buttons
 * Customer can tap to confirm or modify the booking before it's created
 */
async function sendConfirmationButtons(
  phoneNumber: string,
  branchName: string,
  branchNameAr: string,
  barberName: string,
  barberNameAr: string,
  serviceNames: string[],
  serviceNamesAr: string[],
  dateDisplay: string,
  time: string,
  totalDuration: number,
  totalPrice: number,
  language: string = 'ar',
  locationUrl: string = ''
): Promise<AgentToolResult> {
  const isEnglish = language === 'en';
  // Choose names based on language
  const displayBranchName = isEnglish ? branchName : (branchNameAr || branchName);
  const displayBarberName = isEnglish ? barberName : (barberNameAr || barberName);
  // Use Arabic service names when language is Arabic
  const displayServiceNames = isEnglish ? serviceNames : (serviceNamesAr.length > 0 ? serviceNamesAr : serviceNames);

  // Validate required parameters to prevent crashes from undefined values
  if (!serviceNames || !Array.isArray(serviceNames) || serviceNames.length === 0) {
    return {
      success: false,
      error: 'service_names is required and must be a non-empty array. Look at conversation history to find which services the customer selected.',
      data: { missing_param: 'service_names' },
    };
  }

  if (typeof totalPrice !== 'number' || isNaN(totalPrice)) {
    return {
      success: false,
      error: 'total_price is required and must be a number. Sum the prices of selected services from available_services in context.',
      data: { missing_param: 'total_price' },
    };
  }

  if (typeof totalDuration !== 'number' || isNaN(totalDuration)) {
    return {
      success: false,
      error: 'total_duration is required and must be a number. Sum the durations of selected services from available_services in context.',
      data: { missing_param: 'total_duration' },
    };
  }

  const servicesText = displayServiceNames.join(' + ');
  const currencyLabel = isEnglish ? 'KWD' : 'د.ك';
  // Format time based on language (e.g., "9:00 AM" for English, "9:00 ص" for Arabic)
  const formattedTime = formatTime(time, isEnglish ? 'en' : 'ar');
  // Add location line if URL is provided
  const locationLine = locationUrl
    ? (isEnglish ? `📍 Location: ${locationUrl}` : `📍 الموقع: ${locationUrl}`)
    : '';

  const summaryMessage = isEnglish
    ? `📋 Booking Summary:

🏪 ${displayBranchName}
💈 ${displayBarberName}
✂️ ${servicesText}
📅 ${dateDisplay}
🕐 ${formattedTime}
💰 ${totalPrice.toFixed(2)} ${currencyLabel}${locationLine ? '\n' + locationLine : ''}

Confirm your booking?`
    : `📋 ملخص الحجز:

🏪 ${displayBranchName}
💈 ${displayBarberName}
✂️ ${servicesText}
📅 ${dateDisplay}
🕐 ${formattedTime}
💰 ${totalPrice.toFixed(2)} ${currencyLabel}${locationLine ? '\n' + locationLine : ''}

هل تأكد الحجز؟`;

  const buttons = isEnglish
    ? [
        { id: 'confirm_booking', title: 'Confirm' },
        { id: 'modify_booking', title: 'Modify' },
      ]
    : [
        { id: 'confirm_booking', title: 'تأكيد الحجز' },
        { id: 'modify_booking', title: 'تعديل' },
      ];

  const result = await sendButtonMessage(
    phoneNumber,
    summaryMessage,
    buttons
  );

  // Fallback to plain text if button message fails
  if (!result.success) {
    console.log('Confirmation buttons failed, falling back to plain text:', result.error);

    const fallbackMessage = isEnglish
      ? `${summaryMessage}\n\nType "confirm" to book or "modify" to change`
      : `${summaryMessage}\n\nاكتب "تأكيد" للحجز أو "تعديل" للتغيير`;

    const textResult = await sendTextMessage(phoneNumber, fallbackMessage);

    if (!textResult.success) {
      // Even on complete failure, include booking summary so Claude doesn't hallucinate
      return {
        success: false,
        error: textResult.error,
        data: {
          branch_name: branchName,
          barber_name: barberName,
          service_names: serviceNames,
          date_display: dateDisplay,
          time: time,
          total_duration: totalDuration,
          total_price: totalPrice,
          fallback_failed: true,
        },
      };
    }

    return {
      success: true,
      data: {
        message_sent: true,
        message_id: textResult.messageId,
        message_content: fallbackMessage,
        fallback_used: true,
      },
    };
  }

  return {
    success: true,
    data: {
      message_sent: true,
      message_id: result.messageId,
      message_content: summaryMessage,
    },
  };
}

/**
 * Send interactive list of customer's upcoming bookings for selection
 * Used when customer wants to modify or cancel a booking
 */
async function sendBookingPicker(
  phoneNumber: string,
  action: 'modify' | 'cancel',
  language: string = 'ar'
): Promise<AgentToolResult> {
  const supabase = getSupabaseClient();
  const isEnglish = language === 'en';

  // Extract phone number (last 8 digits)
  const customerPhone = phoneNumber.slice(-8);

  // Get customer's upcoming bookings
  const today = formatDateString(getKuwaitDate());

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`
      id,
      date,
      time,
      duration,
      price,
      status,
      service_ids,
      branch:branches(name, name_ar),
      barber:barbers(name, name_ar)
    `)
    .eq('customer_phone', customerPhone)
    .eq('customer_country_code', '+965')
    .gte('date', today)
    .in('status', ['pending', 'confirmed'])
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) {
    return { success: false, error: error.message };
  }

  if (!bookings || bookings.length === 0) {
    return {
      success: false,
      error: isEnglish ? 'No upcoming bookings found' : 'ما عندك حجوزات قادمة',
    };
  }

  // Get service names for each booking
  const serviceIds = [...new Set(bookings.flatMap((b) => b.service_ids || []))];
  const { data: services } = await supabase
    .from('services')
    .select('id, name, name_ar')
    .in('id', serviceIds);

  const serviceMap = new Map((services || []).map((s) => [s.id, s]));

  // Build list rows (WhatsApp max 10 rows)
  const MAX_ROWS = 10;
  const bookingsToShow = bookings.slice(0, MAX_ROWS);

  const rows = bookingsToShow.map((b) => {
    const displayDate = formatDate(b.date, language as 'en' | 'ar');
    const displayTime = formatTime(b.time, language as 'en' | 'ar');
    const barberName = isEnglish
      ? (b.barber as any)?.name
      : (b.barber as any)?.name_ar || (b.barber as any)?.name;

    // Get first service name for description
    const firstServiceId = (b.service_ids || [])[0];
    const firstService = firstServiceId ? serviceMap.get(firstServiceId) : null;
    const serviceName = firstService
      ? (isEnglish ? firstService.name : firstService.name_ar || firstService.name)
      : '';

    return {
      id: `booking_${action}_${b.id}`,
      title: `${displayDate}`.substring(0, 24),
      description: `${displayTime} - ${barberName}${serviceName ? ` - ${serviceName}` : ''}`.substring(0, 72),
    };
  });

  const sections = [
    {
      title: isEnglish ? 'Your Bookings' : 'حجوزاتك',
      rows,
    },
  ];

  const headerText = isEnglish
    ? `Select booking to ${action}:`
    : action === 'modify'
      ? 'اختر الحجز اللي تبي تعدله:'
      : 'اختر الحجز اللي تبي تلغيه:';
  const buttonText = isEnglish ? 'Select booking' : 'اختر الحجز';

  const result = await sendListMessage(phoneNumber, headerText, buttonText, sections);

  if (!result.success) {
    // Fallback to plain text
    const bookingsText = bookingsToShow
      .map((b, i) => {
        const displayDate = formatDate(b.date, language as 'en' | 'ar');
        const displayTime = formatTime(b.time, language as 'en' | 'ar');
        const barberName = isEnglish
          ? (b.barber as any)?.name
          : (b.barber as any)?.name_ar || (b.barber as any)?.name;
        return `${i + 1}. ${displayDate} ${displayTime} - ${barberName}`;
      })
      .join('\n');

    const fallbackMessage = isEnglish
      ? `Your upcoming bookings:\n\n${bookingsText}\n\nType the number to ${action}:`
      : `حجوزاتك القادمة:\n\n${bookingsText}\n\nاكتب رقم الحجز اللي تبي ${action === 'modify' ? 'تعدله' : 'تلغيه'}:`;

    const textResult = await sendTextMessage(phoneNumber, fallbackMessage);

    return {
      success: textResult.success,
      data: {
        message_content: fallbackMessage,
        bookings: bookingsToShow.map((b) => ({
          booking_id: b.id,
          reference: generateBookingReference(b.id),
          date: b.date,
          time: b.time,
          barber_name: (b.barber as any)?.name,
          barber_name_ar: (b.barber as any)?.name_ar,
          branch_name: (b.branch as any)?.name,
          branch_name_ar: (b.branch as any)?.name_ar,
          service_ids: b.service_ids,
        })),
        fallback_used: true,
      },
      error: textResult.error,
    };
  }

  return {
    success: true,
    data: {
      message_sent: true,
      message_id: result.messageId,
      message_content: headerText,
      bookings_shown: bookingsToShow.length,
      action,
      bookings: bookingsToShow.map((b) => ({
        booking_id: b.id,
        reference: generateBookingReference(b.id),
        date: b.date,
        time: b.time,
        barber_name: (b.barber as any)?.name,
        barber_name_ar: (b.barber as any)?.name_ar,
        branch_name: (b.branch as any)?.name,
        branch_name_ar: (b.branch as any)?.name_ar,
        service_ids: b.service_ids,
      })),
    },
  };
}

/**
 * Send buttons asking what customer wants to modify about their booking
 */
async function sendModifyOptions(
  phoneNumber: string,
  bookingId: string,
  bookingReference: string,
  currentDate: string,
  currentTime: string,
  language: string = 'ar'
): Promise<AgentToolResult> {
  const isEnglish = language === 'en';

  const displayDate = formatDate(currentDate, language as 'en' | 'ar');
  const displayTime = formatTime(currentTime, language as 'en' | 'ar');

  const bodyText = isEnglish
    ? `Your booking: ${displayDate} at ${displayTime}\n\nWhat would you like to change?`
    : `حجزك: ${displayDate} الساعة ${displayTime}\n\nشنو تبي تغير؟`;

  const buttons = isEnglish
    ? [
        { id: `modify_time_${bookingId}`, title: 'Time' },
        { id: `modify_date_${bookingId}`, title: 'Date' },
        { id: `cancel_instead_${bookingId}`, title: 'Cancel' },
      ]
    : [
        { id: `modify_time_${bookingId}`, title: 'الوقت' },
        { id: `modify_date_${bookingId}`, title: 'التاريخ' },
        { id: `cancel_instead_${bookingId}`, title: 'إلغاء' },
      ];

  const result = await sendButtonMessage(phoneNumber, bodyText, buttons);

  if (!result.success) {
    // Fallback to plain text
    const fallbackMessage = isEnglish
      ? `${bodyText}\n\nType:\n- "time" to change time\n- "date" to change date\n- "cancel" to cancel booking`
      : `${bodyText}\n\nاكتب:\n- "وقت" لتغيير الوقت\n- "تاريخ" لتغيير التاريخ\n- "الغاء" لإلغاء الحجز`;

    const textResult = await sendTextMessage(phoneNumber, fallbackMessage);

    return {
      success: textResult.success,
      data: {
        message_content: fallbackMessage,
        booking_id: bookingId,
        booking_reference: bookingReference,
        fallback_used: true,
      },
      error: textResult.error,
    };
  }

  return {
    success: true,
    data: {
      message_sent: true,
      message_id: result.messageId,
      message_content: bodyText,
      booking_id: bookingId,
      booking_reference: bookingReference,
    },
  };
}

/**
 * Send reschedule confirmation summary with confirm/cancel buttons
 */
async function sendRescheduleConfirmation(
  phoneNumber: string,
  bookingId: string,
  bookingReference: string,
  branchName: string,
  branchNameAr: string,
  barberName: string,
  barberNameAr: string,
  serviceNames: string[],
  newDate: string,
  newTime: string,
  language: string = 'ar'
): Promise<AgentToolResult> {
  const isEnglish = language === 'en';

  const displayBranch = isEnglish ? branchName : (branchNameAr || branchName);
  const displayBarber = isEnglish ? barberName : (barberNameAr || barberName);
  const displayDate = formatDate(newDate, language as 'en' | 'ar');
  const displayTime = formatTime(newTime, language as 'en' | 'ar');
  const servicesText = serviceNames.length > 0 ? serviceNames.join(' + ') : '';

  const summaryMessage = isEnglish
    ? `*Reschedule Summary*\n\n` +
      `${displayBranch}\n` +
      `${displayBarber}\n` +
      (servicesText ? `${servicesText}\n` : '') +
      `*New: ${displayDate} at ${displayTime}*`
    : `*ملخص التعديل*\n\n` +
      `${displayBranch}\n` +
      `${displayBarber}\n` +
      (servicesText ? `${servicesText}\n` : '') +
      `*الجديد: ${displayDate} الساعة ${displayTime}*`;

  const buttons = isEnglish
    ? [
        { id: `confirm_reschedule_${bookingId}`, title: 'Confirm' },
        { id: `cancel_reschedule_${bookingId}`, title: 'Cancel' },
      ]
    : [
        { id: `confirm_reschedule_${bookingId}`, title: 'تأكيد' },
        { id: `cancel_reschedule_${bookingId}`, title: 'إلغاء' },
      ];

  const result = await sendButtonMessage(phoneNumber, summaryMessage, buttons);

  if (!result.success) {
    // Fallback to plain text
    const fallbackMessage = isEnglish
      ? `${summaryMessage}\n\nType "confirm" to reschedule or "cancel" to abort.`
      : `${summaryMessage}\n\nاكتب "تأكيد" للتعديل أو "الغاء" للإلغاء.`;

    const textResult = await sendTextMessage(phoneNumber, fallbackMessage);

    return {
      success: textResult.success,
      data: {
        message_content: fallbackMessage,
        booking_id: bookingId,
        booking_reference: bookingReference,
        new_date: newDate,
        new_time: newTime,
        fallback_used: true,
      },
      error: textResult.error,
    };
  }

  return {
    success: true,
    data: {
      message_sent: true,
      message_id: result.messageId,
      message_content: summaryMessage,
      booking_id: bookingId,
      booking_reference: bookingReference,
      new_date: newDate,
      new_time: newTime,
    },
  };
}

/**
 * Send greeting message with action buttons
 * Shows 3 options: Book Now, Modify Booking, Cancel Booking
 * Supports English, Standard Arabic, and Kuwaiti dialect
 */
async function sendGreetingButtons(
  phoneNumber: string,
  language: string = 'ar',
  isKuwaiti: boolean = false
): Promise<AgentToolResult> {
  const isEnglish = language === 'en';

  // Greeting text varies by language and dialect
  const bodyText = isEnglish
    ? "Hey! 👋 I'm Sulaiman, your booking assistant.\n\nHow can I help you today?"
    : isKuwaiti
      ? "هلا والله! 👋 أنا سليمان مساعدك للحجز.\n\nشلون أقدر أساعدك؟"
      : "أهلاً! 👋 أنا سليمان مساعدك للحجز.\n\nكيف أقدر أساعدك؟";

  // Button labels in customer's language
  const buttons = isEnglish
    ? [
        { id: 'greeting_book', title: '📅 Book Now' },
        { id: 'greeting_modify', title: '✏️ Modify Booking' },
        { id: 'greeting_cancel', title: '❌ Cancel Booking' },
      ]
    : [
        { id: 'greeting_book', title: '📅 احجز الآن' },
        { id: 'greeting_modify', title: '✏️ تعديل حجز' },
        { id: 'greeting_cancel', title: '❌ إلغاء حجز' },
      ];

  const result = await sendButtonMessage(phoneNumber, bodyText, buttons);

  if (!result.success) {
    // Fallback to plain text if button message fails
    console.log('Greeting buttons failed, falling back to plain text:', result.error);

    const fallbackMessage = isEnglish
      ? "Hey! 👋 I'm Sulaiman, your booking assistant.\n\nTo book: Type the barbershop name\nTo modify: Type \"modify\"\nTo cancel: Type \"cancel\""
      : isKuwaiti
        ? "هلا والله! 👋 أنا سليمان مساعدك للحجز.\n\nللحجز: اكتب اسم الصالون\nللتعديل: اكتب \"تعديل\"\nللإلغاء: اكتب \"إلغاء\""
        : "أهلاً! 👋 أنا سليمان مساعدك للحجز.\n\nللحجز: اكتب اسم الصالون\nللتعديل: اكتب \"تعديل\"\nللإلغاء: اكتب \"إلغاء\"";

    const textResult = await sendTextMessage(phoneNumber, fallbackMessage);

    return {
      success: textResult.success,
      data: {
        message_id: textResult.messageId,
        message_content: fallbackMessage,
        fallback_used: true,
      },
      error: textResult.error,
    };
  }

  return {
    success: true,
    data: {
      message_sent: true,
      message_id: result.messageId,
      message_content: bodyText,
    },
  };
}

/**
 * Send the comprehensive WhatsApp booking flow
 * Opens a multi-screen flow for branch, barber, services, and date/time selection
 */
async function sendBookingFlow(
  phoneNumber: string,
  language: string = 'ar'
): Promise<AgentToolResult> {
  const flowId = Deno.env.get('WHATSAPP_BOOKING_FLOW_ID');

  if (!flowId) {
    console.log('WHATSAPP_BOOKING_FLOW_ID not configured, falling back to step-by-step booking');
    return {
      success: false,
      error: 'Booking flow not configured. Use step-by-step booking instead.',
      data: { flow_not_configured: true },
    };
  }

  const isEnglish = language === 'en';

  // Generate unique flow token with language for the endpoint
  const flowToken = `booking_${phoneNumber}_${Date.now()}_${language}`;

  // Initial payload for the INIT action
  const flowActionPayload = {
    screen: 'BRANCH_SELECT',
    data: {},
  };

  const bodyText = isEnglish
    ? 'Complete your booking in a few simple steps'
    : 'أكمل حجزك بخطوات بسيطة';

  const result = await sendFlowMessage(
    phoneNumber,
    flowId,
    flowToken,
    flowActionPayload,
    isEnglish ? 'Book Now' : 'احجز الآن',
    bodyText,
    isEnglish ? 'Barbershop Booking' : 'حجز صالون',
    'data_exchange' // Use data_exchange mode for dynamic screen data
  );

  if (!result.success) {
    console.error('Failed to send booking flow:', result.error);
    return {
      success: false,
      error: result.error || 'Failed to send booking flow',
    };
  }

  return {
    success: true,
    data: {
      message_sent: true,
      message_id: result.messageId,
      message_content: bodyText,
      flow_token: flowToken,
      flow_used: true,
    },
  };
}
