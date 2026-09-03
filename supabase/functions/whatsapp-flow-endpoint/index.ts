// WhatsApp Flow Data Exchange Endpoint
// Handles encrypted communication between WhatsApp and our booking flow

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import {
  decryptFlowRequest,
  encryptFlowResponse,
  type DecryptedFlowRequest,
} from './crypto.ts';
import {
  handleInit,
  handleBranchSelect,
  handleBarberSelect,
  handleServiceSelect,
  handleDateSelect,
  type FlowResponse,
} from './handlers.ts';
import {
  assertEncryptedWhatsAppFlowRequest,
  getAppEnvironment,
} from '../_shared/environment.ts';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Local-only health check. Meta's encrypted POST ping is the remote health check.
  if (req.method === 'GET') {
    if (getAppEnvironment() !== 'development') {
      return new Response('Method not allowed', {
        status: 405,
        headers: corsHeaders,
      });
    }
    return new Response(JSON.stringify({ status: 'healthy' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    assertEncryptedWhatsAppFlowRequest(body);
    console.log('Flow endpoint received request');

    // Check if this is an encrypted request or plain request
    let decryptedData: DecryptedFlowRequest;
    let aesKey: Uint8Array | null = null;
    let iv: Uint8Array | null = null;

    if (
      typeof body.encrypted_flow_data === 'string' &&
      typeof body.encrypted_aes_key === 'string' &&
      typeof body.initial_vector === 'string'
    ) {
      // Encrypted request from WhatsApp
      console.log('Processing encrypted flow request');

      const decrypted = await decryptFlowRequest(
        body.encrypted_flow_data,
        body.encrypted_aes_key,
        body.initial_vector
      );

      decryptedData = decrypted.decryptedData;
      aesKey = decrypted.aesKey;
      iv = decrypted.iv;
    } else {
      // Plain request (for testing or direct calls)
      console.log('Processing plain flow request');
      decryptedData = body as unknown as DecryptedFlowRequest;
    }

    console.log('Flow action:', decryptedData.action);
    console.log('Flow screen:', decryptedData.screen);

    // Extract language from flow token if available
    // Format: booking_{phone}_{timestamp}_{language}
    const flowToken = decryptedData.flow_token || '';
    const tokenParts = flowToken.split('_');
    const language = tokenParts.length >= 4 ? tokenParts[3] : 'ar';

    let response: FlowResponse;

    switch (decryptedData.action) {
      case 'ping':
        // Health check from WhatsApp
        response = {
          version: '5.1',
          screen: 'BRANCH_SELECT',
          data: { status: 'active' },
        };
        break;

      case 'INIT':
        // Initial screen load
        response = await handleInit(flowToken, language);
        break;

      case 'data_exchange':
        // Handle data exchange based on current screen
        response = await handleDataExchange(
          decryptedData.screen || '',
          decryptedData.data || {},
          language
        );
        break;

      case 'BACK':
        // Handle back navigation (optional - can add custom logic)
        response = await handleBack(
          decryptedData.screen || '',
          decryptedData.data || {},
          language
        );
        break;

      default:
        console.warn('Unknown action:', decryptedData.action);
        response = await handleInit(flowToken, language);
    }

    console.log('Flow response screen:', response.screen);

    // Return encrypted response if we have encryption keys
    if (aesKey && iv) {
      const encryptedResponse = await encryptFlowResponse(response, aesKey, iv);
      return new Response(encryptedResponse, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
      });
    }

    // Return plain JSON for testing
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Flow endpoint error:', error);

    // Return error response
    const errorResponse = {
      version: '5.1',
      data: {
        error: true,
        error_message:
          error instanceof Error ? error.message : 'An error occurred',
      },
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 200, // WhatsApp expects 200 even for errors
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Handle data exchange based on current screen
 */
async function handleDataExchange(
  screen: string,
  data: Record<string, unknown>,
  language: string
): Promise<FlowResponse> {
  console.log('Data exchange for screen:', screen, 'data:', JSON.stringify(data));

  switch (screen) {
    case 'BRANCH_SELECT': {
      // User selected a branch, load barbers
      const branchId = data.selected_branch as string;
      if (!branchId) {
        return {
          version: '5.1',
          screen: 'BRANCH_SELECT',
          data: { error_message: 'Please select a branch' },
        };
      }
      return await handleBranchSelect(branchId, language);
    }

    case 'BARBER_SELECT': {
      // User selected a barber, load services
      const barberId = data.selected_barber as string;
      const branchId = data.branch_id as string;
      if (!barberId) {
        return {
          version: '5.1',
          screen: 'BARBER_SELECT',
          data: { ...data, error_message: 'Please select a barber' },
        };
      }
      return await handleBarberSelect(branchId, barberId, language);
    }

    case 'SERVICE_SELECT': {
      // User selected services, load date/time options
      const serviceIds = data.selected_services as string[];
      const barberId = data.barber_id as string;
      const branchId = data.branch_id as string;
      if (!serviceIds || serviceIds.length === 0) {
        return {
          version: '5.1',
          screen: 'SERVICE_SELECT',
          data: { ...data, error_message: 'Please select at least one service' },
        };
      }
      return await handleServiceSelect(branchId, barberId, serviceIds, language);
    }

    case 'DATETIME_SELECT': {
      // Check if this is a date selection to load time slots
      const action = data.action as string;
      if (action === 'load_time_slots') {
        const selectedDate = data.selected_date as string;
        const barberId = data.barber_id as string;
        const totalDuration = (data.total_duration as number) || 30;
        return await handleDateSelect(
          barberId,
          selectedDate,
          totalDuration,
          data,
          language
        );
      }
      // Otherwise, this is the final completion (handled by WhatsApp)
      return {
        version: '5.1',
        screen: 'DATETIME_SELECT',
        data,
      };
    }

    default:
      console.warn('Unknown screen for data exchange:', screen);
      return await handleInit('', language);
  }
}
/**
 * Handle back navigation
 */
async function handleBack(
  screen: string,
  data: Record<string, unknown>,
  language: string
): Promise<FlowResponse> {
  // For back navigation, we typically just return to the previous screen
  // with the same data (WhatsApp handles the navigation)
  switch (screen) {
    case 'BARBER_SELECT':
      return await handleInit('', language);

    case 'SERVICE_SELECT':
      return await handleBranchSelect(data.branch_id as string, language);

    case 'DATETIME_SELECT':
      return await handleBarberSelect(
        data.branch_id as string,
        data.barber_id as string,
        language
      );

    default:
      return await handleInit('', language);
  }
}
