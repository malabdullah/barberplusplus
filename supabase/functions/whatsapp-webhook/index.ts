// WhatsApp Webhook Handler - Edge Function Entry Point
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import {
  verifyWebhookSignature,
  verifyWebhookChallenge,
  parseWebhookPayload,
  parsePhoneFromWhatsApp,
  markAsRead,
} from '../_shared/whatsapp.ts';
import { updateMessageStatus } from '../_shared/supabase.ts';
import { processMessage } from './agent.ts';

// CORS headers for preflight requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Hub-Signature-256',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // =============================================
    // GET - Webhook Verification (Meta challenge)
    // =============================================
    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      console.log('Webhook verification request:', { mode, token });

      const result = verifyWebhookChallenge(mode, token, challenge);

      if (result.valid) {
        console.log('Webhook verified successfully');
        return new Response(result.challenge, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
        });
      }

      console.error('Webhook verification failed');
      return new Response('Verification failed', {
        status: 403,
        headers: corsHeaders,
      });
    }

    // =============================================
    // POST - Incoming Messages and Status Updates
    // =============================================
    if (req.method === 'POST') {
      // Get raw body for signature verification
      const rawBody = await req.text();
      const signature = req.headers.get('X-Hub-Signature-256');

      // Verify webhook signature
      const isValid = await verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.error('Invalid webhook signature');
        return new Response('Invalid signature', {
          status: 401,
          headers: corsHeaders,
        });
      }

      // Parse webhook payload
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        console.error('Invalid JSON payload');
        return new Response('Invalid JSON', {
          status: 400,
          headers: corsHeaders,
        });
      }

      // Verify it's a WhatsApp message
      if (payload.object !== 'whatsapp_business_account') {
        console.log('Not a WhatsApp event, ignoring');
        return new Response('OK', {
          status: 200,
          headers: corsHeaders,
        });
      }

      // Parse messages and statuses
      const { messages, statuses } = parseWebhookPayload(payload);

      // Process status updates (delivery receipts)
      for (const status of statuses) {
        console.log(`Message ${status.messageId} status: ${status.status}`);
        await updateMessageStatus(status.messageId, status.status as any);
      }

      // Process incoming messages
      for (const message of messages) {
        console.log('Processing message:', {
          from: message.from,
          type: message.type,
          text: message.text?.substring(0, 50),
          hasFlowResponse: !!message.flowResponse,
        });

        // Skip if no text content AND no flow response
        if (!message.text && !message.flowResponse) {
          console.log('Skipping non-text message without flow response');
          continue;
        }

        // Mark message as read
        await markAsRead(message.messageId);

        // Parse phone number
        const { phone, countryCode } = parsePhoneFromWhatsApp(message.from);

        // Process message with AI agent (include buttonId, listId, and flowResponse for interactive responses)
        const result = await processMessage(
          phone,
          countryCode,
          message.text || 'Flow completed',
          message.profileName,
          message.messageId,
          message.buttonId,
          message.listId,
          message.flowResponse
        );

        if (!result.success) {
          console.error('Failed to process message:', result.error);
        } else {
          console.log('Message processed successfully');
        }
      }

      // Always return 200 to acknowledge receipt
      return new Response('OK', {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Method not allowed
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error('Webhook error:', error);

    // Always return 200 to prevent Meta from retrying
    return new Response('OK', {
      status: 200,
      headers: corsHeaders,
    });
  }
});
