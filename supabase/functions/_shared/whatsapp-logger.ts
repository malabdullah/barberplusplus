// WhatsApp Logging Utility for Admin Tracing
import { getSupabaseClient } from './supabase.ts';

export interface WhatsAppLogEntry {
  conversation_id?: string;
  phone_number?: string;
  log_level: 'debug' | 'info' | 'warn' | 'error';
  event_type: string;
  message: string;
  inbound_message?: string;
  outbound_message?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  error_code?: string;
  error_message?: string;
  stack_trace?: string;
  context_snapshot?: Record<string, unknown>;
  execution_time_ms?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Write a log entry to the whatsapp_logs table
 * Non-blocking - errors are logged to console but don't throw
 */
export async function logWhatsApp(entry: WhatsAppLogEntry): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('whatsapp_logs').insert(entry);
    if (error) {
      console.error('WhatsApp log insert error:', error);
    }
  } catch (err) {
    console.error('Failed to write WhatsApp log:', err);
  }
}

/**
 * Convenience logger with methods for each log level
 */
export const whatsappLogger = {
  debug: (eventType: string, message: string, data?: Partial<WhatsAppLogEntry>) =>
    logWhatsApp({ log_level: 'debug', event_type: eventType, message, ...data }),

  info: (eventType: string, message: string, data?: Partial<WhatsAppLogEntry>) =>
    logWhatsApp({ log_level: 'info', event_type: eventType, message, ...data }),

  warn: (eventType: string, message: string, data?: Partial<WhatsAppLogEntry>) =>
    logWhatsApp({ log_level: 'warn', event_type: eventType, message, ...data }),

  error: (eventType: string, message: string, data?: Partial<WhatsAppLogEntry>) =>
    logWhatsApp({ log_level: 'error', event_type: eventType, message, ...data }),
};

/**
 * Event type constants for consistency
 */
export const WhatsAppLogEvents = {
  // Message events
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_SENT: 'message_sent',

  // Tool events
  TOOL_CALLED: 'tool_called',
  TOOL_RESULT: 'tool_result',
  TOOL_ERROR: 'tool_error',

  // Date parsing events
  DATE_PARSED: 'date_parsed',
  DATE_PARSE_FAILED: 'date_parse_failed',

  // Booking events
  BOOKING_CREATED: 'booking_created',
  BOOKING_CANCELLED: 'booking_cancelled',
  BOOKING_CONFIRMED: 'booking_confirmed',

  // Error events
  API_ERROR: 'api_error',
  AGENT_ERROR: 'agent_error',
  VALIDATION_ERROR: 'validation_error',

  // Context events
  CONTEXT_UPDATED: 'context_updated',
  CONVERSATION_STARTED: 'conversation_started',

  // Auto-handling events
  AUTO_CONFIRM: 'auto_confirm',
  AUTO_TIME_SELECT: 'auto_time_select',
  AUTO_DATE_SELECT: 'auto_date_select',
} as const;
