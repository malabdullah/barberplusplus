import { supabase } from '../lib/supabase';

export function settlementError(error) {
  return String(error?.message || '').match(/SETTLEMENT_[A-Z_]+/)?.[0] || 'SETTLEMENT_FAILED';
}
export async function settlementRpc(admin, action, data = {}) {
  const { data: value, error } = await supabase.rpc(admin ? 'platform_settlements' : 'shop_settlements', { p_action: action, p_data: data });
  if (error) throw new Error(settlementError(error));
  return value;
}
