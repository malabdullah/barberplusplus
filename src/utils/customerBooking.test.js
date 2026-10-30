import { describe, expect, it } from 'vitest';
import { addBookingDays, bookingCalendar, getBarberServices, getKuwaitDate, safeBookingUrl, searchBranches } from './customerBooking';

describe('customer booking', () => {
  it('uses Kuwait dates around midnight regardless of browser timezone', () => {
    expect(getKuwaitDate(new Date('2026-10-30T22:00:00Z'))).toBe('2026-10-31');
    expect(addBookingDays('2026-10-31', 2)).toBe('2026-11-02');
  });
  it('never shows branches before a city is selected or leaks results from another city', () => {
    const branches = [{ city: 'Kuwait City', name: 'Seafront' }, { city: 'Salmiya', name: 'Seafront' }];
    expect(searchBranches(branches, '', '')).toEqual([]);
    expect(searchBranches(branches, 'Salmiya', 'sea')).toEqual([branches[1]]);
  });
  it('searches Arabic branch names and areas without diacritics', () => {
    const branches = [{ city: 'Kuwait City', nameAr: 'فَرْع الواجهة', areaAr: 'البحرية' }];
    expect(searchBranches(branches, 'Kuwait City', 'فرع بحرية')).toEqual(branches);
  });
  it('limits services to those assigned to the chosen barber in the chosen branch', () => {
    const catalog = { barbers: [{ id: 'b', branchId: 'one', serviceIds: ['s1', 's2'] }], services: [{ id: 's1', branchId: 'one' }, { id: 's2', branchId: 'two' }, { id: 's3', branchId: 'one' }] };
    expect(getBarberServices(catalog, 'one', 'b')).toEqual([catalog.services[0]]);
    expect(getBarberServices(catalog, 'two', 'b')).toEqual([]);
  });
  it('rejects executable, missing and credential-bearing media/location links', () => {
    expect(safeBookingUrl(undefined)).toBeNull();
    expect(safeBookingUrl('javascript:alert(1)')).toBeNull();
    expect(safeBookingUrl('https://secret@example.test')).toBeNull();
    expect(safeBookingUrl('/logo.png')).toMatch(/\/logo.png$/);
  });
  it('exports the confirmed appointment in UTC and escapes calendar text', () => {
    const calendar = bookingCalendar({ id: 'one', reference: 'REF', date: '2026-10-31', time: '10:30', duration: 45, services: [{ name: 'Hair, beard' }], branchName: 'Test\nShop' });
    expect(calendar).toContain('DTSTART:20261031T073000Z');
    expect(calendar).toContain('DTEND:20261031T081500Z');
    expect(calendar).toContain('SUMMARY:Hair\\, beard');
    expect(calendar).toContain('LOCATION:Test\\nShop');
  });
});
