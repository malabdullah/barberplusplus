// Auth Rate Limiter Edge Function
// SECURITY: Server-side rate limiting for authentication operations
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { getAppUrl } from '../_shared/environment.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': getAppUrl(),
  'Vary': 'Origin',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Rate limit configurations
const RATE_LIMITS = {
  login: { maxAttempts: 5, windowSeconds: 60, lockoutSeconds: 300 },     // 5 per minute, 5min lockout
  signup: { maxAttempts: 3, windowSeconds: 3600, lockoutSeconds: 3600 }, // 3 per hour, 1hr lockout
  passwordReset: { maxAttempts: 3, windowSeconds: 3600, lockoutSeconds: 3600 }, // 3 per hour
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { action, identifier } = body;

    if (!action || !identifier) {
      return new Response(JSON.stringify({ error: 'Missing action or identifier' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get rate limit config for this action
    const config = RATE_LIMITS[action as keyof typeof RATE_LIMITS];
    if (!config) {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prefix identifier with action to separate rate limits
    const prefixedIdentifier = `${action}:${identifier.toLowerCase()}`;

    // Check rate limit using database function
    const { data, error } = await supabase.rpc('check_auth_rate_limit', {
      p_identifier: prefixedIdentifier,
      p_max_attempts: config.maxAttempts,
      p_window_seconds: config.windowSeconds,
      p_lockout_seconds: config.lockoutSeconds,
    });

    if (error) {
      console.error('Rate limit check failed:', error);
      // Fail open - allow the request if rate limit check fails
      return new Response(JSON.stringify({
        allowed: true,
        retryAfter: 0,
        remaining: config.maxAttempts
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Auth rate limiter error:', error);
    // Fail open
    return new Response(JSON.stringify({
      allowed: true,
      retryAfter: 0,
      remaining: 5
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
