export function bookingMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = Number(parts.find(part => part.type === 'year')!.value);
  const month = Number(parts.find(part => part.type === 'month')!.value);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
  };
}
