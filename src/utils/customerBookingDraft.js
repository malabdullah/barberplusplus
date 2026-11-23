let authStorageKey;
export function configureBookingSession(key) { authStorageKey = key; }

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
function currentAccount() {
  try { return JSON.parse(window.localStorage.getItem(authStorageKey))?.user || null; }
  catch { return null; }
}
export function bookingSessionOwner() { return currentAccount()?.id || null; }
export function clearBookingSession() { [KEY, RECEIPT_KEY, RETURN_KEY].forEach(remove); }

function readFrom(kind, key, accepts) {
  try {
    const value = JSON.parse(window[kind].getItem(key));
    if (fresh(value) && accepts(value)) return value;
    if (value) window[kind].removeItem(key);
  } catch { /* Storage is optional. */ }
  return null;
}
function read(key) {
  const owner = bookingSessionOwner();
  const accepts = value => value.owner === owner;
  const tab = readFrom('sessionStorage', key, accepts);
  const shared = readFrom('localStorage', key, accepts);
  return tab && (!shared || tab.savedAt >= shared.savedAt) ? tab : shared;
}
function writeTo(kind, key, value) {
  try { window[kind].setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ }
}
function write(key, value) {
  remove(key);
  if (!value) return;
  const owned = { ...value, owner: bookingSessionOwner(), savedAt: Date.now() };
  writeTo('sessionStorage', key, owned);
  // Only booking selections can follow email redirects across tabs.
  const { details: _details, ...selection } = owned;
  writeTo('localStorage', key, selection);
}
function validBookingDraft(value) {
  if (!value || !Array.isArray(value.serviceIds) || value.serviceIds.length > 10 || value.serviceIds.some(id => typeof id !== 'string' || id.length > 120) || ![0, 1, 2].includes(value.step)) return null;
  if (['city', 'branchId', 'barberId', 'date', 'time'].some(key => typeof value[key] !== 'string' || value[key].length > 120)) return null;
  if (value.locationCities !== undefined && (!Array.isArray(value.locationCities) || value.locationCities.length > 64
    || value.locationCities.some(city => typeof city !== 'string' || !city.trim() || city.length > 120))) return null;
  if (value.locationGovernorateId != null && (!Number.isInteger(value.locationGovernorateId) || value.locationGovernorateId < 1 || value.locationGovernorateId > 2147483647)) return null;
  if (value.locationCities?.length > 1 && !value.locationGovernorateId) return null;
  if (value.packageOfferId && (typeof value.packageOfferId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.packageOfferId))) return null;
  if (value.packageOffer && (!Array.isArray(value.packageOffer.serviceIds) || value.packageOffer.serviceIds.length > 10 || !Number.isFinite(Number(value.packageOffer.price)) || typeof value.packageOffer.name !== 'string' || typeof value.packageOffer.startsOn !== 'string' || typeof value.packageOffer.endsOn !== 'string')) return null;
  if (value.details && ['name', 'countryCode', 'phone', 'notes'].some(key => typeof value.details[key] !== 'string')) return null;
  if (value.details?.email !== undefined && (typeof value.details.email !== 'string' || value.details.email.length > 254)) return null;
  return value;
}
export function readBookingDraft() { return validBookingDraft(read(KEY)); }
export function readBookingReturnDraft() {
  const owner = bookingSessionOwner();
  const tab = readFrom('sessionStorage', RETURN_KEY, value => value.owner === owner || (owner && value.owner === null));
  if (tab?.draft) {
    if (tab.owner === owner) return validBookingDraft(tab.draft);
    const { details: _details, guest: _guest, ...selection } = tab.draft;
    return validBookingDraft(selection);
  }
  return validBookingDraft(read(RETURN_KEY)?.draft);
}
export function saveBookingDraft(selection) {
  if (!selection) { remove(KEY); return; }
  const { city, locationCities, locationGovernorateId, branchId, barberId, serviceIds, packageOfferId, packageOffer, date, time, panel, step, rebooking, favourite, rebookNotice, guest, details, query, bookingMode, rangeStart, rangeEnd, finderStage } = selection;
  write(KEY, { bookingMode, rangeStart, rangeEnd, finderStage, city, locationCities, locationGovernorateId, branchId, barberId, serviceIds, packageOfferId: typeof packageOfferId === 'string' ? packageOfferId.slice(0, 36) : '', packageOffer: packageOffer ? { id: packageOffer.id, name: packageOffer.name, nameAr: packageOffer.nameAr, serviceIds: packageOffer.serviceIds, price: packageOffer.price, regularPrice: packageOffer.regularPrice, duration: packageOffer.duration, startsOn: packageOffer.startsOn, endsOn: packageOffer.endsOn } : null, date, time, panel, step, rebooking, favourite, rebookNotice, guest: guest === true, query: typeof query === 'string' ? query.slice(0, 120) : undefined,
    details: details ? { email: String(details.email || '').slice(0, 254), name: String(details.name || '').slice(0, 120), countryCode: String(details.countryCode || '+965').slice(0, 4), phone: String(details.phone || '').slice(0, 20), notes: String(details.notes || '').slice(0, 500) } : undefined });
}
export function saveBookingReceipt(receipt, guestEmail = '') {
  remove(RECEIPT_KEY);
  if (!receipt) return;
  writeTo('sessionStorage', RECEIPT_KEY, {
    ...receipt, owner: bookingSessionOwner(), savedAt: Date.now(), guestEmail: guestEmail.trim().toLowerCase(),
  });
}
export function readBookingReceipt() {
  try { window.localStorage.removeItem(RECEIPT_KEY); } catch { /* Discard the old shared copy. */ }
  const account = currentAccount();
  const value = readFrom('sessionStorage', RECEIPT_KEY, item => item.owner === (account?.id || null)
    || (item.owner === null && item.claimAfterSignIn && account?.email_confirmed_at && item.guestEmail
      && account.email?.toLowerCase() === item.guestEmail));
  return value && typeof value.id === 'string' && typeof value.reference === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && /^\d{2}:\d{2}$/.test(value.time) && Array.isArray(value.services) && Number.isFinite(Number(value.price)) && Number.isFinite(value.duration) ? value : null;
}
export function rememberBookingReturn({ preserveDraft = false, claimGuestReceipt = false } = {}) {
  const draft = (preserveDraft ? readBookingReturnDraft() : null) || readBookingDraft();
  const value = { returnTo: '/book', draft, owner: bookingSessionOwner(), savedAt: Date.now() };
  remove(RETURN_KEY);
  writeTo('sessionStorage', RETURN_KEY, value);
  const { details: _details, ...selection } = draft || {};
  writeTo('localStorage', RETURN_KEY, { ...value, draft: draft ? selection : null });
  if (claimGuestReceipt) {
    const receipt = readBookingReceipt();
    if (receipt?.owner === null && receipt.guestEmail && receipt.claimToken) {
      writeTo('sessionStorage', RECEIPT_KEY, { ...receipt, claimAfterSignIn: true });
    }
  }
}
export function forgetBookingReturn() { remove(RETURN_KEY); }
export function customerReturnTo(location) {
  return location.state?.returnTo === '/book' || new URLSearchParams(location.search).get('next') === 'book' || read(RETURN_KEY)?.returnTo === '/book' ? '/book' : '/customer/account';
}
export function customerAuthPath(path, returnTo) { return returnTo === '/book' ? `${path}?next=book` : path; }
