import { bookingMonth } from './statistics.ts';

Deno.test('statistics use Kuwait calendar month at UTC month/year boundaries', () => {
  for (const [instant, start, end] of [
    ['2026-10-31T20:59:59Z', '2026-10-01', '2026-11-01'],
    ['2026-10-31T21:00:00Z', '2026-11-01', '2026-12-01'],
    ['2026-12-31T21:00:00Z', '2027-01-01', '2027-02-01'],
  ]) {
    const period = bookingMonth(new Date(instant));
    if (period.start !== start || period.end !== end) throw Error('Incorrect reporting month');
  }
});
