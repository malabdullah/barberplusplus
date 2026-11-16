import { getKuwaitDate } from './customerBooking';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Public catalog identifiers only. A new journey never carries a shared booking
// capability, customer information, quoted services or a previous appointment time.
export function parseBookingEntry(search) {
  const params = new URLSearchParams(search);
  if (!params.has('shop') && !params.has('barber')) return null;
  const entries = [...params.entries()];
  if (entries.length !== 1 || !['shop', 'barber'].includes(entries[0][0]) || !uuid.test(entries[0][1])) return { invalid: true };
  return { kind: entries[0][0], targetId: entries[0][1] };
}
export function bookingEntryPath(kind, id) {
  return ['shop', 'barber'].includes(kind) && uuid.test(id || '') ? `/book?${kind}=${id}` : null;
}
export function bookingEntryHref(kind, id, environment) {
  const path = bookingEntryPath(kind, id);
  if (!path) return null;
  if (environment === 'cloud-test') return 'https://barber-open-test.alabdullah-cs.workers.dev' + path;
  if (environment === 'production') return 'https://barber-open.alabdullah-cs.workers.dev' + path;
  return path;
}
export function hasBookingSelection(draft) {
  return Boolean(draft && (draft.bookingMode || draft.city || draft.branchId || draft.barberId || draft.time || draft.serviceIds?.length || draft.packageOfferId || Object.values(draft.details || {}).some(value => typeof value === 'string' && value.trim() && value !== '+965')));
}
export function bookingEntryDraft(entry) {
  if (!entry || !['shop', 'barber'].includes(entry.kind) || !uuid.test(entry.branchId || '') || !entry.city || (entry.kind === 'barber' && !uuid.test(entry.barberId || ''))) throw Error('INVALID_SELECTION');
  const barber = entry.kind === 'barber';
  return { city: entry.city, branchId: entry.branchId, barberId: barber ? entry.barberId : '',
    bookingMode: 'shop', serviceIds: [], packageOfferId: '', packageOffer: null, date: getKuwaitDate(), time: '',
    panel: barber ? 'services' : 'barber', step: barber ? 1 : 0, ...(barber ? {} : { finderStage: 'results' }) };
}
