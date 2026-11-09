import { expect, it } from 'vitest';
import { bookedPackageTotals, packageEndDate, packageSelection, packageTotals } from './servicePackages';
it('uses seven inclusive dates and calendar months across leap and year boundaries', () => {
  expect(packageEndDate('2027-01-01', 'week')).toBe('2027-01-07');
  expect(packageEndDate('2027-01-01', 'month')).toBe('2027-01-31');
  expect(packageEndDate('2028-02-01', 'month')).toBe('2028-02-29');
  expect(packageEndDate('2026-12-15', 'month')).toBe('2027-01-14');
  expect(packageEndDate('2027-01-31', 'month')).toBe('2027-02-27');
});
it('replaces one bundle while keeping extras and preventing duplicate included services', () => {
  expect(packageSelection(['hair', 'beard', 'wash'], { serviceIds: ['hair', 'beard'] }, { serviceIds: ['hair', 'wash', 'facial'] })).toEqual(['wash', 'hair', 'facial']);
  expect(packageSelection(['hair', 'beard', 'wash'], { serviceIds: ['hair', 'beard'] }, null)).toEqual(['wash']);
});
it('adds extra duration and price without charging included services twice', () => {
  const services = [{ id: 'hair', duration: 30, price: 5 }, { id: 'beard', duration: 20, price: 3 }, { id: 'facial', duration: 40, price: 7 }, { id: 'wash', duration: 15, price: 2 }];
  expect(packageTotals(services, services.map(s => s.id), { price: 10, serviceIds: ['hair', 'beard', 'facial'] })).toEqual({ price: 12, duration: 105 });
});
it('keeps purchased line prices and durations when a new extra is added later', () => {
  const booking = { packageSnapshot: { price: 10, service_ids: ['hair', 'beard'] }, serviceSnapshot: [{ id: 'hair', price: 5, duration: 30 }, { id: 'beard', price: 3, duration: 20 }, { id: 'wash', price: 2, duration: 15 }] };
  const live = [{ id: 'hair', price: 8, duration: 45 }, { id: 'wash', price: 3, duration: 20 }, { id: 'facial', price: 7, duration: 40 }];
  expect(bookedPackageTotals(booking, ['hair', 'beard', 'wash', 'facial'], live)).toEqual({ price: 19, duration: 105 });
});
