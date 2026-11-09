import { addBookingDays } from './customerBooking';

export function packageEndDate(start, period) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) return '';
  if (period === 'week') return addBookingDays(start, 6);
  if (period !== 'month') return start;
  const day = new Date(`${start}T12:00:00Z`);
  const date = day.getUTCDate();
  day.setUTCDate(1); day.setUTCMonth(day.getUTCMonth() + 1);
  const last = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
  day.setUTCDate(Math.min(date, last));
  return addBookingDays(day.toISOString().slice(0, 10), -1);
}
export function packageSelection(currentIds, previous, next) {
  const included = previous?.serviceIds || [];
  return [...new Set([...currentIds.filter(id => !included.includes(id)), ...(next?.serviceIds || [])])];
}
export function packageTotals(services, selectedIds, offer) {
  const selected = services.filter(service => selectedIds.includes(service.id));
  return {
    duration: selected.reduce((sum, service) => sum + Number(service.duration), 0),
    price: selected.reduce((sum, service) => sum + (offer?.serviceIds?.includes(service.id) ? 0 : Number(service.price)), offer ? Number(offer.price) : 0),
  };
}

export function bookedPackageTotals(booking, serviceIds, services) {
  const lines = serviceIds.map(id => booking.serviceSnapshot?.find(line => line.id === id) || services.find(service => service.id === id)).filter(Boolean);
  const included = booking.packageSnapshot?.service_ids || [];
  return { duration: lines.reduce((sum, line) => sum + Number(line.duration), 0), price: lines.reduce((sum, line) => sum + (included.includes(line.id) ? 0 : Number(line.price)), Number(booking.packageSnapshot?.price || 0)) };
}

export const packageErrors = ['PACKAGE_CHANGED', 'INVALID_PACKAGE', 'INVALID_PACKAGE_SELECTION', 'PACKAGE_UNAVAILABLE', 'PACKAGE_DATE_UNAVAILABLE', 'PACKAGE_PERIOD_OVERLAP', 'PACKAGE_EXTENSION_INVALID', 'PACKAGE_HAS_BOOKINGS'];
export function packageError(error, t) {
  const code = packageErrors.find(code => new RegExp(`\\b${code}\\b`).test(error?.message || ''));
  return t(`packages.errors.${code || 'UNAVAILABLE'}`);
}
export const mapPackage = item => ({ ...item, nameAr: item.name_ar, serviceIds: item.service_ids || [], price: Number(item.price), regularPrice: Number(item.regular_price), startsOn: item.starts_on, endsOn: item.ends_on });
