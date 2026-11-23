import { beforeEach, expect, it, vi } from 'vitest';
import { clearBookingSession, configureBookingSession, readBookingDraft, saveBookingDraft, readBookingReceipt, saveBookingReceipt, customerReturnTo, rememberBookingReturn } from './customerBookingDraft';
const draft = { city: 'Sharq', branchId: 'shop', barberId: 'barber', serviceIds: ['service'], date: '2026-11-03', time: '10:00', step: 2, panel: 'details', guest: true, details: { name: 'Guest', countryCode: '+965', phone: '50000099', notes: 'Keep this note' } };
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); });
it('keeps typed details in their tab and resumes only selections in another tab', () => {
  saveBookingDraft({ ...draft, password: 'never-store', verification: 'never-store' });
  expect(readBookingDraft()).toMatchObject(draft);
  sessionStorage.clear();
  expect(readBookingDraft()).toMatchObject({ branchId: draft.branchId });
  expect(readBookingDraft().details).toBeUndefined();
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

it('keeps the discovery city set separate from the selected shop city across checkout', () => {
  const location = { locationCities: ['Kuwait City', 'Mirqab'], locationGovernorateId: 1 };
  saveBookingDraft({ ...draft, city: 'Mirqab', ...location });
  expect(readBookingDraft()).toMatchObject({ city: 'Mirqab', ...location });
  saveBookingDraft({ ...draft, locationCities: location.locationCities });
  expect(readBookingDraft()).toBeNull();
});

it('opens a signed-in receipt only for its originating account and tab', () => {
  configureBookingSession('test-auth');
  const login = id => localStorage.setItem('test-auth', JSON.stringify({ user: { id } }));
  login('first');
  saveBookingDraft(draft);
  saveBookingReceipt({ id: 'booking', reference: 'REF', date: '2026-11-03', time: '10:00', duration: 30, price: 5, services: [], claimToken: 'private-proof' });
  expect(localStorage.getItem('barber-customer-booking-receipt')).toBeNull();
  expect(readBookingReceipt().reference).toBe('REF');
  login('second');
  expect(readBookingReceipt()).toBeNull();
  expect(readBookingDraft()).toBeNull();
  clearBookingSession();
  login('first');
  expect(readBookingReceipt()).toBeNull();
});
it('only hands off a guest receipt when explicitly requested for the same verified email', () => {
  const receipt = { id: 'guest', reference: 'GUEST', date: '2026-11-03', time: '10:00', duration: 30, price: 5, services: [], claimToken: 'private-proof' };
  configureBookingSession('test-auth');
  const login = email => localStorage.setItem('test-auth', JSON.stringify({ user: { id: 'account', email, email_confirmed_at: 'verified' } }));
  saveBookingReceipt(receipt, 'guest@example.test');
  rememberBookingReturn({ claimGuestReceipt: true });
  login('guest@example.test');
  expect(readBookingReceipt().id).toBe('guest');

  localStorage.removeItem('test-auth');
  saveBookingReceipt(receipt, 'guest@example.test');
  rememberBookingReturn({ claimGuestReceipt: true });
  login('another@example.test');
  expect(readBookingReceipt()).toBeNull();
});
