const KEY = 'barber-customer-booking-draft';
const RECEIPT_KEY = 'barber-customer-booking-receipt';
const RETURN_KEY = 'barber-customer-booking-return';
const LIFETIME = 60 * 60 * 1000;
const fresh = value => value && Number.isFinite(value.savedAt) && Date.now() - value.savedAt < LIFETIME && value.savedAt <= Date.now();
const remove = key => {
  for (const kind of ['localStorage', 'sessionStorage']) {
    try { window[kind].removeItem(key); } catch { /* Storage is optional. */ }
  }
};
function read(key) {
  const values = [];
  for (const kind of ['localStorage', 'sessionStorage']) {
    try { const value = JSON.parse(window[kind].getItem(key)); if (fresh(value)) values.push(value); else window[kind].removeItem(key); } catch { /* Try the other storage. */ }
  }
  return values.sort((a, b) => b.savedAt - a.savedAt)[0] || null;
}
function write(key, value) {
  remove(key);
  if (!value) return;
  // Same-origin tabs (including email callbacks) can resume; fall back to this
  // tab when persistent storage is unavailable. Never store auth credentials.
  for (const kind of ['localStorage', 'sessionStorage']) {
    try { window[kind].setItem(key, JSON.stringify({ ...value, savedAt: Date.now() })); return; } catch { /* Try the other storage. */ }
  }
}
function validBookingDraft(value) {
  if (!value || !Array.isArray(value.serviceIds) || value.serviceIds.length > 10 || value.serviceIds.some(id => typeof id !== 'string' || id.length > 120) || ![0, 1, 2].includes(value.step)) return null;
  if (['city', 'branchId', 'barberId', 'date', 'time'].some(key => typeof value[key] !== 'string' || value[key].length > 120)) return null;
  if (value.details && ['name', 'countryCode', 'phone', 'notes'].some(key => typeof value.details[key] !== 'string')) return null;
  return value;
}
export function readBookingDraft() { return validBookingDraft(read(KEY)); }
export function readBookingReturnDraft() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(RETURN_KEY));
    if (fresh(value)) return validBookingDraft(value.draft);
  } catch { /* Use shared storage if tab storage is unavailable. */ }
  return validBookingDraft(read(RETURN_KEY)?.draft);
}
export function saveBookingDraft(selection) {
  if (!selection) { remove(KEY); return; }
  const { city, branchId, barberId, serviceIds, date, time, panel, step, rebooking, favourite, rebookNotice, guest, details, query } = selection;
  write(KEY, { city, branchId, barberId, serviceIds, date, time, panel, step, rebooking, favourite, rebookNotice, guest: guest === true, query: typeof query === 'string' ? query.slice(0, 120) : undefined,
    details: details ? { name: String(details.name || '').slice(0, 120), countryCode: String(details.countryCode || '+965').slice(0, 4), phone: String(details.phone || '').slice(0, 20), notes: String(details.notes || '').slice(0, 500) } : undefined });
}
export function saveBookingReceipt(receipt) { write(RECEIPT_KEY, receipt); }
export function readBookingReceipt() {
  const value = read(RECEIPT_KEY);
  return value && typeof value.id === 'string' && typeof value.reference === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && /^\d{2}:\d{2}$/.test(value.time) && Array.isArray(value.services) && Number.isFinite(Number(value.price)) && Number.isFinite(value.duration) ? value : null;
}
export function rememberBookingReturn({ preserveDraft = false } = {}) {
  const draft = (preserveDraft ? readBookingReturnDraft() : null) || readBookingDraft();
  const value = { returnTo: '/book', draft, savedAt: Date.now() };
  write(RETURN_KEY, value);
  // Keep this tab's OAuth handoff even if another tab opens the booking page.
  try { window.sessionStorage.setItem(RETURN_KEY, JSON.stringify(value)); } catch { /* Optional storage. */ }
}
export function forgetBookingReturn() { remove(RETURN_KEY); }
export function customerReturnTo(location) {
  return location.state?.returnTo === '/book' || new URLSearchParams(location.search).get('next') === 'book' || read(RETURN_KEY)?.returnTo === '/book' ? '/book' : '/customer/account';
}
export function customerAuthPath(path, returnTo) { return returnTo === '/book' ? `${path}?next=book` : path; }
