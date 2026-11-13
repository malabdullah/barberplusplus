import { describe, it, expect } from 'vitest';
import { averageFils, reportChange, reportDate, reportMoney, serviceReportNames } from './reportFormatting';

describe('report calculations and presentation', () => {
  it('rounds an exact integer-fils average once and distinguishes no visits', () => {
    expect(averageFils('1000', 3)).toBe('333');
    expect(averageFils('1001', 2)).toBe('501');
    expect(averageFils('0', 1)).toBe('0');
    expect(averageFils('0', 0)).toBeNull();
    expect(averageFils('3240000', 360)).toBe('9000');
  });
  it('does not invent infinite or zero-denominator growth', () => {
    expect(reportChange('1000', '0')).toBe('new');
    expect(reportChange('0', '0')).toBeNull();
    expect(reportChange('3240000', '2880000')).toBe(12.5);
    expect(reportChange('0', '2000')).toBe(-100);
  });
  it('formats Kuwait date boundaries, literal dates and three decimal currency', () => {
    expect(reportDate('2026-01-31T21:00:00Z')).toBe('1 Feb 2026');
    expect(reportDate('2026-01-31')).toBe('31 Jan 2026');
    expect(reportMoney('9000')).toContain('9.000');
    expect(reportMoney(null)).toBe('—');
    expect(() => reportMoney('99999999999999999999')).toThrow();
  });
  it('shows the package and add-ons once in both languages', () => {
    const row = { package: { name: 'Package', name_ar: 'باقة', service_ids: ['a'] }, services: [{ id: 'a', name: 'Included' }, { id: 'b', name: 'Wash', name_ar: 'غسيل', quantity: 2 }] };
    expect(serviceReportNames(row)).toBe('Package · Wash × 2');
    expect(serviceReportNames(row, 'ar')).toBe('باقة · غسيل × 2');
  });
});
