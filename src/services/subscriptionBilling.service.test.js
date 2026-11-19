import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { billingWriteIntent, subscriptionRpc } from './subscriptionBilling.service';

beforeEach(() => rpc.mockReset());
describe('subscription boundary', () => {
  it('retains a request ID only for an identical retry', () => {
    const first = billingWriteIntent(null, 'grant', { businessId: 'one', reason: 'Support' });
    expect(billingWriteIntent(first, 'grant', { businessId: 'one', reason: 'Support' })).toBe(first);
    expect(billingWriteIntent(first, 'grant', { businessId: 'two', reason: 'Support' }).requestId).not.toBe(first.requestId);
    expect(billingWriteIntent(first, 'revoke-grant', { businessId: 'one', reason: 'Support' }).requestId).not.toBe(first.requestId);
  });
  it('uses the session-bound RPC, not a privileged client or payment endpoint', async () => {
    rpc.mockResolvedValue({ data: { totalFils: 25000 } });
    expect(await subscriptionRpc('quote', { businessId: 'one' })).toEqual({ totalFils: 25000 });
    expect(rpc).toHaveBeenCalledWith('subscription_billing', { p_action: 'quote', p_data: { businessId: 'one' } });
  });
  it('exposes safe known errors and hides raw provider/internal failures', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'BILLING_STALE' } }).mockResolvedValueOnce({ error: { message: 'internal connection detail' } });
    await expect(subscriptionRpc('preferences')).rejects.toThrow('BILLING_STALE');
    await expect(subscriptionRpc('detail')).rejects.toThrow('BILLING_FAILED');
  });
});
