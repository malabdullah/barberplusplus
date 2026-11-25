import { expect, it, vi } from 'vitest';
vi.mock('../../services/customerBooking.service', () => ({ customerBookingService: {} }));
import { onlinePaymentLink } from './BookingPaymentReturn';
it('allows only the pinned provider sandbox checkout origins', () => {
  expect(onlinePaymentLink('https://demo.myfatoorah.com/KWT/ie/example')).toBe('https://demo.myfatoorah.com/KWT/ie/example');
  expect(onlinePaymentLink('https://sandbox.upayments.com/?session_id=valid-test-session')).toBeTruthy();
  for (const url of ['https://demo.myfatoorah.com.evil.test/pay', 'https://user:secret@demo.myfatoorah.com/pay', 'javascript:alert(1)', 'https://portal.myfatoorah.com/pay']) expect(onlinePaymentLink(url)).toBe('');
});
