import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { bookingsService } from './bookings.service';
beforeEach(() => rpc.mockReset());
it('keeps customer contact and appointment creation in one server request', async () => {
  rpc.mockResolvedValue({ data: { id: 'booking', time: '15:00:00', customer_id: 'customer', customer: { id: 'customer', name: 'QA Customer', phone: '59979005', country_code: '+965' }, price: 3.125 } });
  const result = await bookingsService.create({ branchId: 'shop', barberId: 'barber', customerName: 'QA Customer', customerPhone: '59979005', customerCountryCode: '+965', serviceIds: ['service'] });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('staff_save_booking', { p_id: null, p_data: expect.objectContaining({ branch_id: 'shop', customer_name: 'QA Customer', customer_phone: '59979005' }) });
  expect(result.customerName).toBe('QA Customer');
  expect(result.price).toBe(3.125);
  expect(result.time).toBe('15:00');
});
it('propagates a failed customer transaction instead of returning an empty-contact booking', async () => {
  rpc.mockResolvedValue({ error: new Error('CUSTOMER_REQUIRED') });
  await expect(bookingsService.create({})).rejects.toThrow('CUSTOMER_REQUIRED');
});
