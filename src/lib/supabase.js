import { createClient } from '@supabase/supabase-js';
import { appConfig } from './runtimeConfig';
import { functionFetch } from './functionFetch';
import { migrateAccountSession } from './accountSession';

export const supabaseUrl = appConfig.supabaseUrl;
export const ACCOUNT_AUTH_STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
if (typeof window !== 'undefined') migrateAccountSession(window.localStorage, ACCOUNT_AUTH_STORAGE_KEY);

export const supabase = createClient(
  supabaseUrl,
  appConfig.supabasePublishableKey,
  {
    global: { fetch: functionFetch },
    auth: {
      storageKey: ACCOUNT_AUTH_STORAGE_KEY,
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !(typeof window !== 'undefined' && ['/customer/auth-callback', '/customer/email-callback', '/team/auth-callback'].includes(window.location.pathname)),
    },
  }
);

export default supabase;
