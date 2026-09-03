import { createClient } from '@supabase/supabase-js';
import { appConfig } from './runtimeConfig';

export const supabaseUrl = appConfig.supabaseUrl;

export const supabase = createClient(
  supabaseUrl,
  appConfig.supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

export default supabase;
