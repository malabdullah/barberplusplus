import { getBarberServices, getKuwaitDate } from './customerBooking';
const KEY = 'barber-customer-favourite-intent';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const favouriteKey = (kind, id) => `${kind}:${id}`;
export function clearFavouriteIntent() {
  for (const kind of ['localStorage', 'sessionStorage']) { try { window[kind].removeItem(KEY); } catch { /* Optional storage. */ } }
}
export function readFavouriteIntent() {
  for (const kind of ['localStorage', 'sessionStorage']) {
    try {
      const value = JSON.parse(window[kind].getItem(KEY));
      if (value && ['shop', 'barber'].includes(value.kind) && uuid.test(value.targetId) && Number.isFinite(value.savedAt) && value.savedAt <= Date.now() && Date.now() - value.savedAt < 3600000) return value;
    } catch { /* Try the other storage. */ }
  }
  return null;
}
export function rememberFavouriteIntent(kind, targetId) {
  clearFavouriteIntent();
  if (!['shop', 'barber'].includes(kind) || !uuid.test(targetId)) return;
  for (const storage of ['localStorage', 'sessionStorage']) {
    try { window[storage].setItem(KEY, JSON.stringify({ kind, targetId, savedAt: Date.now() })); return; } catch { /* Try the other storage. */ }
  }
}
export function favouriteBookingDraft(favourite, catalog) {
  const person = favourite.kind === 'barber' ? catalog.barbers.find(item => item.id === favourite.targetId) : null;
  const shop = catalog.branches.find(item => item.id === (person?.branchId || favourite.shopId) && item.city);
  const barber = person && shop && getBarberServices(catalog, shop.id, person.id).length ? person : null;
  return {
    city: shop?.city || '', branchId: shop?.id || '', barberId: barber?.id || '',
    serviceIds: [], date: getKuwaitDate(), time: '',
    panel: !shop ? 'city' : barber ? 'services' : 'barber', step: barber ? 1 : 0,
    favourite: true, rebookNotice: !shop ? 'shopUnavailable' : favourite.kind === 'barber' && !barber ? 'barberUnavailable' : '',
  };
}
