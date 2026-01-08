// Supabase client for Edge Functions
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

let supabaseClient: SupabaseClient | null = null;

/**
 * Get Supabase client instance (singleton pattern)
 * Uses service role key for full database access
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseClient;
}

/**
 * Get or create a conversation for a phone number
 */
export async function getOrCreateConversation(
  phoneNumber: string,
  phoneCountryCode: string = '+965'
): Promise<{ id: string; isNew: boolean; context: Record<string, unknown>; language: string; customerName: string | null }> {
  const supabase = getSupabaseClient();

  // Try to find existing conversation
  const { data: existing, error: findError } = await supabase
    .from('whatsapp_conversations')
    .select('id, context, language, customer_name')
    .eq('phone_number', phoneNumber)
    .eq('phone_country_code', phoneCountryCode)
    .single();

  if (existing && !findError) {
    // Update last_message_at
    await supabase
      .from('whatsapp_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', existing.id);

    return {
      id: existing.id,
      isNew: false,
      context: existing.context || {},
      language: existing.language || 'ar',
      customerName: existing.customer_name,
    };
  }

  // Create new conversation
  const { data: newConversation, error: createError } = await supabase
    .from('whatsapp_conversations')
    .insert({
      phone_number: phoneNumber,
      phone_country_code: phoneCountryCode,
      current_state: 'greeting',
      context: {},
      language: 'ar',
    })
    .select('id')
    .single();

  if (createError) {
    throw new Error(`Failed to create conversation: ${createError.message}`);
  }

  return {
    id: newConversation.id,
    isNew: true,
    context: {},
    language: 'ar',
    customerName: null,
  };
}

/**
 * Update conversation context and state
 */
export async function updateConversation(
  conversationId: string,
  updates: {
    current_state?: string;
    context?: Record<string, unknown>;
    language?: string;
    customer_name?: string;
  }
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('whatsapp_conversations')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  if (error) {
    throw new Error(`Failed to update conversation: ${error.message}`);
  }
}

/**
 * Save a message to the database
 */
export async function saveMessage(
  conversationId: string,
  direction: 'inbound' | 'outbound',
  content: string,
  whatsappMessageId?: string,
  messageType: string = 'text',
  metadata: Record<string, unknown> = {}
): Promise<string> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('whatsapp_messages')
    .insert({
      conversation_id: conversationId,
      direction,
      content,
      whatsapp_message_id: whatsappMessageId,
      message_type: messageType,
      metadata,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save message: ${error.message}`);
  }

  return data.id;
}

/**
 * Get recent messages for a conversation (for context)
 */
export async function getRecentMessages(
  conversationId: string,
  limit: number = 10
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('direction, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to get messages: ${error.message}`);
  }

  // Reverse to get chronological order and map to Claude format
  return (data || []).reverse().map((msg) => ({
    role: msg.direction === 'inbound' ? 'user' as const : 'assistant' as const,
    content: msg.content,
  }));
}

/**
 * Update message status (for delivery receipts)
 */
export async function updateMessageStatus(
  whatsappMessageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed'
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('whatsapp_messages')
    .update({ status })
    .eq('whatsapp_message_id', whatsappMessageId);

  if (error) {
    console.error(`Failed to update message status: ${error.message}`);
  }
}

/**
 * Update a message's WhatsApp message ID after sending
 * This links the database record to the actual WhatsApp message
 */
export async function updateMessageWhatsAppId(
  dbMessageId: string,
  whatsappMessageId: string
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('whatsapp_messages')
    .update({ whatsapp_message_id: whatsappMessageId })
    .eq('id', dbMessageId);

  if (error) {
    console.error(`Failed to update message WhatsApp ID: ${error.message}`);
  }
}

/**
 * Get pending reminders that need to be sent
 * Customer data is fetched via join on customers table
 */
export async function getPendingReminders(): Promise<Array<{
  id: string;
  booking_id: string;
  booking: {
    date: string;
    time: string;
    customer: {
      name: string;
      phone: string;
      country_code: string;
    };
    branch: { name: string; name_ar: string };
    barber: { name: string; name_ar: string };
  };
}>> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('booking_reminders')
    .select(`
      id,
      booking_id,
      booking:bookings (
        date,
        time,
        customer:customers (name, phone, country_code),
        branch:branches (name, name_ar),
        barber:barbers (name, name_ar)
      )
    `)
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .limit(50);

  if (error) {
    throw new Error(`Failed to get pending reminders: ${error.message}`);
  }

  return data || [];
}

/**
 * Mark reminder as sent or failed
 */
export async function updateReminderStatus(
  reminderId: string,
  status: 'sent' | 'failed',
  errorMessage?: string
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('booking_reminders')
    .update({
      status,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      error_message: errorMessage,
    })
    .eq('id', reminderId);

  if (error) {
    console.error(`Failed to update reminder status: ${error.message}`);
  }
}
