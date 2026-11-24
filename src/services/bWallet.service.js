import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';
import { supabase } from '../lib/supabase';
import { customerToken } from './customerAuth.service';

export function walletAmountFils(input) {
  const normalized = String(input).trim().replace(/[\u0660-\u0669\u06f0-\u06f9]/g,
    digit => String(digit.charCodeAt(0) & 15)).replace('\u066b','.');
  const match = /^(\d{1,6})(?:\.(\d{1,3}))?$/.exec(normalized);
  return match ? Number(match[1]) * 1000 + Number((match[2] || '').padEnd(3, '0')) : null;
}

export async function walletRpc(action, data = {}) {
  const { data: value, error } = await supabase.rpc('b_wallet', { p_action: action, p_data: data });
  if (error) throw new Error(error.message.match(/^WALLET_[A-Z_]+$/)?.[0] || 'WALLET_UNAVAILABLE');
  return value;
}

export async function walletTopup(action, data = {}) {
  const token = await customerToken();
  if (!token) throw new Error('AUTH_REQUIRED');
  const response = await functionFetch(`${appConfig.supabaseUrl}/functions/v1/b-wallet`, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...data }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'WALLET_UNAVAILABLE');
  return value.topup;
}

export async function walletBooking(action, id, data = {}) {
  const { data: value, error } = await supabase.rpc('b_wallet_booking', { p_action: action, p_id: id, p_data: data });
  if (error) throw new Error(error.message.match(/^(?:WALLET|BOOKING)_[A-Z_]+$/)?.[0] || 'WALLET_UNAVAILABLE');
  return value;
}
