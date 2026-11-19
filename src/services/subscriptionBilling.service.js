import { supabase } from '../lib/supabase';

export async function subscriptionRpc(action, data = {}) {
  const result = await supabase.rpc('subscription_billing', { p_action: action, p_data: data });
  if (result.error) {
    const known = result.error.message?.match(/\bBILLING_[A-Z_]+\b/);
    throw new Error(known?.[0] || 'BILLING_FAILED');
  }
  return result.data;
}

// Keep a request ID across a retry of the same intent. A successful write clears
// it; changing the intent gets a new ID. The server also checks the full payload.
export function billingWriteIntent(previous, action, data) {
  const input = JSON.stringify({ action, data });
  return previous?.input === input ? previous : { input, requestId: crypto.randomUUID() };
}
