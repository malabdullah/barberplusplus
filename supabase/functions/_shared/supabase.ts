// Supabase client for Edge Functions
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

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
): Promise<{ id: string; isNew: boolean; context: Record<string, unknown>; language: string; customerName: string | null; currentSessionId: string }> {
  const supabase = getSupabaseClient();

  // Try to find existing conversation
  const { data: existing, error: findError } = await supabase
    .from('whatsapp_conversations')
    .select('id, context, language, customer_name, current_session_id')
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
      currentSessionId: existing.current_session_id || crypto.randomUUID(),
    };
  }

  // Create new conversation with a fresh session
  const newSessionId = crypto.randomUUID();
  const { data: newConversation, error: createError } = await supabase
    .from('whatsapp_conversations')
    .insert({
      phone_number: phoneNumber,
      phone_country_code: phoneCountryCode,
      current_state: 'greeting',
      context: {},
      language: 'ar',
      current_session_id: newSessionId,
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
    currentSessionId: newSessionId,
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
  metadata: Record<string, unknown> = {},
  sessionId?: string
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
      session_id: sessionId,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save message: ${error.message}`);
  }

  return data.id;
}

/**
 * Atomically claim an inbound message to prevent duplicate processing.
 * Uses INSERT with unique constraint check - first caller wins, subsequent callers get { claimed: false }.
 * This eliminates the race condition when WhatsApp sends duplicate webhooks.
 */
export async function claimInboundMessage(
  conversationId: string,
  content: string,
  whatsappMessageId: string,
  sessionId?: string
): Promise<{ claimed: boolean; messageId?: string }> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('whatsapp_messages')
    .insert({
      conversation_id: conversationId,
      direction: 'inbound',
      content,
      whatsapp_message_id: whatsappMessageId,
      message_type: 'text',
      session_id: sessionId,
    })
    .select('id')
    .maybeSingle();

  // Postgres unique violation code - message already claimed by another request
  if (error?.code === '23505') {
    return { claimed: false };
  }

  if (error) {
    throw new Error(`Failed to claim message: ${error.message}`);
  }

  return { claimed: true, messageId: data?.id };
}

/**
 * Get recent messages for a conversation (for context)
 * When sessionId is provided, only returns messages from that session
 */
export async function getRecentMessages(
  conversationId: string,
  limit: number = 10,
  sessionId?: string
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('whatsapp_messages')
    .select('direction, content')
    .eq('conversation_id', conversationId);

  // Filter by session if provided
  if (sessionId) {
    query = query.eq('session_id', sessionId);
  }

  const { data, error } = await query
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
 */
export async function getPendingReminders(): Promise<Array<{
  id: string;
  booking_id: string;
  booking: {
    date: string;
    time: string;
    customer: { name: string; phone: string; country_code: string } | null;
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

  // Supabase's ungenerated client types model embedded relationships as arrays,
  // while these foreign keys are singular in the authoritative schema.
  return (data || []) as unknown as Array<{
    id: string;
    booking_id: string;
    booking: {
      date: string;
      time: string;
      customer: { name: string; phone: string; country_code: string } | null;
      branch: { name: string; name_ar: string };
      barber: { name: string; name_ar: string };
    };
  }>;
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

/**
 * Atomically claim a pending booking confirmation.
 * Uses database-level atomicity to prevent race conditions when multiple
 * webhook requests arrive simultaneously (e.g., user clicks confirm button twice).
 *
 * Returns the pending_confirmation data if successfully claimed, null otherwise.
 * Only ONE request can successfully claim a pending confirmation.
 */
export async function claimBookingConfirmation(
  conversationId: string,
  currentContext: Record<string, unknown>
): Promise<{ claimed: boolean; pending_confirmation?: Record<string, unknown> }> {
  const supabase = getSupabaseClient();

  const pending = currentContext.pending_confirmation as Record<string, unknown> | undefined;

  // No pending confirmation to claim
  if (!pending) {
    console.log('claimBookingConfirmation: No pending_confirmation in context');
    return { claimed: false };
  }

  // Already claimed by another request (in passed context)
  if (pending._claimed_at) {
    console.log('claimBookingConfirmation: Already claimed at', pending._claimed_at);
    return { claimed: false };
  }

  const claimTimestamp = Date.now();
  console.log('claimBookingConfirmation: Attempting atomic claim at', claimTimestamp);

  // TRULY ATOMIC: Single UPDATE that only succeeds if:
  // 1. pending_confirmation exists in context
  // 2. _claimed_at is not yet set (null or missing)
  // Uses raw SQL via RPC for proper JSONB handling
  const { data: rpcResult, error: rpcError } = await supabase.rpc('atomic_claim_booking', {
    p_conversation_id: conversationId,
    p_claim_timestamp: claimTimestamp
  });

  if (!rpcError && rpcResult !== null) {
    if (rpcResult.claimed) {
      console.log('claimBookingConfirmation: Claimed successfully (RPC) at', claimTimestamp);
      return { claimed: true, pending_confirmation: rpcResult.pending_confirmation || pending };
    }
    console.log('claimBookingConfirmation: RPC returned not claimed');
    return { claimed: false };
  }

  // RPC doesn't exist or failed - use atomic Supabase client approach
  console.log('claimBookingConfirmation: RPC unavailable, using atomic client approach');

  // Build the updated context with claim timestamp
  const claimedPending = { ...pending, _claimed_at: claimTimestamp };
  const updatedContext = { ...currentContext, pending_confirmation: claimedPending };

  // ATOMIC UPDATE using PostgREST filters:
  // - Only updates if pending_confirmation exists AND _claimed_at is null/missing
  // - Returns the row BEFORE update so we can get original pending_confirmation
  //
  // We use a transaction-like approach:
  // 1. First, try to update with strict conditions
  // 2. If 0 rows updated, someone else already claimed
  const { data: updateResult, error: updateError } = await supabase
    .from('whatsapp_conversations')
    .update({
      context: updatedContext,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversationId)
    // Ensure pending_confirmation exists (is not null)
    .not('context->pending_confirmation', 'is', null)
    // Ensure _claimed_at is not set (is null)
    .is('context->pending_confirmation->_claimed_at', null)
    .select('id');

  if (updateError) {
    console.error('claimBookingConfirmation: Update error:', updateError);
    return { claimed: false };
  }

  // If no rows were updated, another request already claimed it
  if (!updateResult || updateResult.length === 0) {
    console.log('claimBookingConfirmation: Already claimed by another request (atomic check)');
    return { claimed: false };
  }

  console.log('claimBookingConfirmation: Claimed successfully (atomic client) at', claimTimestamp);
  return { claimed: true, pending_confirmation: pending };
}

/**
 * Atomically claim a pending cancellation confirmation.
 * Uses database-level atomicity to prevent race conditions when multiple
 * webhook requests arrive simultaneously (e.g., user clicks confirm button twice).
 *
 * Returns the pending_cancellation data if successfully claimed, null otherwise.
 * Only ONE request can successfully claim a pending cancellation.
 */
export async function claimCancellationConfirmation(
  conversationId: string,
  currentContext: Record<string, unknown>
): Promise<{ claimed: boolean; pending_cancellation?: Record<string, unknown> }> {
  const supabase = getSupabaseClient();

  const pending = currentContext.pending_cancellation as Record<string, unknown> | undefined;

  // No pending cancellation to claim
  if (!pending) {
    console.log('claimCancellationConfirmation: No pending_cancellation in context');
    return { claimed: false };
  }

  // Already claimed by another request (in passed context)
  if (pending._claimed_at) {
    console.log('claimCancellationConfirmation: Already claimed at', pending._claimed_at);
    return { claimed: false };
  }

  const claimTimestamp = Date.now();
  console.log('claimCancellationConfirmation: Attempting atomic claim at', claimTimestamp);

  // Build the updated context with claim timestamp
  const claimedPending = { ...pending, _claimed_at: claimTimestamp };
  const updatedContext = { ...currentContext, pending_cancellation: claimedPending };

  // ATOMIC UPDATE using PostgREST filters:
  // - Only updates if pending_cancellation exists AND _claimed_at is null/missing
  // - Returns the row if update succeeds, empty array if already claimed
  const { data: updateResult, error: updateError } = await supabase
    .from('whatsapp_conversations')
    .update({
      context: updatedContext,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversationId)
    // Ensure pending_cancellation exists (is not null)
    .not('context->pending_cancellation', 'is', null)
    // Ensure _claimed_at is not set (is null)
    .is('context->pending_cancellation->_claimed_at', null)
    .select('id');

  if (updateError) {
    console.error('claimCancellationConfirmation: Update error:', updateError);
    return { claimed: false };
  }

  // If no rows were updated, another request already claimed it
  if (!updateResult || updateResult.length === 0) {
    console.log('claimCancellationConfirmation: Already claimed by another request (atomic check)');
    return { claimed: false };
  }

  console.log('claimCancellationConfirmation: Claimed successfully at', claimTimestamp);
  return { claimed: true, pending_cancellation: pending };
}

/**
 * Start a new conversation session.
 * Called after booking completion, cancellation, or reschedule to create a clean context boundary.
 * Messages from the new session won't mix with previous booking flow messages.
 */
export async function startNewSession(
  conversationId: string,
  preserveContext: Record<string, unknown> = {}
): Promise<string> {
  const supabase = getSupabaseClient();
  const newSessionId = crypto.randomUUID();

  const { error } = await supabase
    .from('whatsapp_conversations')
    .update({
      current_session_id: newSessionId,
      context: preserveContext,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  if (error) {
    console.error('startNewSession: Failed to start new session:', error);
    throw new Error(`Failed to start new session: ${error.message}`);
  }

  console.log('startNewSession: Started new session', newSessionId, 'for conversation', conversationId);
  return newSessionId;
}
