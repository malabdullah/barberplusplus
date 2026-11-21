import { describe, expect, it } from 'vitest';
import { settlementAmount, settlementDate, settlementPercent } from './settlementFormatting';
describe('settlement financial input', () => {
  it('accepts exact fils including zero fees and signed fee credits', () => {
    expect(settlementAmount('٣٫١٢٥')).toBe('3125');
    expect(settlementAmount('0')).toBeNull();
    expect(settlementAmount('٠٫٠٠٠', { zero: true })).toBe('0');
    expect(settlementAmount('-1.025', { signed: true })).toBe('-1025');
    for (const input of ['-1', '3.0001', '1e3', 'Infinity', '1000000.001']) expect(settlementAmount(input)).toBeNull();
  });
  it('represents commission in basis points and interprets dates in Kuwait', () => {
    expect(settlementPercent('٥٫٢٥')).toBe(525);
    expect(settlementPercent('100')).toBe(10000);
    for (const input of ['', '100.01', '-1', '5.001', '1e2']) expect(settlementPercent(input)).toBeNull();
    expect(settlementDate('2026-11-20T16:15')).toBe('2026-11-20T13:15:00.000Z');
  });
});
