// Illustrative calculations only; the future backend must calculate real quotes.
export const PREVIEW_TODAY = '2026-11-19';
export const MAX_PREVIEW_BARBERS = 10000;

export function previewQuote(count, frequency, code, today = PREVIEW_TODAY) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PREVIEW_BARBERS) return { error: 'invalidCount' };
  if (!['monthly', 'yearly'].includes(frequency)) return { error: 'invalidFrequency' };
  const monthly = Math.max(25000, count * 10000);
  const subtotal = frequency === 'yearly' ? monthly * 10 : monthly;
  if (code) {
    if (!code.enabled || code.expiresOn < today) return { error: 'codeExpired' };
    if (code.limit !== null && code.used >= code.limit) return { error: 'codeUsed' };
    if (code.eligibility !== 'both' && code.eligibility !== frequency) return { error: 'codeIneligible' };
  }
  const discount = code ? Math.min(subtotal, code.type === 'percent'
    ? Math.round(subtotal * code.value / 100) : code.value) : 0;
  return { monthly, subtotal, discount, total: subtotal - discount, yearlySaving: monthly * 2 };
}

export function previewAccess(business, today = PREVIEW_TODAY) {
  if (['active', 'trial', 'grace'].includes(business.status)) return business.status;
  const grant = business.grant;
  if (grant && grant.startsOn <= today && grant.endsOn > today) return grant.type === 'full' ? 'complimentary' : 'manual';
  return business.status;
}

export function validatePreviewGrant({ startsOn, endsOn, reason, type, shopIds }, business, today = PREVIEW_TODAY) {
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0,10) === value;
  if (!validDate(startsOn) || !validDate(endsOn)
    || startsOn < today || endsOn <= startsOn) return 'invalidDates';
  if (!reason.trim()) return 'reasonRequired';
  if (!['full', 'manual'].includes(type)) return 'invalidGrant';
  if (type === 'manual' && (!shopIds.length || shopIds.some(id => !business.shops.some(shop => shop.id === id)))) return 'shopRequired';
  return null;
}

export function previewFixedFils(text) {
  if (!/^\d+(\.\d{1,3})?$/.test(String(text))) return null;
  const [whole, fraction = ''] = String(text).split('.');
  const fils = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(fils) && fils > 0 ? fils : null;
}
