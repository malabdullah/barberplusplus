import { createClient } from '@supabase/supabase-js';
import { appConfig, isTest } from './runtimeConfig';
// Customer and staff sessions can coexist without changing each other's roles.
export const CUSTOMER_AUTH_STORAGE_KEY = 'barber-customer-auth';
export const customerSupabase = isTest ? createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
  auth: { storageKey: CUSTOMER_AUTH_STORAGE_KEY, flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
}) : null;
