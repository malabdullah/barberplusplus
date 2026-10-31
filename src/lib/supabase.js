import { createClient } from '@supabase/supabase-js';
import { appConfig, isTest } from './runtimeConfig';

export const supabaseUrl = appConfig.supabaseUrl;

export const supabase = createClient(
  supabaseUrl,
  appConfig.supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !(isTest && typeof window !== 'undefined' && ['/customer/auth-callback', '/customer/email-callback'].includes(window.location.pathname)),
    },
  }
);

export default supabase;
