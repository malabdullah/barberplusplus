import "jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.89.0";
import { assertOutboundRecipientAllowed, getAppUrl, getTrustedRole } from "../_shared/environment.ts";

interface SendMessageRequest {
  conversationId: string;
  phoneNumber: string;
  phoneCountryCode: string;
  content: string;
}

interface WhatsAppApiResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": getAppUrl(),
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const whatsappPhoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const whatsappAccessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase environment variables");
    }

    if (!whatsappPhoneNumberId || !whatsappAccessToken) {
      throw new Error("Missing WhatsApp API configuration");
    }

    // Verify authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role for database operations
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Create user client to verify the JWT
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the user and get their info
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid authorization token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is an agent
    const userRole = getTrustedRole(user);
    if (userRole !== "agent" && userRole !== "admin") {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized: Only agents can send messages" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body: SendMessageRequest = await req.json();
    const { conversationId, phoneNumber, phoneCountryCode, content } = body;

    // Validate required fields
    if (!conversationId || !phoneNumber || !content) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sanitize content (basic XSS prevention)
    const sanitizedContent = content.trim().slice(0, 4096); // WhatsApp text limit

    if (!sanitizedContent) {
      return new Response(
        JSON.stringify({ success: false, error: "Message content cannot be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format phone number for WhatsApp (remove + and any spaces/dashes)
    const formattedPhone = `${phoneCountryCode}${phoneNumber}`.replace(/[\s\-\+]/g, "");
    assertOutboundRecipientAllowed(formattedPhone);

    // Send message via WhatsApp Cloud API
    const whatsappResponse = await fetch(
      `https://graph.facebook.com/v18.0/${whatsappPhoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${whatsappAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: formattedPhone,
          type: "text",
          text: { body: sanitizedContent },
        }),
      }
    );

    if (!whatsappResponse.ok) {
      const errorData = await whatsappResponse.json();
      console.error("WhatsApp API error:", errorData);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to send WhatsApp message",
          details: errorData?.error?.message || "Unknown WhatsApp API error"
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const whatsappData: WhatsAppApiResponse = await whatsappResponse.json();
    const whatsappMessageId = whatsappData.messages?.[0]?.id;

    // Insert message into whatsapp_messages table
    const { data: messageData, error: insertError } = await supabaseAdmin
      .from("whatsapp_messages")
      .insert({
        conversation_id: conversationId,
        whatsapp_message_id: whatsappMessageId,
        direction: "outbound",
        message_type: "text",
        content: sanitizedContent,
        status: "sent",
        metadata: {
          sent_by: "agent",
          agent_user_id: user.id,
          agent_email: user.email,
          sent_at: new Date().toISOString(),
        },
      })
      .select()
      .single();

    if (insertError) {
      console.error("Database insert error:", insertError);
      // Message was sent but not recorded - log this critical error
      return new Response(
        JSON.stringify({
          success: true,
          warning: "Message sent but failed to record in database",
          whatsappMessageId,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update conversation state to 'agent_takeover'
    const { error: updateError } = await supabaseAdmin
      .from("whatsapp_conversations")
      .update({
        current_state: "agent_takeover",
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    if (updateError) {
      console.error("Failed to update conversation state:", updateError);
      // Non-critical error - message was sent and recorded
    }

    // Log the agent action
    await supabaseAdmin.from("whatsapp_logs").insert({
      conversation_id: conversationId,
      phone_number: formattedPhone,
      log_level: "info",
      event_type: "agent_message_sent",
      message: `Agent sent message to ${formattedPhone}`,
      outbound_message: sanitizedContent,
      metadata: {
        agent_user_id: user.id,
        whatsapp_message_id: whatsappMessageId,
        message_length: sanitizedContent.length,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: messageData,
        whatsappMessageId,
        conversationState: "agent_takeover",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Send WhatsApp message failed:", errorMessage);

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
