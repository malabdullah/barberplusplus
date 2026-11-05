import { supabase, ACCOUNT_AUTH_STORAGE_KEY } from './supabase';
import { customerFeaturesEnabled } from './runtimeConfig';
// Both interfaces use one Auth session. A mode never changes the trusted role.
export const CUSTOMER_AUTH_STORAGE_KEY = ACCOUNT_AUTH_STORAGE_KEY;
export const customerSupabase = customerFeaturesEnabled ? supabase : null;
