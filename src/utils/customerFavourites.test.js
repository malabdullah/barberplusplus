import { beforeEach, expect, it } from 'vitest';
import { favouriteBookingDraft, rememberFavouriteIntent, readFavouriteIntent, clearFavouriteIntent } from './customerFavourites';
const id = 'aa021100-0000-4000-8000-000000000001';
const catalog = { branches: [{ id: 'shop', city: 'Salmiya' }, { id: 'new', city: 'Hawally' }], barbers: [{ id: 'barber', branchId: 'shop', serviceIds: ['hair'] }], services: [{ id: 'hair', branchId: 'shop' }] };
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
it('starts favourite shop bookings at barbers and favourite barber bookings at services, with fresh selections', () => {
  expect(favouriteBookingDraft({ kind: 'shop', shopId: 'shop' }, catalog)).toMatchObject({ city: 'Salmiya', branchId: 'shop', barberId: '', panel: 'barber', serviceIds: [], time: '' });
  expect(favouriteBookingDraft({ kind: 'barber', targetId: 'barber', shopId: 'shop' }, catalog)).toMatchObject({ barberId: 'barber', panel: 'services', serviceIds: [], time: '' });
});
it('uses the current location and never silently substitutes another barber', () => {
  const moved = { ...catalog, barbers: [{ ...catalog.barbers[0], branchId: 'new' }], services: [{ id: 'hair', branchId: 'new' }] };
  expect(favouriteBookingDraft({ kind: 'barber', targetId: 'barber', shopId: 'shop' }, moved)).toMatchObject({ branchId: 'new', city: 'Hawally', panel: 'services' });
  expect(favouriteBookingDraft({ kind: 'barber', targetId: 'missing', shopId: 'shop' }, catalog)).toMatchObject({ barberId: '', panel: 'barber', rebookNotice: 'barberUnavailable' });
  expect(favouriteBookingDraft({ kind: 'shop', shopId: 'missing' }, catalog)).toMatchObject({ branchId: '', panel: 'city', rebookNotice: 'shopUnavailable' });
});
it('persists only a bounded favourite intent, expires it and supports cancellation', () => {
  rememberFavouriteIntent('barber', id); expect(readFavouriteIntent()).toMatchObject({ kind: 'barber', targetId: id });
  const key = 'barber-customer-favourite-intent';
  localStorage.setItem(key, JSON.stringify({ kind: 'barber', targetId: id, savedAt: Date.now() - 3600001 })); expect(readFavouriteIntent()).toBeNull();
  rememberFavouriteIntent('admin', id); expect(readFavouriteIntent()).toBeNull();
  rememberFavouriteIntent('shop', id); clearFavouriteIntent(); expect(readFavouriteIntent()).toBeNull();
});
