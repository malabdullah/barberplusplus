import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// In production, log warning instead of throwing to prevent app crash
// In development, throw to catch misconfiguration early
if (!supabaseUrl || !supabaseAnonKey) {
  const errorMessage = 'Missing Supabase credentials. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.\n' +
    'Get these from: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api';
  
  if (import.meta.env.DEV) {
    throw new Error(errorMessage);
  } else {
    console.error('[Supabase]', errorMessage);
    // Create a dummy client to prevent app crash, but it won't work
    // This allows the app to load and show error UI instead of crashing
  }
}

// Create client with fallback empty strings if env vars are missing (production only)
export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

export default supabase;
