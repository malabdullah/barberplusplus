import { describe, expect, it } from 'vitest';
import { withBarberDurations } from './serviceDurations';
describe('personal service durations', () => {
 const services = [{id:'hair',duration:30,price:3},{id:'beard',duration:15,price:2}];
 it('uses shop defaults without overrides', () => { expect(withBarberDurations(services, {})).toEqual(services); });
 it('changes only the selected barber and service duration', () => {
  expect(withBarberDurations(services, {serviceDurations:{hair:45}})).toEqual([{id:'hair',duration:45,price:3},services[1]]);
  expect(services[0].duration).toBe(30);
  expect(withBarberDurations(services,{serviceDurations:{}})[0].duration).toBe(30);
 });
});
