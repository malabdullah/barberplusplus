import { expect, it } from 'vitest';
import { isPastAppointment, rebookingDraft } from './customerRebooking';
const booking = { date: '2025-01-01', time: '10:00:00', status: 'confirmed', branch_id: 'shop', barber_id: 'barber', service_ids: ['old-service'] };
const catalog = { branches: [{ id: 'shop', city: 'Salmiya' }], barbers: [{ id: 'barber', branchId: 'shop', serviceIds: ['hair'] }], services: [{ id: 'hair', branchId: 'shop' }] };
it('splits visits using Kuwait time and includes terminal statuses regardless of their scheduled date', () => {
  const now = Date.parse('2026-11-01T07:00:00Z');
  expect(isPastAppointment({ ...booking, date: '2026-11-01', time: '09:59' }, now)).toBe(true);
  expect(isPastAppointment({ ...booking, date: '2026-11-01', time: '10:01' }, now)).toBe(false);
  for (const status of ['cancelled', 'completed', 'no_show']) expect(isPastAppointment({ ...booking, date: '2099-01-01', status }, now)).toBe(true);
});
it('uses current exact shop/barber IDs and clears all old services and appointment times', () => {
  expect(rebookingDraft(booking, catalog)).toMatchObject({ city: 'Salmiya', branchId: 'shop', barberId: 'barber', serviceIds: [], time: '', panel: 'services' });
  expect(() => rebookingDraft({ ...booking, date: '2099-01-01' }, catalog)).toThrow('INVALID_SELECTION');
});
it('asks for a replacement when a shop or assigned barber is unavailable, without selecting a different one silently', () => {
  expect(rebookingDraft(booking, { ...catalog, branches: [] })).toMatchObject({ city: '', branchId: '', barberId: '', panel: 'city', rebookNotice: 'shopUnavailable' });
  expect(rebookingDraft(booking, { ...catalog, barbers: [{ ...catalog.barbers[0], branchId: 'other-shop' }] })).toMatchObject({ city: 'Salmiya', branchId: 'shop', barberId: '', panel: 'barber', rebookNotice: 'barberUnavailable' });
  expect(rebookingDraft(booking, { ...catalog, services: [] })).toMatchObject({ barberId: '', panel: 'barber' });
});
