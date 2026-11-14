export function averageFils(fils, count) {
  if (!count) return null;
  const amount = BigInt(fils || 0);
  return ((amount * 2n + BigInt(count)) / (2n * BigInt(count))).toString();
}

export function reportMoney(fils, language = 'en') {
  if (fils === null || fils === undefined) return '—';
  const amount = Number(fils);
  if (!Number.isSafeInteger(amount)) throw new Error('REPORT_AMOUNT_INVALID');
  return new Intl.NumberFormat(language.startsWith('ar') ? 'ar-KW' : 'en-KW', {
    style: 'currency', currency: 'KWD', minimumFractionDigits: 3, maximumFractionDigits: 3,
  }).format(amount / 1000);
}

export function reportChange(current, previous) {
  const a = Number(current); const b = Number(previous);
  if (!b) return a ? 'new' : null;
  return (a - b) / b * 100;
}

export function reportDate(date, language = 'en', withTime = false) {
  return new Intl.DateTimeFormat(language.startsWith('ar') ? 'ar-KW' : 'en-GB', {
    dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}), timeZone: 'Asia/Kuwait',
  }).format(new Date(date.length === 10 ? `${date}T12:00:00+03:00` : date));
}

export function localizedReportName(value, language = 'en') {
  return language.startsWith('ar') && value.nameAr ? value.nameAr : value.name;
}

export function serviceReportNames(row, language = 'en') {
  const included = row.package?.service_ids || [];
  return [row.package && (language.startsWith('ar') && row.package.name_ar || row.package.name),
    ...(row.services || []).filter(item => !included.includes(item.id)).map(item => (language.startsWith('ar') && item.name_ar || item.name) + (item.quantity > 1 ? ` × ${item.quantity}` : '')),
  ].filter(Boolean).join(' · ');
}
