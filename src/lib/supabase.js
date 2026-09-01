import { createClient } from '@supabase/supabase-js';

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

const getSupabaseUrl = () => {
  if (!rawSupabaseUrl) {
    throw new Error('Missing VITE_SUPABASE_URL. Configure the public URL of the self-hosted Supabase instance.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawSupabaseUrl);
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid HTTPS URL.');
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw new Error('VITE_SUPABASE_URL must use HTTPS and must not contain credentials.');
  }

  if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
    throw new Error('VITE_SUPABASE_URL must be an origin without a path, query, or fragment.');
  }

  return parsedUrl.origin;
};

const getSupabasePublishableKey = () => {
  if (!supabasePublishableKey) {
    throw new Error('Missing VITE_SUPABASE_PUBLISHABLE_KEY. Configure the browser-safe self-hosted Supabase key.');
  }

  if (supabasePublishableKey.startsWith('sb_publishable_')) {
    return supabasePublishableKey;
  }

  // Older self-hosted stacks expose the browser-safe anon key as a JWT.
  // Decode only to verify the declared role; JWT signature verification remains
  // the responsibility of the Supabase gateway.
  try {
    const [, encodedPayload, signature] = supabasePublishableKey.split('.');
    if (!encodedPayload || !signature) throw new Error('Malformed JWT');

    const normalizedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
    const payload = JSON.parse(atob(paddedPayload));

    if (payload.role === 'anon') {
      return supabasePublishableKey;
    }
  } catch {
    // Fall through to the safe configuration error below.
  }

  throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must contain an sb_publishable_ key or a legacy anon-role JWT. Never expose a secret or service-role key in the browser.');
};

export const supabaseUrl = getSupabaseUrl();

export const supabase = createClient(
  supabaseUrl,
  getSupabasePublishableKey(),
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

export default supabase;
