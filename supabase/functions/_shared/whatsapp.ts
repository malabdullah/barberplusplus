// WhatsApp Cloud API wrapper
import type {
  WhatsAppTextMessage,
  WhatsAppInteractiveMessage,
  WhatsAppWebhookPayload,
  WhatsAppIncomingMessage,
} from './types.ts';
import { assertOutboundRecipientAllowed, getAppEnvironment } from './environment.ts';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

/**
 * Get WhatsApp API configuration from environment
 */
function getConfig(requireAll = true) {
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');

  if (requireAll && (!phoneNumberId || !accessToken)) {
    throw new Error('Missing WhatsApp API configuration');
  }

  return { phoneNumberId, accessToken, verifyToken, appSecret };
}

/**
 * Convert ArrayBuffer to hex string
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify webhook signature from Meta using Web Crypto API
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string | null
): Promise<boolean> {
  const { appSecret } = getConfig(false);

  if (!signature || !appSecret) {
    if (getAppEnvironment() === 'development') {
      console.warn('Webhook signature verification is disabled only for local development');
      return true;
    }
    console.error('Missing webhook signature or app secret');
    return false;
  }

  try {
    // Signature format: sha256=<hash>
    const expectedSignature = signature.replace('sha256=', '');

    const encoder = new TextEncoder();
    const keyData = encoder.encode(appSecret);
    const data = encoder.encode(payload);

    // Import key for HMAC
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Sign the data
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, data);
    const calculatedSignature = bufferToHex(signatureBuffer);

    return calculatedSignature === expectedSignature;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Verify webhook challenge from Meta (for initial setup)
 */
export function verifyWebhookChallenge(
  mode: string | null,
  token: string | null,
  challenge: string | null
): { valid: boolean; challenge?: string } {
  const { verifyToken } = getConfig(false);

  console.log('Webhook verification attempt:', { mode, hasToken: Boolean(token) });

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Webhook verification successful');
    return { valid: true, challenge: challenge || '' };
  }

  console.log('Webhook verification failed - token mismatch');
  return { valid: false };
}

/**
 * Parse incoming webhook payload
 */
export function parseWebhookPayload(payload: WhatsAppWebhookPayload): {
  messages: Array<{
    from: string;
    messageId: string;
    type: string;
    text?: string;
    buttonId?: string;
    listId?: string;
    profileName?: string;
    flowResponse?: Record<string, unknown>;
  }>;
  statuses: Array<{
    messageId: string;
    status: string;
    recipientId: string;
  }>;
} {
  const messages: Array<{
    from: string;
    messageId: string;
    type: string;
    text?: string;
    buttonId?: string;
    listId?: string;
    profileName?: string;
    flowResponse?: Record<string, unknown>;
  }> = [];

  const statuses: Array<{
    messageId: string;
    status: string;
    recipientId: string;
  }> = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;

      // Extract profile name from contacts
      const profileName = value.contacts?.[0]?.profile?.name;

      // Process incoming messages
      for (const message of value.messages || []) {
        const parsed: {
          from: string;
          messageId: string;
          type: string;
          text?: string;
          buttonId?: string;
          listId?: string;
          profileName?: string;
          flowResponse?: Record<string, unknown>;
        } = {
          from: message.from,
          messageId: message.id,
          type: message.type,
          profileName,
        };

        // Extract text content based on message type
        if (message.type === 'text' && message.text) {
          parsed.text = message.text.body;
        } else if (message.type === 'interactive' && message.interactive) {
          if (message.interactive.button_reply) {
            parsed.buttonId = message.interactive.button_reply.id;
            parsed.text = message.interactive.button_reply.title;
          } else if (message.interactive.list_reply) {
            parsed.listId = message.interactive.list_reply.id;
            parsed.text = message.interactive.list_reply.title;
          } else if (message.interactive.nfm_reply) {
            // WhatsApp Flow response (Native Flow Message reply)
            try {
              parsed.flowResponse = JSON.parse(message.interactive.nfm_reply.response_json);
              parsed.text = message.interactive.nfm_reply.body || 'Flow completed';
            } catch (e) {
              console.error('Failed to parse flow response:', e);
              parsed.flowResponse = { raw: message.interactive.nfm_reply.response_json };
            }
          }
        } else if (message.type === 'button') {
          // Quick reply button
          parsed.text = (message as unknown as { button?: { text: string } }).button?.text;
        }

        messages.push(parsed);
      }

      // Process status updates
      for (const status of value.statuses || []) {
        statuses.push({
          messageId: status.id,
          status: status.status,
          recipientId: status.recipient_id,
        });
      }
    }
  }

  return { messages, statuses };
}

/**
 * Send a text message
 */
export async function sendTextMessage(
  to: string,
  text: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { phoneNumberId, accessToken } = getConfig();
  assertOutboundRecipientAllowed(to);

  const message: WhatsAppTextMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: true,
      body: text,
    },
  };

  try {
    const response = await fetch(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('WhatsApp API error:', data);
      return {
        success: false,
        error: data.error?.message || 'Failed to send message',
      };
    }

    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send an interactive message with buttons (max 3 buttons)
 */
export async function sendButtonMessage(
  to: string,
  body: string,
  buttons: Array<{ id: string; title: string }>,
  header?: string,
  footer?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { phoneNumberId, accessToken } = getConfig();
  assertOutboundRecipientAllowed(to);

  // WhatsApp allows max 3 buttons
  const limitedButtons = buttons.slice(0, 3);

  const message: WhatsAppInteractiveMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: limitedButtons.map((btn) => ({
          type: 'reply' as const,
          reply: {
            id: btn.id,
            title: btn.title.substring(0, 20), // Max 20 chars
          },
        })),
      },
    },
  };

  if (header) {
    message.interactive.header = { type: 'text', text: header };
  }
  if (footer) {
    message.interactive.footer = { text: footer };
  }

  try {
    const response = await fetch(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('WhatsApp API error:', data);
      return {
        success: false,
        error: data.error?.message || 'Failed to send message',
      };
    }

    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send an interactive list message (for longer lists)
 */
export async function sendListMessage(
  to: string,
  body: string,
  buttonText: string,
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>,
  header?: string,
  footer?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { phoneNumberId, accessToken } = getConfig();
  assertOutboundRecipientAllowed(to);

  const message: WhatsAppInteractiveMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: buttonText.substring(0, 20), // Max 20 chars
        sections: sections.map((section) => ({
          title: section.title.substring(0, 24), // Max 24 chars
          rows: section.rows.slice(0, 10).map((row) => ({
            id: row.id,
            title: row.title.substring(0, 24), // Max 24 chars
            description: row.description?.substring(0, 72), // Max 72 chars
          })),
        })),
      },
    },
  };

  if (header) {
    message.interactive.header = { type: 'text', text: header };
  }
  if (footer) {
    message.interactive.footer = { text: footer };
  }

  try {
    const response = await fetch(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('WhatsApp API error:', data);
      return {
        success: false,
        error: data.error?.message || 'Failed to send message',
      };
    }

    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send a WhatsApp Flow message for interactive forms (e.g., multi-select)
 */
export async function sendFlowMessage(
  to: string,
  flowId: string,
  flowToken: string,
  flowActionPayload: Record<string, unknown>,
  ctaText: string = 'Open',
  bodyText: string = 'Please complete the form',
  headerText?: string,
  mode: 'navigate' | 'data_exchange' = 'navigate'
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { phoneNumberId, accessToken } = getConfig();
  assertOutboundRecipientAllowed(to);

  const interactive: Record<string, unknown> = {
    type: 'flow',
    body: { text: bodyText },
    action: {
      name: 'flow',
      parameters: {
        flow_message_version: '3',
        flow_token: flowToken,
        flow_id: flowId,
        flow_cta: ctaText.substring(0, 20), // Max 20 chars
        flow_action: mode,
        flow_action_payload: flowActionPayload,
      },
    },
  };

  if (headerText) {
    interactive.header = { type: 'text', text: headerText };
  }

  const message = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  };

  try {
    const response = await fetch(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('WhatsApp Flow API error:', data);
      return {
        success: false,
        error: data.error?.message || 'Failed to send flow message',
      };
    }

    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (error) {
    console.error('WhatsApp Flow send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Mark a message as read
 */
export async function markAsRead(messageId: string): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig();

  try {
    await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  } catch (error) {
    console.error('Failed to mark message as read:', error);
  }
}

/**
 * Format phone number for WhatsApp (ensure no + prefix for API)
 */
export function formatPhoneForApi(phone: string, countryCode: string = '+965'): string {
  // Remove any non-digit characters
  const cleanPhone = phone.replace(/\D/g, '');
  const cleanCountryCode = countryCode.replace(/\D/g, '');

  // If phone already starts with country code, return as is
  if (cleanPhone.startsWith(cleanCountryCode)) {
    return cleanPhone;
  }

  // Prepend country code
  return cleanCountryCode + cleanPhone;
}

/**
 * Extract phone number from WhatsApp format
 */
export function parsePhoneFromWhatsApp(waId: string): { phone: string; countryCode: string } {
  // WhatsApp ID is typically in format: countrycode + number
  // For Kuwait (+965), numbers are 8 digits
  if (waId.startsWith('965')) {
    return {
      phone: waId.substring(3),
      countryCode: '+965',
    };
  }

  // Default: assume first 3 digits are country code
  return {
    phone: waId.substring(3),
    countryCode: '+' + waId.substring(0, 3),
  };
}
