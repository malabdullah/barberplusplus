import { it, expect } from 'vitest';
import { buildReportTrend } from './reportTrend';

it('groups a long month into readable periods and keeps its exact total', () => {
  const days = Array.from({ length: 31 }, (_, n) => ({ date: `2026-10-${String(n + 1).padStart(2, '0')}`, salesFils: '1001' }));
  const bins = buildReportTrend(days, '2026-10-01', '2026-10-31');
  expect(bins).toHaveLength(5);
  expect(bins[0]).toMatchObject({ from: '2026-10-01', to: '2026-10-07', fils: 7007 });
  expect(bins.at(-1)).toMatchObject({ from: '2026-10-29', to: '2026-10-31', fils: 3003 });
  expect(bins.reduce((total, bin) => total + bin.fils, 0)).toBe(31031);
});
it('includes known zero days without confusing gaps with visits', () => {
  const bins = buildReportTrend([{ date: '2026-11-03', salesFils: '5000' }], '2026-11-01', '2026-11-03');
  expect(bins.map(bin => bin.fils)).toEqual([0, 0, 5000]);
});
it('bounds long and leap-year charts while keeping their calendar boundaries', () => {
  const bins = buildReportTrend([], '2028-01-01', '2028-12-31', 'ar-KW');
  expect(bins.length).toBeLessThanOrEqual(8);
  expect(bins.at(-1).to).toBe('2028-12-31');
  expect(buildReportTrend([], '2026-11-03', '2026-11-01')).toEqual([]);
});
