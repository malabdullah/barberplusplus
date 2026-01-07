// AI Agent - Main orchestration logic
import {
  callClaude,
  continueWithToolResults,
  buildMessagesFromHistory,
  buildMessagesWithToolUse,
} from '../_shared/anthropic.ts';
import {
  getOrCreateConversation,
  updateConversation,
  saveMessage,
  getRecentMessages,
  updateMessageWhatsAppId,
} from '../_shared/supabase.ts';
import { sendTextMessage } from '../_shared/whatsapp.ts';
import { detectLanguage, isKuwaitiDialect, sanitizeInput, getKuwaitDate, parseKuwaitDate, formatDateString, formatTime } from '../_shared/utils.ts';
import { SULAIMAN_SYSTEM_PROMPT, getGreeting, getErrorMessage } from './prompts/sulaiman.ts';
import { AGENT_TOOLS, executeTool } from './tools/index.ts';
import { whatsappLogger, WhatsAppLogEvents } from '../_shared/whatsapp-logger.ts';

const MAX_TOOL_ITERATIONS = 5; // Prevent infinite loops

interface ProcessMessageResult {
  success: boolean;
  response?: string;
  error?: string;
}

/**
 * Process an incoming WhatsApp message
 */
export async function processMessage(
  phoneNumber: string,
  phoneCountryCode: string,
  messageText: string,
  profileName?: string,
  whatsappMessageId?: string,
  buttonId?: string,
  listId?: string,
  flowResponse?: Record<string, unknown>
): Promise<ProcessMessageResult> {
  console.log('=== processMessage START ===');
  console.log('Input:', { phoneNumber, phoneCountryCode, messageText: messageText?.substring(0, 50), profileName, buttonId, listId, hasFlowResponse: !!flowResponse });

  // Log inbound message for tracing
  const fullPhoneNumber = phoneCountryCode + phoneNumber;
  whatsappLogger.info(WhatsAppLogEvents.MESSAGE_RECEIVED, 'Inbound message received', {
    phone_number: fullPhoneNumber,
    inbound_message: messageText,
    metadata: { buttonId, listId, hasFlowResponse: !!flowResponse },
  });

  try {
    // =============================================
    // PAGINATION: Handle "Show more times" selection
    // =============================================
    // Phone number format for tools (no + sign)
    const customerPhoneForTools = phoneCountryCode.replace('+', '') + phoneNumber;

    if (listId === 'more_times') {
      console.log('Pagination: Customer clicked "Show more times"');

      // Get conversation to access stored slots
      const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);
      const context = conversation.context as Record<string, unknown>;

      // Check for slots in regular booking flow OR reschedule flow
      const reschedule = context.pending_reschedule as {
        available_slots?: string[];
        current_date?: string;
        barber_id?: string;
        barber_name?: string;
        barber_name_ar?: string;
      } | undefined;

      const allSlots = (context.all_slots as string[]) || reschedule?.available_slots;
      const isRescheduleFlow = !!reschedule?.available_slots;

      if (allSlots && Array.isArray(allSlots)) {
        const nextPage = ((context.slots_page as number) || 0) + 1;
        console.log('Pagination: Showing page', nextPage, 'isReschedule:', isRescheduleFlow);

        // Get barber/date info from appropriate context
        const barberId = isRescheduleFlow ? reschedule!.barber_id : context.barber_id;
        const barberName = isRescheduleFlow ? reschedule!.barber_name : context.barber_name;
        const barberNameAr = isRescheduleFlow ? reschedule!.barber_name_ar : context.barber_name_ar;
        const date = isRescheduleFlow ? reschedule!.current_date : context.booking_date;

        // Get date display
        const { formatDate } = await import('../_shared/utils.ts');
        const dateDisplay = isRescheduleFlow
          ? formatDate(reschedule!.current_date!, conversation.language as 'en' | 'ar')
          : context.date_display;

        const timeSlotResult = await executeTool('send_time_slot_picker', {
          phone_number: customerPhoneForTools,
          barber_id: barberId,
          barber_name: barberName || 'Barber',
          barber_name_ar: barberNameAr || 'الحلاق',
          date: date,
          date_display: dateDisplay,
          slots: allSlots,
          language: conversation.language || 'ar',
          page: nextPage,
        });

        if (timeSlotResult.success) {
          // Update page in context
          context.slots_page = nextPage;
          await updateConversation(conversation.id, { context });

          const toolData = timeSlotResult.data as { message_id?: string; message_content?: string };
          const savedContent = toolData?.message_content || '[More time slots shown - customer should select a time]';
          await saveMessage(conversation.id, 'outbound', savedContent, toolData?.message_id);
          console.log('Pagination: More time slots sent successfully, page:', nextPage);
          return { success: true, response: savedContent };
        } else {
          console.error('Pagination: send_time_slot_picker failed:', timeSlotResult.error);
          // Fall through to normal processing
        }
      } else {
        console.log('Pagination: No stored slots found in context');
        // Fall through to normal processing
      }
    }

    // =============================================
    // BOOKING PICKER: Handle booking selection from interactive list
    // =============================================
    if (listId?.startsWith('booking_modify_') || listId?.startsWith('booking_cancel_')) {
      console.log('Booking picker: Customer selected a booking:', listId);

      const parts = listId.split('_');
      const action = parts[1]; // 'modify' or 'cancel'
      const bookingId = parts.slice(2).join('_'); // booking UUID

      // Get conversation and booking details
      const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);

      if (action === 'cancel') {
        // Execute cancel directly
        const cancelResult = await executeTool('cancel_booking', { booking_id: bookingId });

        if (cancelResult.success) {
          const cancelMsg = conversation.language === 'en'
            ? `✅ Your booking has been cancelled.`
            : `✅ تم إلغاء حجزك.`;

          await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
          await saveMessage(conversation.id, 'outbound', cancelMsg);
          await sendTextMessage(customerPhoneForTools, cancelMsg);

          console.log('Booking picker: Cancel executed successfully');
          return { success: true, response: cancelMsg };
        } else {
          console.error('Booking picker: cancel_booking failed:', cancelResult.error);
        }
      } else if (action === 'modify') {
        // Get booking details from database
        const { getSupabaseClient } = await import('../_shared/supabase.ts');
        const supabase = getSupabaseClient();
        const { data: booking } = await supabase
          .from('bookings')
          .select(`
            id, date, time, service_ids,
            branch:branches(name, name_ar),
            barber:barbers(id, name, name_ar)
          `)
          .eq('id', bookingId)
          .single();

        if (booking) {
          // Send modify options buttons
          const modifyResult = await executeTool('send_modify_options', {
            phone_number: customerPhoneForTools,
            booking_id: bookingId,
            booking_reference: bookingId.substring(0, 8).toUpperCase(),
            current_date: booking.date,
            current_time: booking.time,
            language: conversation.language || 'ar',
          });

          if (modifyResult.success) {
            // Store pending reschedule context
            const context = conversation.context as Record<string, unknown>;
            context.pending_reschedule = {
              booking_id: bookingId,
              reference: bookingId.substring(0, 8).toUpperCase(),
              current_date: booking.date,
              current_time: booking.time,
              barber_id: (booking.barber as any)?.id,
              barber_name: (booking.barber as any)?.name,
              barber_name_ar: (booking.barber as any)?.name_ar,
              branch_name: (booking.branch as any)?.name,
              branch_name_ar: (booking.branch as any)?.name_ar,
              service_ids: booking.service_ids,
            };
            await updateConversation(conversation.id, { context });

            const modifyData = modifyResult.data as { message_content?: string };
            const savedContent = modifyData?.message_content || '[Modify options shown - customer should select what to change]';
            await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
            await saveMessage(conversation.id, 'outbound', savedContent);

            console.log('Booking picker: Modify options sent');
            return { success: true, response: savedContent };
          }
        }
      }
    }

    // =============================================
    // MODIFY OPTIONS: Handle modify_time, modify_date, cancel_instead buttons
    // =============================================
    if (buttonId?.startsWith('modify_time_') || buttonId?.startsWith('modify_date_') || buttonId?.startsWith('cancel_instead_')) {
      console.log('Modify options: Customer clicked:', buttonId);

      const parts = buttonId.split('_');
      const action = parts[1]; // 'time', 'date', or 'instead' (cancel)
      const bookingId = parts.slice(2).join('_');

      const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);
      const context = conversation.context as Record<string, unknown>;

      if (action === 'instead') {
        // Customer wants to cancel instead of modify
        const cancelResult = await executeTool('cancel_booking', { booking_id: bookingId });

        if (cancelResult.success) {
          const cancelMsg = conversation.language === 'en'
            ? `✅ Your booking has been cancelled.`
            : `✅ تم إلغاء حجزك.`;

          delete context.pending_reschedule;
          await updateConversation(conversation.id, { context });

          await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
          await saveMessage(conversation.id, 'outbound', cancelMsg);
          await sendTextMessage(customerPhoneForTools, cancelMsg);

          console.log('Modify options: Cancelled instead of modifying');
          return { success: true, response: cancelMsg };
        }
      } else if (action === 'time' || action === 'date') {
        // Customer wants to change time or date
        const reschedule = context.pending_reschedule as {
          booking_id: string;
          current_date: string;
          barber_id: string;
          barber_name: string;
          barber_name_ar: string;
        } | undefined;

        if (reschedule && reschedule.barber_id) {
          // Update what they want to change
          (context.pending_reschedule as any).change_type = action;
          await updateConversation(conversation.id, { context });

          if (action === 'time') {
            // Get available slots for the same date and show time picker
            const slotsResult = await executeTool('get_available_slots', {
              barber_id: reschedule.barber_id,
              date: reschedule.current_date,
              duration_minutes: 30, // Default duration
            });

            if (slotsResult.success) {
              const slotsData = slotsResult.data as { slots: string[] };
              if (slotsData.slots && slotsData.slots.length > 0) {
                const { formatDate } = await import('../_shared/utils.ts');
                const dateDisplay = formatDate(reschedule.current_date, conversation.language as 'en' | 'ar');

                const timePickerResult = await executeTool('send_time_slot_picker', {
                  phone_number: customerPhoneForTools,
                  barber_id: reschedule.barber_id,
                  barber_name: reschedule.barber_name,
                  barber_name_ar: reschedule.barber_name_ar,
                  date: reschedule.current_date,
                  date_display: dateDisplay,
                  slots: slotsData.slots,
                  language: conversation.language || 'ar',
                });

                if (timePickerResult.success) {
                  // Store slots for reschedule context
                  (context.pending_reschedule as any).available_slots = slotsData.slots;
                  await updateConversation(conversation.id, { context });

                  const timePickerData = timePickerResult.data as { message_content?: string };
                  const savedContent = timePickerData?.message_content || '[Time slots shown for reschedule - customer should select new time]';
                  await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
                  await saveMessage(conversation.id, 'outbound', savedContent);

                  console.log('Modify options: Time slots sent for reschedule');
                  return { success: true, response: savedContent };
                }
              }
            }
          } else {
            // Customer wants to change date - ask for new date
            const askDateMsg = conversation.language === 'en'
              ? `When would you like to reschedule your appointment? (e.g., "tomorrow", "next Monday")`
              : `متى تبي تغير موعدك؟ (مثلاً: "باجر"، "الاثنين الجاي")`;

            await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
            await saveMessage(conversation.id, 'outbound', askDateMsg);
            await sendTextMessage(customerPhoneForTools, askDateMsg);

            console.log('Modify options: Asked for new date');
            return { success: true, response: askDateMsg };
          }
        }
      }
    }

    // =============================================
    // WHATSAPP FLOW RESPONSE: Handle comprehensive booking flow completion
    // =============================================
    if (flowResponse && flowResponse.branch_id && flowResponse.barber_id && flowResponse.date && flowResponse.time) {
      console.log('Comprehensive booking flow completed:', flowResponse);

      const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);
      const isEnglish = conversation.language === 'en';

      // Extract flow data
      const branchId = flowResponse.branch_id as string;
      const barberId = flowResponse.barber_id as string;
      const serviceIds = flowResponse.service_ids as string[] || [];
      const date = flowResponse.date as string;
      const time = flowResponse.time as string;
      const totalDuration = (flowResponse.total_duration as number) || 30;
      const totalPrice = (flowResponse.total_price as number) || 0;
      const branchName = (flowResponse.branch_name as string) || 'Branch';
      const barberName = (flowResponse.barber_name as string) || 'Barber';
      const serviceNames = (flowResponse.service_names as string) || '';

      // Create the booking directly
      const bookingResult = await executeTool('create_booking', {
        branch_id: branchId,
        barber_id: barberId,
        service_ids: serviceIds,
        customer_name: conversation.customer_name || profileName || 'Customer',
        customer_phone: phoneNumber,
        customer_country_code: phoneCountryCode,
        date,
        time,
        notes: 'Booked via WhatsApp Flow',
      });

      if (bookingResult.success) {
        const bookingData = bookingResult.data as { reference: string; booking_id?: string };
        const reference = bookingData.reference;

        // Format success message
        const successMsg = isEnglish
          ? `✅ Booking Confirmed!\n\n📋 Ref: ${reference}\n🏪 ${branchName}\n💈 ${barberName}\n✂️ ${serviceNames}\n📅 ${date} at ${time}\n💰 ${totalPrice.toFixed(2)} KWD\n\nWe look forward to seeing you!`
          : `✅ تم تأكيد الحجز!\n\n📋 رقم الحجز: ${reference}\n🏪 ${branchName}\n💈 ${barberName}\n✂️ ${serviceNames}\n📅 ${date} الساعة ${time}\n💰 ${totalPrice.toFixed(2)} د.ك\n\nنتشرف بزيارتك!`;

        // Update conversation state
        await updateConversation(conversation.id, {
          current_state: 'idle',
          context: {
            last_booking_reference: reference,
            last_booking_id: bookingData.booking_id,
          },
        });

        await saveMessage(conversation.id, 'inbound', '[Booking Flow completed]', whatsappMessageId);
        await saveMessage(conversation.id, 'outbound', successMsg);
        await sendTextMessage(customerPhoneForTools, successMsg);

        console.log('Comprehensive booking created successfully:', reference);
        return { success: true, response: successMsg };
      } else {
        console.error('Failed to create booking from flow:', bookingResult.error);
        const errorMsg = isEnglish
          ? `Sorry, there was an issue creating your booking. Please try again or contact us directly.`
          : `عذراً، حدث خطأ في إنشاء الحجز. يرجى المحاولة مرة أخرى أو التواصل معنا مباشرة.`;

        await saveMessage(conversation.id, 'inbound', '[Booking Flow failed]', whatsappMessageId);
        await saveMessage(conversation.id, 'outbound', errorMsg);
        await sendTextMessage(customerPhoneForTools, errorMsg);

        return { success: false, error: bookingResult.error };
      }
    }

    // =============================================
    // WHATSAPP FLOW RESPONSE: Handle service selection from Flow (legacy/fallback)
    // =============================================
    if (flowResponse && flowResponse.selected_services) {
      console.log('Flow response: Customer selected services via Flow:', flowResponse.selected_services);

      const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);
      const context = conversation.context as Record<string, unknown>;
      const selectedServiceIds = flowResponse.selected_services as string[];

      if (selectedServiceIds.length > 0) {
        // Get service details from available_services in context
        const availableServices = context.available_services as Array<{
          id: string;
          name: string;
          name_ar: string | null;
          duration: number;
          price: number;
        }> | undefined;

        if (availableServices) {
          const selectedServices = availableServices.filter(s => selectedServiceIds.includes(s.id));
          const serviceNames = selectedServices.map(s =>
            conversation.language === 'en' ? s.name : (s.name_ar || s.name)
          );
          const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);
          const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

          // Update context with selected services
          context.service_ids = selectedServiceIds;
          context.service_names = serviceNames;
          context.total_duration = totalDuration;
          context.total_price = totalPrice;
          context.available_services = undefined; // Clear after selection
          await updateConversation(conversation.id, {
            context,
            current_state: 'select_date',
          });

          // Confirm selection and ask for date
          const isEnglish = conversation.language === 'en';
          const serviceList = serviceNames.join(isEnglish ? ', ' : '، ');
          const confirmMsg = isEnglish
            ? `✅ Selected: ${serviceList}\nTotal: ${totalPrice.toFixed(2)} KWD\n\nWhen would you like your appointment? (e.g., "tomorrow", "next Monday")`
            : `✅ تم الاختيار: ${serviceList}\nالمجموع: ${totalPrice.toFixed(2)} د.ك\n\nمتى تبي موعدك؟ (مثلاً: "باجر"، "الاثنين الجاي")`;

          await saveMessage(conversation.id, 'inbound', `[Flow: Selected ${selectedServiceIds.length} services]`, whatsappMessageId);
          await saveMessage(conversation.id, 'outbound', confirmMsg);
          await sendTextMessage(customerPhoneForTools, confirmMsg);

          console.log('Flow response: Services confirmed, asking for date');
          return { success: true, response: confirmMsg };
        }
      }
    }

    // =============================================
    // TIME SLOT SELECTION FOR RESCHEDULE: Handle slot selection when pending_reschedule exists
    // =============================================
    if (listId?.startsWith('slot_')) {
      const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);
      const context = conversation.context as Record<string, unknown>;

      if (context.pending_reschedule) {
        console.log('Reschedule: Customer selected new time slot:', listId);

        const parts = listId.split('_');
        // Format: slot_{barberId}_{date}_{time}
        const slotDate = parts[2]; // Extract date from slot ID (YYYY-MM-DD)
        const newTime = parts[3].substring(0, 2) + ':' + parts[3].substring(2);

        const reschedule = context.pending_reschedule as {
          booking_id: string;
          reference: string;
          current_date: string;
          barber_name: string;
          barber_name_ar: string;
          branch_name: string;
          branch_name_ar: string;
          service_ids: string[];
        };

        // Get service names
        const { getSupabaseClient } = await import('../_shared/supabase.ts');
        const supabase = getSupabaseClient();
        const { data: services } = await supabase
          .from('services')
          .select('name, name_ar')
          .in('id', reschedule.service_ids || []);

        const isEnglish = conversation.language === 'en';
        const serviceNames = (services || []).map(s => isEnglish ? s.name : (s.name_ar || s.name));

        // Store new date AND time in context (date from slot ID, not current_date)
        (context.pending_reschedule as any).new_date = slotDate;
        (context.pending_reschedule as any).new_time = newTime;
        await updateConversation(conversation.id, { context });

        // Send reschedule confirmation with buttons (using actual selected date)
        const confirmResult = await executeTool('send_reschedule_confirmation', {
          phone_number: customerPhoneForTools,
          booking_id: reschedule.booking_id,
          booking_reference: reschedule.reference,
          branch_name: reschedule.branch_name,
          branch_name_ar: reschedule.branch_name_ar,
          barber_name: reschedule.barber_name,
          barber_name_ar: reschedule.barber_name_ar,
          service_names: serviceNames,
          new_date: slotDate, // Use the date from slot selection, not current_date
          new_time: newTime,
          language: conversation.language || 'ar',
        });

        if (confirmResult.success) {
          const confirmData = confirmResult.data as { message_content?: string };
          const savedContent = confirmData?.message_content || '[Reschedule confirmation shown - waiting for confirm/cancel]';
          await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
          await saveMessage(conversation.id, 'outbound', savedContent);

          console.log('Reschedule: Confirmation sent');
          return { success: true, response: savedContent };
        }
      }
    }

    // =============================================
    // RESCHEDULE CONFIRMATION: Handle confirm_reschedule/cancel_reschedule buttons
    // =============================================
    if (buttonId?.startsWith('confirm_reschedule_') || buttonId?.startsWith('cancel_reschedule_')) {
      console.log('Reschedule confirmation:', buttonId);

      const isConfirm = buttonId.startsWith('confirm_reschedule_');
      const bookingId = buttonId.replace(/^(confirm|cancel)_reschedule_/, '');

      const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);
      const context = conversation.context as Record<string, unknown>;

      if (isConfirm) {
        const reschedule = context.pending_reschedule as {
          booking_id: string;
          reference: string;
          current_date: string;
          new_date?: string; // Date extracted from slot selection
          new_time: string;
        } | undefined;

        if (reschedule && reschedule.new_time) {
          // Use new_date (from slot selection) or fallback to current_date
          const actualNewDate = reschedule.new_date || reschedule.current_date;

          const result = await executeTool('reschedule_booking', {
            booking_id: reschedule.booking_id,
            new_date: actualNewDate,
            new_time: reschedule.new_time,
          });

          if (result.success) {
            const { formatDate, formatTime } = await import('../_shared/utils.ts');
            const successMsg = conversation.language === 'en'
              ? `✅ Your booking has been rescheduled to ${formatDate(actualNewDate, 'en')} at ${formatTime(reschedule.new_time, 'en')}.`
              : `✅ تم تعديل موعدك ليوم ${formatDate(actualNewDate, 'ar')} الساعة ${formatTime(reschedule.new_time, 'ar')}.`;

            delete context.pending_reschedule;
            await updateConversation(conversation.id, { context });

            await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
            await saveMessage(conversation.id, 'outbound', successMsg);
            await sendTextMessage(customerPhoneForTools, successMsg);

            console.log('Reschedule: Confirmed successfully');
            return { success: true, response: successMsg };
          } else {
            console.error('Reschedule: Failed:', result.error);
          }
        }
      } else {
        // Cancel the reschedule flow
        delete context.pending_reschedule;
        await updateConversation(conversation.id, { context });

        const cancelMsg = conversation.language === 'en'
          ? `Reschedule cancelled. Your original booking remains unchanged.`
          : `تم إلغاء التعديل. حجزك الأصلي باقي زي ما هو.`;

        await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
        await saveMessage(conversation.id, 'outbound', cancelMsg);
        await sendTextMessage(customerPhoneForTools, cancelMsg);

        console.log('Reschedule: Cancelled by customer');
        return { success: true, response: cancelMsg };
      }
    }

    // =============================================
    // GREETING BUTTON HANDLERS: Handle greeting_book, greeting_modify, greeting_cancel
    // =============================================
    if (buttonId === 'greeting_book') {
      console.log('Greeting button: Customer wants to book');
      const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);

      const bookMsg = conversation.language === 'en'
        ? "Great! Please type the name of the barbershop or salon you'd like to book at."
        : "ممتاز! اكتب اسم الصالون أو محل الحلاقة اللي تبي تحجز فيه.";

      await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
      await saveMessage(conversation.id, 'outbound', bookMsg);
      await sendTextMessage(customerPhoneForTools, bookMsg);

      return { success: true, response: bookMsg };
    }

    if (buttonId === 'greeting_modify') {
      console.log('Greeting button: Customer wants to modify booking');
      const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);

      // Send booking picker for modification
      const result = await executeTool('send_booking_picker', {
        phone_number: customerPhoneForTools,
        action: 'modify',
        language: conversation.language || 'ar',
      });

      if (result.success) {
        await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
        await saveMessage(conversation.id, 'outbound', '[Booking list for modification sent]');
        return { success: true, response: '[Modify booking list sent]' };
      } else {
        // No bookings found or error
        const noBookingsMsg = conversation.language === 'en'
          ? "You don't have any upcoming bookings to modify. Would you like to make a new booking?"
          : "ما عندك حجوزات قادمة للتعديل. تبي تحجز موعد جديد؟";

        await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
        await saveMessage(conversation.id, 'outbound', noBookingsMsg);
        await sendTextMessage(customerPhoneForTools, noBookingsMsg);
        return { success: true, response: noBookingsMsg };
      }
    }

    if (buttonId === 'greeting_cancel') {
      console.log('Greeting button: Customer wants to cancel booking');
      const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);

      // Send booking picker for cancellation
      const result = await executeTool('send_booking_picker', {
        phone_number: customerPhoneForTools,
        action: 'cancel',
        language: conversation.language || 'ar',
      });

      if (result.success) {
        await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
        await saveMessage(conversation.id, 'outbound', '[Booking list for cancellation sent]');
        return { success: true, response: '[Cancel booking list sent]' };
      } else {
        // No bookings found or error
        const noBookingsMsg = conversation.language === 'en'
          ? "You don't have any upcoming bookings to cancel. Would you like to make a new booking?"
          : "ما عندك حجوزات قادمة للإلغاء. تبي تحجز موعد جديد؟";

        await saveMessage(conversation.id, 'inbound', messageText, whatsappMessageId);
        await saveMessage(conversation.id, 'outbound', noBookingsMsg);
        await sendTextMessage(customerPhoneForTools, noBookingsMsg);
        return { success: true, response: noBookingsMsg };
      }
    }

    // Sanitize input
    const cleanMessage = sanitizeInput(messageText);
    console.log('1. Message sanitized');

    // Get or create conversation
    console.log('2. Getting/creating conversation...');
    const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);
    console.log('3. Conversation ready:', { id: conversation.id, isNew: conversation.isNew });

    // Detect if this is a greeting (new booking attempt) and reset stale context
    const greetingPatterns = [
      'السلام عليكم', 'سلام', 'هلا', 'مرحبا', 'هاي', 'صباح', 'مساء',
      'hello', 'hi', 'hey', 'good morning', 'good evening', 'assalam'
    ];
    const isGreeting = greetingPatterns.some(g =>
      cleanMessage.toLowerCase().includes(g.toLowerCase())
    );

    // If greeting and has stale booking context, reset it for fresh booking flow
    if (isGreeting && Object.keys(conversation.context).length > 0) {
      const staleKeys = ['branch_id', 'branch_name', 'branch_name_ar', 'barber_id', 'barber_name',
        'barber_name_ar', 'booking_date', 'date_display', 'available_barbers', 'available_services',
        'pending_confirmation', 'service_ids'];
      const hasStaleContext = staleKeys.some(key => key in conversation.context);

      if (hasStaleContext) {
        const freshContext: Record<string, unknown> = {};
        // Keep only non-booking data like last_booking_reference for reference
        if (conversation.context.last_booking_reference) {
          freshContext.last_booking_reference = conversation.context.last_booking_reference;
        }
        await updateConversation(conversation.id, { context: freshContext });
        conversation.context = freshContext;
        console.log('Reset stale booking context for new greeting');
      }
    }

    // If greeting detected and no active booking context, send interactive greeting buttons
    // This provides clear action options: Book Now, Modify Booking, Cancel Booking
    if (isGreeting) {
      const hasActiveBookingContext = ['branch_id', 'barber_id', 'service_ids', 'booking_date', 'pending_confirmation']
        .some(key => key in conversation.context);

      if (!hasActiveBookingContext) {
        console.log('Greeting detected with no active booking context, sending interactive greeting buttons');

        // Detect language for greeting
        const detectedLang = detectLanguage(cleanMessage);
        const isKuwaitiGreeting = detectedLang === 'ar' && isKuwaitiDialect(cleanMessage);

        // Save detected language to conversation so subsequent responses use correct language
        if (detectedLang !== conversation.language) {
          await updateConversation(conversation.id, { language: detectedLang });
          console.log('Greeting: Updated conversation language to:', detectedLang);
        }

        // Send greeting with action buttons
        const greetingResult = await executeTool('send_greeting_buttons', {
          phone_number: customerPhoneForTools,
          language: detectedLang,
          is_kuwaiti: isKuwaitiGreeting,
        });

        if (greetingResult.success) {
          // Save incoming message
          await saveMessage(conversation.id, 'inbound', cleanMessage, whatsappMessageId);
          // Save greeting as sent
          const toolData = greetingResult.data as { message_id?: string };
          await saveMessage(conversation.id, 'outbound', '[Greeting with action buttons sent]', toolData?.message_id);
          return { success: true, response: '[Greeting buttons sent]' };
        }

        // Fallback to text greeting if buttons fail
        console.log('Greeting buttons failed, falling back to text greeting');
        const greeting = getGreeting(detectedLang === 'en' ? 'en' : 'ar', isKuwaitiGreeting);

        // Save incoming message
        await saveMessage(conversation.id, 'inbound', cleanMessage, whatsappMessageId);

        // Save and send greeting response
        await saveMessage(conversation.id, 'outbound', greeting);
        await sendTextMessage(customerPhoneForTools, greeting);

        return { success: true, response: greeting };
      }
    }

    // =============================================
    // AUTO-BOOKING-ACTION: Handle cancel or reschedule based on intent
    // =============================================
    const bookingContext = conversation.context as Record<string, unknown>;

    // Arabic numeral conversion helper
    const arabicToEnglish: Record<string, string> = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
    };

    // If customer_bookings exists and customer selected a booking number
    if (bookingContext.customer_bookings) {
      const bookings = bookingContext.customer_bookings as Array<{
        booking_id: string;
        reference: string;
        branch_name: string;
        barber_name: string;
        date: string;
        time: string;
      }>;

      // Parse number from message (supports Arabic numerals too)
      let numStr = cleanMessage.trim();
      for (const [ar, en] of Object.entries(arabicToEnglish)) {
        numStr = numStr.replace(new RegExp(ar, 'g'), en);
      }
      const selectedNum = parseInt(numStr, 10);

      if (!isNaN(selectedNum) && selectedNum >= 1 && selectedNum <= bookings.length) {
        const selectedBooking = bookings[selectedNum - 1];

        // Check recent conversation for intent
        const recentMessages = await getRecentMessages(conversation.id, 5);
        const conversationText = recentMessages.map(m => m.content).join(' ').toLowerCase();

        // Modify/reschedule keywords (Arabic and English)
        const modifyKeywords = ['تعديل', 'عدل', 'غير', 'modify', 'change', 'reschedule', 'تغيير', 'عدله', 'غيره'];
        const isModifyIntent = modifyKeywords.some(k => conversationText.includes(k));

        // Cancel keywords
        const cancelKeywords = ['الغ', 'الغي', 'كنسل', 'cancel', 'إلغاء'];
        const isCancelIntent = cancelKeywords.some(k => conversationText.includes(k));

        console.log('Auto-booking: Selected booking', selectedNum, 'reference:', selectedBooking.reference);
        console.log('Auto-booking: Intent detection - cancel:', isCancelIntent, 'modify:', isModifyIntent);

        if (isCancelIntent && !isModifyIntent) {
          // Execute cancel directly
          const cancelResult = await executeTool('cancel_booking', {
            booking_id: selectedBooking.booking_id
          });

          if (cancelResult.success) {
            const cancelMsg = conversation.language === 'en'
              ? `✅ Booking ${selectedBooking.reference} has been cancelled.`
              : `✅ تم إلغاء الحجز ${selectedBooking.reference}.`;

            await saveMessage(conversation.id, 'inbound', cleanMessage, whatsappMessageId);
            await saveMessage(conversation.id, 'outbound', cancelMsg);
            await sendTextMessage(customerPhoneForTools, cancelMsg);

            delete bookingContext.customer_bookings;
            await updateConversation(conversation.id, { context: bookingContext });

            console.log('Auto-cancel: Booking cancelled successfully');
            return { success: true, response: cancelMsg };
          } else {
            console.error('Auto-cancel: cancel_booking failed:', cancelResult.error);
          }
        } else if (isModifyIntent) {
          // Store for reschedule - customer will provide new time next
          console.log('Auto-booking: Modify intent detected, storing for reschedule');
          bookingContext.pending_reschedule = {
            booking_id: selectedBooking.booking_id,
            reference: selectedBooking.reference,
            current_date: selectedBooking.date,
            current_time: selectedBooking.time,
          };
          delete bookingContext.customer_bookings;
          await updateConversation(conversation.id, { context: bookingContext });
          // Fall through to Claude to ask what to change
        }
      }
    }

    // =============================================
    // AUTO-RESCHEDULE: If pending_reschedule exists and customer provided time
    // =============================================
    if (bookingContext.pending_reschedule) {
      const reschedule = bookingContext.pending_reschedule as {
        booking_id: string;
        reference: string;
        current_date: string;
        current_time: string;
      };

      // Detect if message contains a time (number like "٣" or "3" or "3:00")
      const timeMatch = cleanMessage.match(/(\d+|[٠-٩]+)(?::(\d{2}|[٠-٩]{2}))?/);

      // Check for time keywords to avoid false positives
      const hasTimeContext = /ساعه|ساعة|الساعه|الساعة|وقت|time|pm|am|صباح|مساء/i.test(cleanMessage);

      if (timeMatch && hasTimeContext) {
        console.log('Auto-reschedule: Time detected in message:', cleanMessage);

        // Parse hour (convert Arabic numerals if needed)
        let hourStr = timeMatch[1];
        for (const [ar, en] of Object.entries(arabicToEnglish)) {
          hourStr = hourStr.replace(new RegExp(ar, 'g'), en);
        }
        let hour = parseInt(hourStr, 10);

        // Detect AM/PM from context
        const isPM = hour < 12 && (
          /م|مساء|عصر|pm/i.test(cleanMessage) ||
          (hour >= 1 && hour <= 6) // 1-6 usually means PM for barbershop
        );
        if (isPM) hour += 12;

        const newTime = `${hour.toString().padStart(2, '0')}:00`;
        console.log('Auto-reschedule: Parsed time:', newTime);

        // Execute reschedule
        const result = await executeTool('reschedule_booking', {
          booking_id: reschedule.booking_id,
          new_date: reschedule.current_date,
          new_time: newTime,
        });

        if (result.success) {
          const msg = conversation.language === 'en'
            ? `✅ Booking ${reschedule.reference} rescheduled to ${formatTime(newTime, 'en')}.`
            : `✅ تم تعديل الحجز ${reschedule.reference} للساعة ${formatTime(newTime, 'ar')}.`;

          await saveMessage(conversation.id, 'inbound', cleanMessage, whatsappMessageId);
          await saveMessage(conversation.id, 'outbound', msg);
          await sendTextMessage(customerPhoneForTools, msg);

          delete bookingContext.pending_reschedule;
          await updateConversation(conversation.id, { context: bookingContext });

          console.log('Auto-reschedule: Booking rescheduled successfully');
          return { success: true, response: msg };
        } else {
          console.error('Auto-reschedule: reschedule_booking failed:', result.error);
          // Fall through to Claude to handle error
        }
      }
      // If no time detected, fall through to Claude (customer might say "الوقت" first)
    }

    // Detect language
    const detectedLanguage = detectLanguage(cleanMessage);
    const isKuwaiti = detectedLanguage === 'ar' && isKuwaitiDialect(cleanMessage);

    // Update language based on message content
    // Arabic characters are a reliable signal - if message contains Arabic, update to Arabic
    // English words are also reliable - if message is pure English, update to English
    const wordCount = cleanMessage.trim().split(/\s+/).length;
    const hasArabic = /[\u0600-\u06FF]/.test(cleanMessage);
    const hasEnglishWords = /[a-zA-Z]{2,}/.test(cleanMessage);

    // Allow 1+ word for both Arabic and English language detection
    // Arabic chars are very reliable signal (customers don't accidentally type Arabic)
    const minWordsForUpdate = 1;

    if (wordCount >= minWordsForUpdate && (hasArabic || hasEnglishWords) && detectedLanguage !== conversation.language) {
      await updateConversation(conversation.id, { language: detectedLanguage });
      console.log('Language updated to:', detectedLanguage, 'based on message with', wordCount, 'words');
    }

    // Update customer name if we have it from profile and don't have one yet
    if (profileName && !conversation.customerName) {
      await updateConversation(conversation.id, { customer_name: profileName });
    }

    // AUTO-MATCH BARBER: If customer typed a barber name after seeing barber picker,
    // match it from available_barbers and set barber_id automatically.
    // This helps Claude proceed to service picker without needing to look up the ID.
    const context = conversation.context as Record<string, unknown>;
    if (context.available_barbers && !context.barber_id) {
      const barbers = context.available_barbers as Array<{ id: string; name: string; name_ar: string }>;
      const msgTrimmed = cleanMessage.trim();
      const msgLower = msgTrimmed.toLowerCase();

      for (const barber of barbers) {
        // Match against Arabic name (exact or contains) or English name
        const nameArMatch = barber.name_ar === msgTrimmed ||
                           barber.name_ar.includes(msgTrimmed) ||
                           msgTrimmed.includes(barber.name_ar);
        const nameEnMatch = barber.name.toLowerCase() === msgLower ||
                           barber.name.toLowerCase().includes(msgLower) ||
                           msgLower.includes(barber.name.toLowerCase());

        if (nameArMatch || nameEnMatch) {
          // Found a match! Update context with barber info (both names)
          context.barber_id = barber.id;
          context.barber_name = barber.name;      // English name
          context.barber_name_ar = barber.name_ar; // Arabic name
          await updateConversation(conversation.id, { context });
          conversation.context = context; // Keep local copy in sync
          console.log('Auto-matched barber from available_barbers:', barber.name, barber.name_ar, barber.id);
          break;
        }
      }
    }

    // AUTO-MATCH SERVICE: If customer typed a service name after seeing service picker,
    // match it from available_services and set service_ids automatically.
    if (context.available_services && !context.service_ids) {
      const services = context.available_services as Array<{ id: string; name: string; duration: number; price: number }>;
      const msgLower = cleanMessage.toLowerCase().trim();

      // Check for "both" or "all" keywords FIRST to select all services
      const bothPatterns = ['both', 'all', 'كلهم', 'الكل', 'كله', 'الاثنين', 'الثنين'];
      const wantsBoth = bothPatterns.some(p => msgLower.includes(p));

      if (wantsBoth) {
        // Select ALL available services
        context.service_ids = services.map(s => s.id);
        await updateConversation(conversation.id, { context });
        conversation.context = context;
        console.log('Auto-matched ALL services (both/all):', context.service_ids);
      } else {
        // Common Arabic service keywords
        const serviceKeywords: Record<string, string[]> = {
          'haircut': ['شعر', 'قص', 'حلاقة', 'hair', 'haircut', 'cut'],
          'beard': ['لحية', 'ذقن', 'beard', 'لحيه'],
        };

        const matchedServiceIds: string[] = [];
        for (const service of services) {
          const serviceLower = service.name.toLowerCase();
          // Check if message contains service name or keywords
          const keywords = serviceKeywords[serviceLower] || [serviceLower];
          const isMatch = keywords.some(kw => msgLower.includes(kw.toLowerCase()));

          if (isMatch) {
            matchedServiceIds.push(service.id);
            console.log('Auto-matched service:', service.name, service.id);
          }
        }

        if (matchedServiceIds.length > 0) {
          context.service_ids = matchedServiceIds;
          await updateConversation(conversation.id, { context });
          conversation.context = context;
          console.log('Auto-matched service_ids:', matchedServiceIds);
        }
      }
    }

    // Save incoming message with WhatsApp message ID
    console.log('4. Saving incoming message...');
    await saveMessage(conversation.id, 'inbound', cleanMessage, whatsappMessageId);
    console.log('5. Message saved');

    // Get conversation history for context
    console.log('6. Getting conversation history...');
    const history = await getRecentMessages(conversation.id, 20);
    console.log('7. History retrieved, messages:', history.length);

    // If this is a new conversation, add a greeting context
    let systemPrompt = SULAIMAN_SYSTEM_PROMPT;

    // Add current date reference so Claude can calculate relative dates
    // Use Kuwait timezone (Asia/Kuwait, UTC+3) for all date calculations
    const today = getKuwaitDate();
    const todayStr = formatDateString(today); // YYYY-MM-DD in Kuwait time
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayNamesAr = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const todayDayName = dayNames[today.getDay()];
    const todayDayNameAr = dayNamesAr[today.getDay()];

    // Calculate common date references (all in Kuwait timezone)
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDateString(tomorrow);

    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    const dayAfterTomorrowStr = formatDateString(dayAfterTomorrow);

    // Calculate next Monday (start of next week) instead of just today + 7 days
    const nextMonday = new Date(today);
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, 2=Tue, etc.
    // If today is Sunday (0), next Monday is tomorrow (1 day away)
    // Otherwise, next Monday is (8 - dayOfWeek) days away
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    nextMonday.setDate(nextMonday.getDate() + daysUntilNextMonday);
    const nextWeekStr = formatDateString(nextMonday);

    // Calculate next occurrence of each day of the week
    const getNextDayDate = (targetDay: number): string => {
      const result = new Date(today);
      const currentDay = today.getDay();
      // Calculate days until target day (if today is target, go to next week)
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      result.setDate(result.getDate() + daysUntil);
      return formatDateString(result);
    };

    const nextSundayStr = getNextDayDate(0);    // الأحد
    const nextMondayStr = getNextDayDate(1);    // الاثنين
    const nextTuesdayStr = getNextDayDate(2);   // الثلاثاء
    const nextWednesdayStr = getNextDayDate(3); // الأربعاء
    const nextThursdayStr = getNextDayDate(4);  // الخميس
    const nextFridayStr = getNextDayDate(5);    // الجمعة
    const nextSaturdayStr = getNextDayDate(6);  // السبت

    systemPrompt += `

## CURRENT DATE REFERENCE - USE THIS FOR DATE CALCULATIONS
Today is: ${todayStr} (${todayDayName} / ${todayDayNameAr})
Tomorrow (باجر): ${tomorrowStr}
Day after tomorrow (بعد باجر): ${dayAfterTomorrowStr}
Next week (الاسبوع الجاي): ${nextWeekStr}

When customer says a relative date like "باجر" or "tomorrow", convert it to YYYY-MM-DD format using the dates above.`;

    // Helper: Convert Arabic/Persian numerals (٠١٢٣٤٥٦٧٨٩) to Western (0123456789)
    const convertArabicNumerals = (text: string): string => {
      const arabicNumerals = '٠١٢٣٤٥٦٧٨٩';
      const westernNumerals = '0123456789';
      return text.replace(/[٠-٩]/g, (char) => {
        const index = arabicNumerals.indexOf(char);
        return index >= 0 ? westernNumerals[index] : char;
      });
    };

    // AUTO-DATE-SELECT: If customer typed a relative date after selecting services,
    // parse it and call send_time_slot_picker directly
    const datePatterns: Record<string, string> = {
      'today': todayStr,
      'اليوم': todayStr,
      'tomorrow': tomorrowStr,
      'باجر': tomorrowStr,
      'باچر': tomorrowStr,
      'بكرة': tomorrowStr,
      'بكره': tomorrowStr,
      'next week': nextWeekStr,
      'الاسبوع الجاي': nextWeekStr,
      'الاسبوع الياي': nextWeekStr,  // Kuwaiti dialect variant
      'الأسبوع القادم': nextWeekStr,
      'الاسبوع القادم': nextWeekStr,
      // Day-specific patterns (Arabic + Kuwaiti dialect)
      'الأحد الجاي': nextSundayStr,
      'الاحد الجاي': nextSundayStr,
      'الأحد الياي': nextSundayStr,
      'الاحد الياي': nextSundayStr,
      'الاثنين الجاي': nextMondayStr,
      'الاثنين الياي': nextMondayStr,
      'الإثنين الجاي': nextMondayStr,
      'الإثنين الياي': nextMondayStr,
      'الثلاثاء الجاي': nextTuesdayStr,
      'الثلاثاء الياي': nextTuesdayStr,
      'الأربعاء الجاي': nextWednesdayStr,
      'الاربعاء الجاي': nextWednesdayStr,
      'الأربعاء الياي': nextWednesdayStr,
      'الاربعاء الياي': nextWednesdayStr,
      'الخميس الجاي': nextThursdayStr,
      'الخميس الياي': nextThursdayStr,
      'الجمعة الجاي': nextFridayStr,
      'الجمعة الياي': nextFridayStr,
      'الجمعه الجاي': nextFridayStr,
      'الجمعه الياي': nextFridayStr,
      'السبت الجاي': nextSaturdayStr,
      'السبت الياي': nextSaturdayStr,
      // Kuwaiti short forms (without final ء)
      'الاحد الجاي': nextSundayStr,
      'الاحد الياي': nextSundayStr,
      'الثنين الجاي': nextMondayStr,
      'الثنين الياي': nextMondayStr,
      'الثلاثا الجاي': nextTuesdayStr,
      'الثلاثا الياي': nextTuesdayStr,
      'الاربعا الجاي': nextWednesdayStr,
      'الاربعا الياي': nextWednesdayStr,
      'الجمعه الجاي': nextFridayStr,
      'الجمعه الياي': nextFridayStr,
      // Day + "الاسبوع الجاي/الياي" (day + next week)
      'الأحد الاسبوع الجاي': nextSundayStr,
      'الاحد الاسبوع الجاي': nextSundayStr,
      'الأحد الاسبوع الياي': nextSundayStr,
      'الاحد الاسبوع الياي': nextSundayStr,
      'الاثنين الاسبوع الجاي': nextMondayStr,
      'الاثنين الاسبوع الياي': nextMondayStr,
      'الثنين الاسبوع الجاي': nextMondayStr,
      'الثنين الاسبوع الياي': nextMondayStr,
      'الثلاثاء الاسبوع الجاي': nextTuesdayStr,
      'الثلاثاء الاسبوع الياي': nextTuesdayStr,
      'الثلاثا الاسبوع الجاي': nextTuesdayStr,
      'الثلاثا الاسبوع الياي': nextTuesdayStr,
      'الأربعاء الاسبوع الجاي': nextWednesdayStr,
      'الاربعاء الاسبوع الجاي': nextWednesdayStr,
      'الأربعاء الاسبوع الياي': nextWednesdayStr,
      'الاربعاء الاسبوع الياي': nextWednesdayStr,
      'الاربعا الاسبوع الجاي': nextWednesdayStr,
      'الاربعا الاسبوع الياي': nextWednesdayStr,
      'الخميس الاسبوع الجاي': nextThursdayStr,
      'الخميس الاسبوع الياي': nextThursdayStr,
      'الجمعة الاسبوع الجاي': nextFridayStr,
      'الجمعة الاسبوع الياي': nextFridayStr,
      'الجمعه الاسبوع الجاي': nextFridayStr,
      'الجمعه الاسبوع الياي': nextFridayStr,
      'السبت الاسبوع الجاي': nextSaturdayStr,
      'السبت الاسبوع الياي': nextSaturdayStr,
    };

    // Normalize message: convert Arabic numerals and lowercase
    const msgLower = convertArabicNumerals(cleanMessage.toLowerCase().trim());
    let matchedDate = datePatterns[msgLower];

    // If not a direct pattern match, try parsing "day + date number" like "الاربعا 14"
    if (!matchedDate) {
      // Match Arabic day names (all variants) followed by a date number (1-31)
      const dayDateMatch = msgLower.match(/^(الأحد|الاحد|الاثنين|الثنين|الثلاثاء|الثلاثا|الأربعاء|الاربعاء|الاربعا|الخميس|الجمعة|الجمعه|الجمعة|السبت)\s+(\d{1,2})$/);
      if (dayDateMatch) {
        const [, dayName, dateNum] = dayDateMatch;
        const day = parseInt(dateNum);

        if (day >= 1 && day <= 31) {
          const currentMonth = today.getMonth();
          const currentYear = today.getFullYear();

          // Create date for the given day number in current month
          let targetDate = new Date(currentYear, currentMonth, day);

          // If the date is in the past, try next month
          if (targetDate < today) {
            targetDate = new Date(currentYear, currentMonth + 1, day);
          }

          matchedDate = formatDateString(targetDate);
          console.log(`Day+date pattern matched: "${dayName} ${dateNum}" -> ${matchedDate}`);
        }
      }
    }

    // =============================================
    // RESCHEDULE DATE CHANGE: Handle date response when change_type='date'
    // =============================================
    if (context.pending_reschedule) {
      const reschedule = context.pending_reschedule as {
        booking_id: string;
        reference: string;
        current_date: string;
        barber_id: string;
        barber_name: string;
        barber_name_ar: string;
        change_type?: string;
        service_ids?: string[];
      };

      // Check if customer is providing a new date (change_type='date' was set)
      if (reschedule.change_type === 'date') {
        // Try to parse explicit dates like "10 Jan", "Jan 10", etc. if not already matched
        let rescheduleDate = matchedDate;
        if (!rescheduleDate) {
          const dateMatch = cleanMessage.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i) ||
                            cleanMessage.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*(\d{1,2})/i);
          if (dateMatch) {
            const months: Record<string, number> = {
              jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
              jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
            };
            const dayStr = dateMatch[1].match(/\d+/) ? dateMatch[1] : dateMatch[2];
            const monthStr = (dateMatch[1].match(/[a-z]/i) ? dateMatch[1] : dateMatch[2]).toLowerCase().substring(0, 3);
            const day = parseInt(dayStr);
            const month = months[monthStr];
            if (month !== undefined && day >= 1 && day <= 31) {
              const year = today.getFullYear();
              const targetDate = new Date(year, month, day);
              // If date is in the past, use next year
              if (targetDate < today) {
                targetDate.setFullYear(year + 1);
              }
              rescheduleDate = formatDateString(targetDate);
            }
          }
        }

        if (rescheduleDate) {
          console.log('Reschedule date change: Customer provided new date:', rescheduleDate);

          // Get available slots for the new date with same barber
          const slotsResult = await executeTool('get_available_slots', {
            barber_id: reschedule.barber_id,
            date: rescheduleDate,
            duration_minutes: 30, // Default duration for reschedule
          });

          if (slotsResult.success) {
            const slotsData = slotsResult.data as { slots: string[] };
            if (slotsData.slots && slotsData.slots.length > 0) {
              // Calculate date display
              const { formatDate } = await import('../_shared/utils.ts');
              const dateDisplay = formatDate(rescheduleDate, conversation.language as 'en' | 'ar');

              // Show time slots for the new date
              const timeSlotResult = await executeTool('send_time_slot_picker', {
                phone_number: customerPhoneForTools,
                barber_id: reschedule.barber_id,
                barber_name: reschedule.barber_name || 'Barber',
                barber_name_ar: reschedule.barber_name_ar || 'الحلاق',
                date: rescheduleDate,
                date_display: dateDisplay,
                slots: slotsData.slots,
                language: conversation.language || 'ar',
              });

              if (timeSlotResult.success) {
                // Update context: store new date and slots for pagination
                (context.pending_reschedule as any).current_date = rescheduleDate;
                (context.pending_reschedule as any).available_slots = slotsData.slots;
                context.slots_page = 0;
                await updateConversation(conversation.id, { context });

                const toolData = timeSlotResult.data as { message_id?: string; message_content?: string };
                const savedContent = toolData?.message_content || '[Time slots shown for new date - customer should select a time]';
                await saveMessage(conversation.id, 'outbound', savedContent, toolData?.message_id);
                console.log('Reschedule date change: Time slots sent for new date:', rescheduleDate);
                return { success: true, response: savedContent };
              }
            } else {
              // No slots available on that date
              const noSlotsMsg = conversation.language === 'en'
                ? `Sorry, no slots are available on that date. Please try another date.`
                : `عذراً، ما في مواعيد متاحة بهاليوم. جرب يوم ثاني.`;

              await saveMessage(conversation.id, 'outbound', noSlotsMsg);
              await sendTextMessage(customerPhoneForTools, noSlotsMsg);
              return { success: true, response: noSlotsMsg };
            }
          }
        }
        // If date not recognized, fall through to Claude to ask again
      }
    }

    if (matchedDate && context.service_ids && !context.booking_date) {
      console.log('Auto-date-select: Customer selected relative date, calling send_time_slot_picker');

      // Log successful date parsing
      whatsappLogger.debug(WhatsAppLogEvents.DATE_PARSED, `Date parsed from message: "${cleanMessage}" -> ${matchedDate}`, {
        phone_number: fullPhoneNumber,
        inbound_message: cleanMessage,
        metadata: { parsed_date: matchedDate, original_text: cleanMessage },
      });

      // Calculate display date based on conversation language
      // Use Kuwait-aware parsing to get correct day of week
      const dateObj = parseKuwaitDate(matchedDate);
      const dayNum = dateObj.getDate();
      const isEnglish = conversation.language === 'en';

      let dateDisplay: string;
      if (isEnglish) {
        const monthNamesEn = ['January', 'February', 'March', 'April', 'May', 'June',
                              'July', 'August', 'September', 'October', 'November', 'December'];
        dateDisplay = `${dayNames[dateObj.getDay()]}, ${monthNamesEn[dateObj.getMonth()]} ${dayNum}`;
      } else {
        const monthNamesAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                              'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
        dateDisplay = `${dayNamesAr[dateObj.getDay()]}، ${dayNum} ${monthNamesAr[dateObj.getMonth()]}`;
      }

      // Get service details
      const availableServices = context.available_services as Array<{ id: string; name: string; duration: number; price: number }>;
      const selectedServiceIds = context.service_ids as string[];
      const selectedServices = availableServices?.filter(s => selectedServiceIds.includes(s.id)) || [];
      const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);

      // First get available slots
      const slotsResult = await executeTool('get_available_slots', {
        barber_id: context.barber_id,
        date: matchedDate,
        duration_minutes: totalDuration || 30,
      });

      if (!slotsResult.success) {
        console.error('Auto-date-select: get_available_slots failed:', slotsResult.error);
        // Fall through to Claude
      } else {
        const slotsData = slotsResult.data as { slots: string[] };
        if (slotsData.slots && slotsData.slots.length > 0) {
          const timeSlotResult = await executeTool('send_time_slot_picker', {
            phone_number: customerPhoneForTools,
            barber_id: context.barber_id,
            barber_name: context.barber_name || 'Barber',
            barber_name_ar: context.barber_name_ar || 'الحلاق',
            date: matchedDate,
            date_display: dateDisplay,
            slots: slotsData.slots,
            language: conversation.language || 'ar',
          });

          if (timeSlotResult.success) {
            // Update context with booking date and store all slots for pagination
            context.booking_date = matchedDate;
            context.date_display = dateDisplay;
            context.all_slots = slotsData.slots;  // Store all slots for pagination
            context.slots_page = 0;               // Track current page
            await updateConversation(conversation.id, { context });

            const toolData = timeSlotResult.data as { message_id?: string; message_content?: string };
            const savedContent = toolData?.message_content || '[Time slots shown - customer should select a time]';
            await saveMessage(conversation.id, 'outbound', savedContent, toolData?.message_id);
            console.log('Auto-date-select: Time slots sent successfully, total slots:', slotsData.slots.length);
            return { success: true, response: savedContent };
          } else {
            console.error('Auto-date-select: send_time_slot_picker failed:', timeSlotResult.error);
          }
        } else {
          // No slots available - send helpful message
          console.log('Auto-date-select: No slots available for date:', matchedDate);
          const noSlotsMsg = conversation.language === 'en'
            ? `Sorry, no slots are available on ${dateDisplay}. Would you like to try tomorrow or a different day?`
            : `عذراً، ما في مواعيد متاحة يوم ${dateDisplay}. تبي تجرب باجر أو يوم ثاني؟`;

          await saveMessage(conversation.id, 'outbound', noSlotsMsg);
          await sendTextMessage(customerPhoneForTools, noSlotsMsg);
          return { success: true, response: noSlotsMsg };
        }
      }
    }

    // AUTO-CONFIRM: If pending_confirmation exists and customer confirms via button or text,
    // directly call create_booking without waiting for Claude

    // Check for explicit button click first (more reliable than text pattern matching)
    const isConfirmButton = buttonId === 'confirm_booking';
    const isModifyButton = buttonId === 'modify_booking';

    // Fall back to text pattern matching for typed responses
    const confirmPatterns = ['تأكيد', 'اوكي', 'تمام', 'نعم', 'موافق', 'ok', 'yes', 'confirm'];
    const isConfirmationText = confirmPatterns.some(p =>
      cleanMessage.toLowerCase().includes(p.toLowerCase())
    );

    // Confirmation is valid if button was clicked OR text matches patterns
    const isConfirmation = isConfirmButton || isConfirmationText;

    console.log('Confirmation check:', { buttonId, isConfirmButton, isConfirmationText, isConfirmation, hasPendingConfirmation: !!context.pending_confirmation });

    if (context.pending_confirmation && isConfirmation) {
      console.log('Auto-confirm: Customer confirmed booking, calling create_booking directly');
      const pending = context.pending_confirmation as {
        branch_name: string;
        branch_name_ar?: string;
        barber_name: string;
        barber_name_ar?: string;
        service_names: string[];
        date_display: string;
        time: string;
        total_duration: number;
        total_price: number;
        location_url?: string;
      };

      // Choose display names based on conversation language
      const isEnglish = conversation.language === 'en';
      const displayBranchName = isEnglish ? pending.branch_name : (pending.branch_name_ar || pending.branch_name);
      const displayBarberName = isEnglish ? pending.barber_name : (pending.barber_name_ar || pending.barber_name);
      const locationLine = pending.location_url ? `\n🗺️ ${pending.location_url}` : '';

      // Get service IDs from available_services
      const availableServices = context.available_services as Array<{ id: string; name: string }>;
      const serviceIds = availableServices
        ?.filter(s => pending.service_names.includes(s.name))
        .map(s => s.id) || [];

      const bookingResult = await executeTool('create_booking', {
        phone_number: customerPhoneForTools,
        customer_name: conversation.customerName || profileName || 'عميل',
        branch_id: context.branch_id,
        barber_id: context.barber_id,
        service_ids: serviceIds,
        date: context.booking_date,
        time: pending.time,
      });

      if (bookingResult.success) {
        const data = bookingResult.data as { reference: string };
        // Generate success message in correct language
        const successMsg = isEnglish
          ? `✅ Your booking is confirmed!

📋 Reference: ${data.reference}
📍 ${displayBranchName}${locationLine}
💇 ${displayBarberName}
📅 ${pending.date_display} at ${pending.time}
💰 ${pending.total_price} KD

We look forward to seeing you! 🙏`
          : `✅ تم تأكيد حجزك!

📋 رقم الحجز: ${data.reference}
📍 ${displayBranchName}${locationLine}
💇 ${displayBarberName}
📅 ${pending.date_display} الساعة ${pending.time}
💰 ${pending.total_price} د.ك

نتشرف بزيارتك! 🙏`;

        await saveMessage(conversation.id, 'outbound', successMsg);
        await sendTextMessage(customerPhoneForTools, successMsg);

        // Clear booking context after successful booking
        delete context.branch_id;
        delete context.branch_name;
        delete context.branch_name_ar;
        delete context.barber_id;
        delete context.barber_name;
        delete context.barber_name_ar;
        delete context.available_barbers;
        delete context.available_services;
        delete context.booking_date;
        delete context.date_display;
        delete context.pending_confirmation;
        // Clear pagination data
        delete context.all_slots;
        delete context.slots_page;
        context.last_booking_reference = data.reference;
        await updateConversation(conversation.id, { context });

        return { success: true, response: successMsg };
      } else {
        console.error('Auto-confirm booking failed:', bookingResult.error);
        // Fall through to Claude to handle the error
      }
    }

    // AUTO-TIME-SELECT: If customer typed a time after seeing time slots,
    // call send_confirmation_buttons directly
    const timeRegex = /^(\d{1,2}):?(\d{2})?\s*(ص|م|am|pm)?$/i;
    const timeMatch = cleanMessage.trim().match(timeRegex);

    if (timeMatch && context.booking_date && context.service_ids && !context.pending_confirmation) {
      console.log('Auto-time-select: Customer selected time, calling send_confirmation_buttons directly');

      // Parse the time
      let hour = parseInt(timeMatch[1], 10);
      const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const period = timeMatch[3]?.toLowerCase();

      // Convert to 24h format if needed
      if (period === 'م' || period === 'pm') {
        if (hour < 12) hour += 12;
      } else if (period === 'ص' || period === 'am') {
        if (hour === 12) hour = 0;
      }

      const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const displayTime = `${hour > 12 ? hour - 12 : hour}:${minute.toString().padStart(2, '0')} ${hour >= 12 ? 'م' : 'ص'}`;

      // Get service details from available_services
      const availableServices = context.available_services as Array<{ id: string; name: string; name_ar?: string; duration: number; price: number }>;
      const selectedServiceIds = context.service_ids as string[];
      const selectedServices = availableServices?.filter(s => selectedServiceIds.includes(s.id)) || [];

      if (selectedServices.length > 0) {
        const serviceNames = selectedServices.map(s => s.name);
        const serviceNamesAr = selectedServices.map(s => s.name_ar || s.name);
        const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);
        const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

        const confirmResult = await executeTool('send_confirmation_buttons', {
          phone_number: customerPhoneForTools,
          branch_name: context.branch_name || 'Salon',
          branch_name_ar: context.branch_name_ar || 'الصالون',
          barber_name: context.barber_name || 'Barber',
          barber_name_ar: context.barber_name_ar || 'الحلاق',
          service_names: serviceNames,
          service_names_ar: serviceNamesAr,
          date_display: context.date_display || context.booking_date,
          time: timeStr,
          total_duration: totalDuration,
          total_price: totalPrice,
          language: conversation.language || 'ar',
          location_url: context.location_url || '',
        });

        if (confirmResult.success) {
          // Save context for pending confirmation (both English and Arabic names)
          context.pending_confirmation = {
            branch_name: context.branch_name,
            branch_name_ar: context.branch_name_ar,
            barber_name: context.barber_name,
            barber_name_ar: context.barber_name_ar,
            service_names: serviceNames,
            service_names_ar: serviceNamesAr,
            date_display: context.date_display || context.booking_date,
            time: timeStr,
            total_duration: totalDuration,
            total_price: totalPrice,
            location_url: context.location_url,
          };
          await updateConversation(conversation.id, { context });

          const toolData = confirmResult.data as { message_id?: string; message_content?: string };
          const savedContent = toolData?.message_content || '[Confirmation buttons sent - waiting for confirm/modify]';
          await saveMessage(conversation.id, 'outbound', savedContent, toolData?.message_id);
          console.log('Auto-time-select: Confirmation sent successfully');
          return { success: true, response: savedContent };
        } else {
          console.error('Auto-time-select: send_confirmation_buttons failed:', confirmResult.error);
        }
      }
    }

    if (conversation.isNew) {
      systemPrompt += `\n\nThis is a new conversation. The customer just sent their first message. Their WhatsApp profile name is: ${profileName || 'Unknown'}. Customer phone for tools: ${customerPhoneForTools}`;
    } else {
      systemPrompt += `\n\nConversation context: Language: ${detectedLanguage}${isKuwaiti ? ' (Kuwaiti dialect)' : ''}. Customer name: ${conversation.customerName || profileName || 'Unknown'}. Customer phone for tools: ${customerPhoneForTools}`;

      // Add current context if exists
      if (Object.keys(conversation.context).length > 0) {
        systemPrompt += `\n\nCurrent booking context: ${JSON.stringify(conversation.context)}`;
      }
    }

    // Build messages for Claude
    // Remove the last message from history since we're adding it as the current message
    const previousMessages = history.slice(0, -1);
    const messages = buildMessagesFromHistory(previousMessages, cleanMessage);
    console.log('8. Messages built for Claude, count:', messages.length);

    // Call Claude with tools
    console.log('9. Calling Claude API...');
    let response = await callClaude(systemPrompt, messages, AGENT_TOOLS);
    console.log('10. Claude response received:', { stopReason: response.stopReason, hasResponse: !!response.response, toolCallCount: response.toolCalls.length });
    let iterations = 0;
    // Don't capture text as final response when Claude is making tool calls
    // That text is just "thinking/narration" before tools execute (e.g., "Now, I'll check...")
    let finalResponse = response.stopReason === 'tool_use' ? null : response.response;
    // Track if a tool sends a message directly (like send_time_slot_picker)
    let messageSentByTool = false;
    // Track which picker tool sent the message
    let pickerToolName: string | null = null;
    // Track the WhatsApp message ID from tools that send messages directly
    let toolSentMessageId: string | null = null;
    // Track the actual message content sent by tools
    let toolSentMessageContent: string | null = null;
    // Track tool errors for better error messages
    let lastToolError: string | null = null;

    // Handle tool calls
    while (response.stopReason === 'tool_use' && iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      // Execute all tool calls
      const toolResults: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = [];

      for (const toolCall of response.toolCalls) {
        console.log(`Executing tool: ${toolCall.name}`, toolCall.input);
        const result = await executeTool(toolCall.name, toolCall.input);

        // Check if this tool sent a message directly (interactive pickers)
        const messageTools = [
          'send_time_slot_picker',
          'send_barber_picker',
          'send_service_picker',
          'send_confirmation_buttons',
          'send_booking_picker',
          'send_modify_options',
          'send_reschedule_confirmation',
          'send_greeting_buttons',
        ];
        if (messageTools.includes(toolCall.name) && result.success) {
          messageSentByTool = true;
          pickerToolName = toolCall.name;
          // Capture the WhatsApp message ID and content from tool result for tracking
          const toolData = result.data as { message_id?: string; message_content?: string };
          if (toolData?.message_id) {
            toolSentMessageId = toolData.message_id;
          }
          if (toolData?.message_content) {
            toolSentMessageContent = toolData.message_content;
          }
          console.log('Tool sent message directly:', toolCall.name, 'messageId:', toolSentMessageId);
        }

        toolResults.push({
          tool_use_id: toolCall.id,
          content: JSON.stringify(result),
          is_error: !result.success,
        });

        // Track tool errors for better fallback messages
        if (!result.success && result.error) {
          lastToolError = result.error as string;
          console.log(`Tool ${toolCall.name} failed:`, lastToolError);
        }

        // Update conversation context based on tool results
        if (result.success && result.data) {
          await updateContextFromToolResult(
            conversation.id,
            conversation.context,
            toolCall.name,
            toolCall.input,
            result.data
          );
        }
      }

      // Build messages with tool use and results
      const messagesWithTools = buildMessagesWithToolUse(
        previousMessages,
        cleanMessage,
        response.toolCalls,
        response.response || undefined
      );

      // Continue conversation with tool results
      response = await continueWithToolResults(
        systemPrompt,
        messagesWithTools,
        AGENT_TOOLS,
        toolResults
      );

      // Capture final text response ONLY when Claude is done with all tool calls
      // Text with stopReason='tool_use' is just thinking/narration, not the final answer
      if (response.response && response.stopReason !== 'tool_use') {
        finalResponse = response.response;
      }
    }

    // If a tool already sent a message (like send_time_slot_picker), don't send duplicate
    if (messageSentByTool) {
      console.log('11. Tool already sent message, skipping duplicate send');
      // Use actual message content from tool if available, otherwise fall back to description
      let savedContent = toolSentMessageContent || '[Interactive message sent]';
      if (!toolSentMessageContent) {
        // Fall back to descriptive placeholder if tool didn't return message_content
        switch (pickerToolName) {
          case 'send_barber_picker':
            savedContent = '[Barber picker sent - customer should select a barber]';
            break;
          case 'send_service_picker':
            savedContent = '[Services shown - customer should select service(s)]';
            break;
          case 'send_time_slot_picker':
            savedContent = '[Time slots shown - customer should select a time]';
            break;
          case 'send_confirmation_buttons':
            savedContent = '[Confirmation buttons sent - waiting for confirm/modify]';
            break;
          case 'send_booking_picker':
            savedContent = '[Booking list shown - customer should select a booking]';
            break;
          case 'send_modify_options':
            savedContent = '[Modify options shown - customer should select what to change]';
            break;
          case 'send_reschedule_confirmation':
            savedContent = '[Reschedule confirmation shown - waiting for confirm/cancel]';
            break;
          case 'send_greeting_buttons':
            savedContent = '[Greeting with action buttons sent - customer should select an option]';
            break;
        }
      }
      // Save the message with the WhatsApp message ID from the tool
      await saveMessage(conversation.id, 'outbound', savedContent, toolSentMessageId || undefined);
      console.log('12. Interactive message saved with WhatsApp ID:', toolSentMessageId, 'content:', savedContent.substring(0, 50) + '...');
      return { success: true, response: savedContent };
    }

    // If Claude generated placeholder text (copied from history), reject it
    // This happens when a picker tool fails and Claude sees placeholders in history
    // Use regex to catch ALL placeholder variations like:
    // [Interactive list sent], [Barber picker sent - customer should select a barber], etc.
    const placeholderRegex = /\[(?:Interactive|Confirmation|Booking|Service|Time|Barber|Services|picker|list|buttons|slots).*?(?:sent|picker|list|summary|select|waiting|shown).*?\]/i;
    if (finalResponse && placeholderRegex.test(finalResponse)) {
      console.log('WARNING: Claude generated placeholder text, rejecting:', finalResponse);
      finalResponse = null; // Force fallback message
    }

    // If we still don't have a response, generate a context-aware fallback
    if (!finalResponse) {
      console.log('WARNING: No response after tool loop. Last tool error:', lastToolError);
      const context = conversation.context as Record<string, unknown>;
      // Use conversation language (established from previous messages) instead of detected language
      // This prevents "12:00" being detected as English and sending English fallback to Arabic speakers
      const fallbackLanguage = conversation.language || 'ar';

      // PRIORITY: If there's a tool error, handle it first before context-based fallbacks
      // This prevents wrong messages like "select time" when the customer already selected a time
      // but the confirmation tool failed due to missing parameters
      if (lastToolError) {
        // Check if it's a parameter error from send_confirmation_buttons
        if (lastToolError.includes('service_names') || lastToolError.includes('total_price') || lastToolError.includes('total_duration')) {
          // Confirmation tool failed - apologize and ask customer to try again
          finalResponse = fallbackLanguage === 'en'
            ? "I'm having trouble processing your booking. Could you please tell me what services you'd like? (e.g., haircut, beard)"
            : "عذراً، واجهت مشكلة في تأكيد الحجز. ممكن تقولي شنو الخدمات اللي تباها؟ (مثلاً: قص شعر، لحية)";
        } else {
          // Other tool errors - show the error message
          finalResponse = fallbackLanguage === 'en'
            ? `I'm sorry, I had trouble completing your request. Please try again.`
            : `عذراً، واجهت صعوبة في إتمام طلبك. ممكن تجرب مرة ثانية؟`;
        }
      } else if (context.available_barbers && !context.barber_id) {
        // Customer was shown barber list but hasn't selected one
        finalResponse = fallbackLanguage === 'en'
          ? "Please select a barber from the list, or type their name."
          : "اختر الحلاق من القائمة، أو اكتب اسمه.";
      } else if (context.barber_id && !context.available_services) {
        // Customer selected barber but Claude didn't call send_service_picker
        // Actually call the service picker as a fallback
        console.log('Fallback: Calling send_service_picker for barber_id:', context.barber_id);
        const servicePickerResult = await executeTool('send_service_picker', {
          phone_number: customerPhoneForTools,
          barber_id: context.barber_id,
          barber_name: context.barber_name || 'Barber',
          barber_name_ar: context.barber_name_ar || 'الحلاق',
          language: conversation.language || 'ar',
        });

        if (servicePickerResult.success) {
          // Service picker sent successfully - save and return
          const toolData = servicePickerResult.data as { message_id?: string; message_content?: string };
          const savedContent = toolData?.message_content || '[Services shown - customer should select service(s)]';
          await saveMessage(conversation.id, 'outbound', savedContent, toolData?.message_id);
          console.log('Fallback service picker sent successfully');
          return { success: true, response: savedContent };
        }

        // If service picker failed, show error message
        finalResponse = fallbackLanguage === 'en'
          ? "I'm having trouble loading services. Please try again."
          : "عذراً، واجهت مشكلة في تحميل الخدمات. ممكن تجرب مرة ثانية؟";
      } else if (context.available_services && !context.booking_date) {
        // Check if customer's message looks like a date but services aren't selected
        const dateLikePatterns = ['today', 'tomorrow', 'next', 'باجر', 'بكرة', 'الاسبوع', 'غدا', 'اليوم'];
        const msgLowerForFallback = cleanMessage.toLowerCase();
        const looksLikeDate = dateLikePatterns.some(p => msgLowerForFallback.includes(p));

        if (looksLikeDate && !context.service_ids) {
          // Customer gave a date but services aren't selected
          finalResponse = fallbackLanguage === 'en'
            ? "I'd love to book that date for you! But first, which services would you like? Please select from the options above."
            : "حلو! بس قبل ما نحجز، شنو الخدمات اللي تباها؟ اختر من القائمة اللي فوق.";
        } else {
          // Customer was shown services but hasn't provided date
          finalResponse = fallbackLanguage === 'en'
            ? "When would you like your appointment?"
            : "متى تبي الموعد؟";
        }
      } else if (context.booking_date && !context.pending_confirmation) {
        // Customer provided date but confirmation not sent
        finalResponse = fallbackLanguage === 'en'
          ? "Please select a time from the available slots."
          : "اختر وقت من الأوقات المتاحة.";
      } else if (context.pending_confirmation) {
        // Confirmation was shown, waiting for customer to confirm
        const pending = context.pending_confirmation as { time: string; date_display: string };
        finalResponse = fallbackLanguage === 'en'
          ? `Please confirm your booking for ${pending.date_display} at ${pending.time}. Reply "confirm" or "yes"`
          : `هل تأكد الحجز يوم ${pending.date_display} الساعة ${pending.time}؟ رد بـ "تأكيد" أو "اوكي"`;
      } else {
        // Generic fallback only if we have no context
        finalResponse = getErrorMessage(fallbackLanguage);
      }
    }

    // Save outgoing message first to get DB record ID
    console.log('11. Saving outgoing message...');
    const dbMessageId = await saveMessage(conversation.id, 'outbound', finalResponse);
    console.log('12. Outgoing message saved with ID:', dbMessageId);

    // Send response via WhatsApp
    const sendToPhone = phoneCountryCode.replace('+', '') + phoneNumber;
    console.log('13. Sending WhatsApp message to:', sendToPhone);
    const sendResult = await sendTextMessage(sendToPhone, finalResponse);
    console.log('14. WhatsApp send result:', sendResult);

    if (!sendResult.success) {
      console.error('Failed to send WhatsApp message:', sendResult.error);
      return { success: false, error: sendResult.error };
    }

    // Update the message record with WhatsApp message ID for status tracking
    if (sendResult.messageId) {
      await updateMessageWhatsAppId(dbMessageId, sendResult.messageId);
      console.log('15. Message linked with WhatsApp ID:', sendResult.messageId);
    }

    return { success: true, response: finalResponse };
  } catch (error) {
    console.error('=== processMessage ERROR ===');
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');

    // Log error for admin tracing
    whatsappLogger.error(WhatsAppLogEvents.AGENT_ERROR, 'processMessage failed', {
      phone_number: fullPhoneNumber,
      inbound_message: messageText,
      error_message: error instanceof Error ? error.message : String(error),
      stack_trace: error instanceof Error ? error.stack : undefined,
      metadata: { buttonId, listId },
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Update conversation context based on tool results
 * IMPORTANT: This mutates currentContext directly so conversation.context stays in sync
 */
async function updateContextFromToolResult(
  conversationId: string,
  currentContext: Record<string, unknown>,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolData: unknown
): Promise<void> {
  // Track if we made any changes
  let contextChanged = false;

  switch (toolName) {
    case 'get_branches':
      // If user selected a branch (single result or from list), store it
      break;

    case 'get_barbers':
      // Store selected branch
      if (toolInput.branch_id) {
        currentContext.branch_id = toolInput.branch_id;
        contextChanged = true;
      }
      break;

    case 'get_services':
      // Branch already selected
      break;

    case 'send_barber_picker':
      // Store branch info and available barbers (both English and Arabic names)
      if (toolInput.branch_id) {
        currentContext.branch_id = toolInput.branch_id;
        currentContext.branch_name = toolInput.branch_name;
        currentContext.branch_name_ar = toolInput.branch_name_ar;
        // Store location_url from input if provided
        if (toolInput.location_url) {
          currentContext.location_url = toolInput.location_url as string;
        }
        contextChanged = true;
      }
      const barberPickerData = toolData as { barbers?: Array<{ id: string; name: string; name_ar: string }>; location_url?: string };
      if (barberPickerData.barbers) {
        currentContext.available_barbers = barberPickerData.barbers;
        contextChanged = true;
      }
      // Store location URL if provided
      if (barberPickerData.location_url) {
        currentContext.location_url = barberPickerData.location_url;
        contextChanged = true;
      }
      break;

    case 'send_service_picker':
      // Store barber info and available services (both English and Arabic names)
      if (toolInput.barber_id) {
        currentContext.barber_id = toolInput.barber_id;
        currentContext.barber_name = toolInput.barber_name;
        currentContext.barber_name_ar = toolInput.barber_name_ar;
        contextChanged = true;
      }
      const servicePickerData = toolData as {
        branch_id?: string;
        services?: Array<{ id: string; name: string; duration: number; price: number }>;
      };
      if (servicePickerData.branch_id) {
        currentContext.branch_id = servicePickerData.branch_id;
        contextChanged = true;
      }
      if (servicePickerData.services) {
        currentContext.available_services = servicePickerData.services;
        contextChanged = true;
      }
      break;

    case 'send_time_slot_picker':
      // Store date and barber info (both English and Arabic names)
      currentContext.booking_date = toolInput.date;
      currentContext.date_display = toolInput.date_display;
      if (toolInput.barber_id) {
        currentContext.barber_id = toolInput.barber_id;
        currentContext.barber_name = toolInput.barber_name;
        currentContext.barber_name_ar = toolInput.barber_name_ar;
      }
      // Store all slots for pagination (when Claude calls this tool)
      if (toolInput.slots && Array.isArray(toolInput.slots)) {
        currentContext.all_slots = toolInput.slots;
        currentContext.slots_page = toolInput.page || 0;
      }
      contextChanged = true;
      break;

    case 'send_confirmation_buttons':
      // Store pending confirmation details (both English and Arabic names)
      currentContext.pending_confirmation = {
        branch_name: toolInput.branch_name,
        branch_name_ar: toolInput.branch_name_ar,
        barber_name: toolInput.barber_name,
        barber_name_ar: toolInput.barber_name_ar,
        service_names: toolInput.service_names,
        service_names_ar: toolInput.service_names_ar,
        date_display: toolInput.date_display,
        time: toolInput.time,
        total_duration: toolInput.total_duration,
        total_price: toolInput.total_price,
        location_url: toolInput.location_url,
      };
      contextChanged = true;
      break;

    case 'search_barber_by_name':
      // Store found barber info for subsequent operations (both English and Arabic names)
      const searchData = toolData as {
        found: boolean;
        barbers?: Array<{
          id: string;
          name: string;
          name_ar: string;
          branch_id: string;
          branch_name: string;
          branch_name_ar: string;
        }>;
      };
      if (searchData.found && searchData.barbers && searchData.barbers.length === 1) {
        // If exactly one barber found, store their info (both English and Arabic)
        const barber = searchData.barbers[0];
        currentContext.barber_id = barber.id;
        currentContext.barber_name = barber.name;           // English
        currentContext.barber_name_ar = barber.name_ar;     // Arabic
        currentContext.branch_id = barber.branch_id;
        currentContext.branch_name = barber.branch_name;    // English
        currentContext.branch_name_ar = barber.branch_name_ar; // Arabic
        contextChanged = true;
      }
      break;

    case 'create_booking':
      // Store booking details
      const bookingData = toolData as {
        booking_id: string;
        reference: string;
        branch_name: string;
        barber_name: string;
        services: string[];
        date: string;
        time: string;
        duration_minutes: number;
        total_price: number;
      };
      currentContext.last_booking_id = bookingData.booking_id;
      currentContext.last_booking_reference = bookingData.reference;
      // Clear booking context after successful booking
      delete currentContext.branch_id;
      delete currentContext.branch_name;
      delete currentContext.branch_name_ar;
      delete currentContext.barber_id;
      delete currentContext.barber_name;
      delete currentContext.barber_name_ar;
      delete currentContext.service_ids;
      delete currentContext.available_services;
      delete currentContext.available_barbers;
      delete currentContext.booking_date;
      delete currentContext.date_display;
      delete currentContext.pending_confirmation;
      // Clear pagination data
      delete currentContext.all_slots;
      delete currentContext.slots_page;
      contextChanged = true;
      break;

    case 'get_customer_bookings':
      // Store booking list for potential cancellation OR reschedule
      // The tool returns an array of bookings directly
      // Using neutral name 'customer_bookings' - intent detected later in processMessage
      if (Array.isArray(toolData) && toolData.length > 0) {
        currentContext.customer_bookings = toolData;
        contextChanged = true;
        console.log('Stored', toolData.length, 'bookings for potential action');
      }
      break;

    case 'cancel_booking':
    case 'reschedule_booking':
      // Clear any stored booking context
      delete currentContext.booking_id;
      delete currentContext.customer_bookings;
      delete currentContext.pending_reschedule;
      contextChanged = true;
      break;

    case 'send_booking_picker':
      // Store bookings data for selection handling
      const bookingPickerData = toolData as { bookings?: Array<{ booking_id: string; reference: string; date: string; time: string; barber_name: string; barber_name_ar: string; branch_name: string; branch_name_ar: string; service_ids: string[] }> };
      if (bookingPickerData.bookings) {
        currentContext.available_bookings = bookingPickerData.bookings;
        contextChanged = true;
      }
      break;

    case 'send_modify_options':
      // Store pending reschedule info from tool input
      if (toolInput.booking_id) {
        currentContext.pending_reschedule = {
          booking_id: toolInput.booking_id,
          reference: toolInput.booking_reference,
          current_date: toolInput.current_date,
          current_time: toolInput.current_time,
        };
        contextChanged = true;
      }
      break;

    case 'send_reschedule_confirmation':
      // Store new time for confirmation
      if (toolInput.booking_id && currentContext.pending_reschedule) {
        (currentContext.pending_reschedule as any).new_date = toolInput.new_date;
        (currentContext.pending_reschedule as any).new_time = toolInput.new_time;
        contextChanged = true;
      }
      break;
  }

  // Update DB if context changed
  if (contextChanged) {
    await updateConversation(conversationId, { context: currentContext });
  }
}

/**
 * Send a proactive message (for reminders, notifications)
 */
export async function sendProactiveMessage(
  phoneNumber: string,
  phoneCountryCode: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get or create conversation to maintain history
    const conversation = await getOrCreateConversation(phoneNumber, phoneCountryCode);

    // Save outgoing message first to get DB record ID
    const dbMessageId = await saveMessage(conversation.id, 'outbound', message);

    // Send via WhatsApp
    const fullPhoneNumber = phoneCountryCode.replace('+', '') + phoneNumber;
    const result = await sendTextMessage(fullPhoneNumber, message);

    // Update the message record with WhatsApp message ID for status tracking
    if (result.success && result.messageId) {
      await updateMessageWhatsAppId(dbMessageId, result.messageId);
    }

    return result;
  } catch (error) {
    console.error('Error sending proactive message:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
