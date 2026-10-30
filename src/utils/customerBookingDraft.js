const KEY = 'barber-customer-booking-draft';
export function readBookingDraft() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY));
    if (!value || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt > 3600000 || value.savedAt > Date.now() || !Array.isArray(value.serviceIds) || value.serviceIds.length > 10 || value.serviceIds.some(id => typeof id !== 'string' || id.length > 120) || ![0, 1, 2].includes(value.step)) return null;
    if (['city', 'branchId', 'barberId', 'date', 'time'].some(key => typeof value[key] !== 'string' || value[key].length > 120)) return null;
    return value;
  } catch { return null; }
}
export function saveBookingDraft(selection) {
  try { if (selection) sessionStorage.setItem(KEY, JSON.stringify({ ...selection, savedAt: Date.now() })); else sessionStorage.removeItem(KEY); } catch { /* Booking still works when browser storage is unavailable. */ }
}
