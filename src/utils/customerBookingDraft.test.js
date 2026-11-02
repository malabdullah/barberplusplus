import { beforeEach, expect, it, vi } from 'vitest';
import { readBookingDraft, saveBookingDraft, readBookingReceipt, saveBookingReceipt, customerReturnTo, rememberBookingReturn } from './customerBookingDraft';
const draft = { city: 'Sharq', branchId: 'shop', barberId: 'barber', serviceIds: ['service'], date: '2026-11-03', time: '10:00', step: 2, panel: 'details', guest: true, details: { name: 'Guest', countryCode: '+965', phone: '50000099', notes: 'Keep this note' } };
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); });
it('resumes all chosen data and typed details in another same-origin tab without auth credentials', () => {
  saveBookingDraft({ ...draft, password: 'never-store', verification: 'never-store' });
  sessionStorage.clear();
  expect(readBookingDraft()).toMatchObject(draft);
  const stored = localStorage.getItem('barber-customer-booking-draft');
  expect(stored).not.toContain('never-store');
});
it('expires drafts after an hour and rejects future or malformed selections', () => {
  const now = Date.now(); saveBookingDraft(draft); vi.spyOn(Date, 'now').mockReturnValue(now + 3600001); expect(readBookingDraft()).toBeNull();
  localStorage.setItem('barber-customer-booking-draft', JSON.stringify({ ...draft, savedAt: now + 3600002 })); expect(readBookingDraft()).toBeNull();
});
it('falls back to tab storage when persistent storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) { if (this === localStorage) throw Error('blocked'); Object.defineProperty(this, key, { value, configurable: true }); });
  saveBookingDraft(draft); expect(readBookingDraft()).toMatchObject(draft);
});
it('clears both copies, restricts auth returns and expires the receipt independently', () => {
  saveBookingDraft(draft); sessionStorage.setItem('barber-customer-booking-draft', localStorage.getItem('barber-customer-booking-draft'));
  saveBookingDraft(null); expect(readBookingDraft()).toBeNull();
  expect(customerReturnTo({ search: '?next=https://evil.example' })).toBe('/customer/account');
  rememberBookingReturn(); expect(customerReturnTo({ search: '' })).toBe('/book');
  saveBookingReceipt({ id: 'booking', reference: 'REF', date: '2026-11-03', time: '10:00', duration: 30, price: 5, services: [], claimToken: 'private-proof' });
  expect(readBookingReceipt().claimToken).toBe('private-proof'); saveBookingReceipt(null); expect(readBookingReceipt()).toBeNull();
});
