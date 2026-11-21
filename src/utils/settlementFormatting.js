import { parseFinanceAmount } from './financeFormatting';

export function settlementAmount(value, { zero = false, signed = false } = {}) {
  const text = String(value ?? '').trim();
  const negative = signed && text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  if (zero && /^(0|٠|۰)([.٫](0{1,3}|٠{1,3}|۰{1,3}))?$/.test(unsigned)) return '0';
  const amount = parseFinanceAmount(unsigned);
  return amount === null ? null : `${negative ? '-' : ''}${amount}`;
}
export function settlementPercent(value) {
  const text = String(value).trim().replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632)).replace(/٫/g, '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return bps <= 10000 ? bps : null;
}
export function settlementDate(value) {
  // Form fields always represent Kuwait time, independent of the browser zone.
  return value ? new Date(`${value.length === 16 ? `${value}:00` : value}+03:00`).toISOString() : null;
}
export function settlementNow() {
  return new Date(Date.now() + 10800000).toISOString().slice(0, 19);
}
