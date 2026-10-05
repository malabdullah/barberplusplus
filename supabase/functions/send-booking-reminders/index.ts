// Booking Reminder Sender - Edge Function
// Runs on schedule to send WhatsApp reminders for upcoming bookings
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getPendingReminders, updateReminderStatus, getSupabaseClient } from '../_shared/supabase.ts';
import { sendTextMessage, formatPhoneForApi } from '../_shared/whatsapp.ts';
import { formatTime } from '../_shared/utils.ts';
import { hasValidSharedSecret } from '../_shared/environment.ts';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Get notification template from database
 */
async function getReminderTemplate(): Promise<{
  title_en: string;
  title_ar: string;
  message_en: string;
  message_ar: string;
} | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('notification_templates')
    .select('title_en, title_ar, message_en, message_ar')
    .eq('template_key', 'booking_reminder')
    .eq('is_active', true)
    .single();

  if (error || !data) {
    console.error('Failed to get reminder template:', error);
    return null;
  }

  return data;
}

/**
 * Format reminder message for WhatsApp
 * Customer data comes from joined customers table
 */
function formatReminderMessage(
  reminder: {
    booking: {
      date: string;
      time: string;
      customer: { name: string; phone: string; country_code: string };
      branch: { name: string; name_ar: string };
      barber: { name: string; name_ar: string };
    };
  },
  language: 'en' | 'ar' = 'ar'
): string {
  const { booking } = reminder;
  const customer = booking.customer;
  const branch = booking.branch;
  const barber = booking.barber;

  // Format date for display
  const dateObj = new Date(booking.date + 'T12:00:00');
  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  };

  const formattedDate = language === 'ar'
    ? dateObj.toLocaleDateString('ar-KW', dateOptions)
    : dateObj.toLocaleDateString('en-US', dateOptions);

  const formattedTime = formatTime(booking.time, language);
  const branchName = language === 'ar' ? (branch.name_ar || branch.name) : branch.name;
  const barberName = language === 'ar' ? (barber.name_ar || barber.name) : barber.name;
  const customerName = customer?.name || 'Customer';

  if (language === 'ar') {
    return `📅 تذكير بالموعد

مرحباً ${customerName}! هذا تذكير بموعدك:

💈 ${barberName}
📍 ${branchName}
📅 ${formattedDate}
🕐 ${formattedTime}

نشوفك إن شاء الله! 👋`;
  }

  return `📅 Booking Reminder

Hi ${customerName}! This is a reminder for your appointment:

💈 ${barberName}
📍 ${branchName}
📅 ${formattedDate}
🕐 ${formattedTime}

See you there! 👋`;
}

/**
 * Detect language preference (default to Arabic for Kuwait)
 */
function detectLanguage(countryCode: string): 'en' | 'ar' {
  // Kuwait default to Arabic
  if (countryCode === '+965' || countryCode === '965') {
    return 'ar';
  }
  return 'en';
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders
    });
  }

  if (!(await hasValidSharedSecret(req))) {
    return new Response('Unauthorized', {
      status: 401,
      headers: corsHeaders,
    });
  }

  console.log('=== Send Booking Reminders START ===');
  const startTime = Date.now();

  try {
    // Get pending reminders that are due
    const reminders = await getPendingReminders();
    console.log(`Found ${reminders.length} pending reminders to send`);

    if (reminders.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending reminders',
        sent: 0,
        failed: 0,
        duration_ms: Date.now() - startTime
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Process each reminder
    for (const reminder of reminders) {
      try {
        // Skip if booking data is missing
        if (!reminder.booking) {
          console.error(`Reminder ${reminder.id}: Missing booking data`);
          await updateReminderStatus(reminder.id, 'failed', 'Missing booking data');
          failedCount++;
          continue;
        }

        const booking = reminder.booking;
        const customer = booking.customer;

        // Skip if customer data is missing
        if (!customer) {
          console.error(`Reminder ${reminder.id}: Missing customer data`);
          await updateReminderStatus(reminder.id, 'failed', 'Missing customer data');
          failedCount++;
          continue;
        }

        // Format phone number for WhatsApp API (customer data from joined customers table)
        const countryCode = customer.country_code || '+965';
        const phoneNumber = formatPhoneForApi(customer.phone, countryCode);

        // Detect language based on country code
        const language = detectLanguage(countryCode);

        // Format the reminder message
        const message = formatReminderMessage(reminder as any, language);

        console.log(`Sending reminder to ${phoneNumber} for booking ${reminder.booking_id}`);

        // Send WhatsApp message
        const result = await sendTextMessage(phoneNumber, message);

        if (result.success) {
          await updateReminderStatus(reminder.id, 'sent');
          sentCount++;
          console.log(`✓ Reminder sent for booking ${reminder.booking_id}`);
        } else {
          const errorMsg = result.error || 'Unknown error';
          await updateReminderStatus(reminder.id, 'failed', errorMsg);
          failedCount++;
          errors.push(`Booking ${reminder.booking_id}: ${errorMsg}`);
          console.error(`✗ Failed to send reminder for booking ${reminder.booking_id}: ${errorMsg}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        await updateReminderStatus(reminder.id, 'failed', errorMsg);
        failedCount++;
        errors.push(`Reminder ${reminder.id}: ${errorMsg}`);
        console.error(`Error processing reminder ${reminder.id}:`, err);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`=== Send Booking Reminders COMPLETE ===`);
    console.log(`Sent: ${sentCount}, Failed: ${failedCount}, Duration: ${duration}ms`);

    return new Response(JSON.stringify({
      success: true,
      message: `Processed ${reminders.length} reminders`,
      sent: sentCount,
      failed: failedCount,
      errors: errors.length > 0 ? errors : undefined,
      duration_ms: duration,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Send booking reminders error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
