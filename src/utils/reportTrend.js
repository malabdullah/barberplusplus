// Calendar buckets preserve exact integer-fils totals, including zero days.
export function buildReportTrend(days, from, to, language = 'en') {
  const start = Date.parse(`${from}T00:00:00Z`);
  const finish = Date.parse(`${to}T00:00:00Z`);
  const dayMs = 86400000;
  const count = Math.round((finish - start) / dayMs) + 1;
  if (!Number.isFinite(count) || count <= 0 || count > 366) return [];
  const step = count <= 14 ? 1 : count <= 56 ? 7 : Math.ceil(count / 8);
  const values = new Map(days.map(day => [day.date, Number(day.salesFils)]));
  const format = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const bins = [];
  for (let offset = 0; offset < count; offset += step) {
    const a = new Date(start + offset * dayMs);
    const b = new Date(Math.min(finish, start + (offset + step - 1) * dayMs));
    let fils = 0;
    for (let date = a.getTime(); date <= b.getTime(); date += dayMs) fils += values.get(new Date(date).toISOString().slice(0, 10)) || 0;
    if (!Number.isSafeInteger(fils)) throw new Error('REPORT_AMOUNT_INVALID');
    bins.push({ from: a.toISOString().slice(0, 10), to: b.toISOString().slice(0, 10), axisLabel: format.format(a), label: a.getTime() === b.getTime() ? format.format(a) : `${format.format(a)} – ${format.format(b)}`, fils });
  }
  return bins;
}
