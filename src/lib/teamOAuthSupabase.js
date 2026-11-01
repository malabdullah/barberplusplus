import { createClient } from '@supabase/supabase-js';
import { appConfig } from './runtimeConfig';
import { functionFetch } from './functionFetch';
// Provider redirects cannot install a staff session before its trusted role is checked.
export const TEAM_OAUTH_STORAGE_KEY = 'barber-team-oauth';
export const teamOAuthSupabase = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
  global: { fetch: functionFetch },
  auth: { storageKey: TEAM_OAUTH_STORAGE_KEY, storage: typeof window === 'undefined' ? undefined : window.sessionStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce' },
});
