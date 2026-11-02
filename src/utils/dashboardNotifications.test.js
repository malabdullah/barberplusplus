import { describe, expect, it, vi } from 'vitest';
import { notificationCopy, notificationDestination } from './dashboardNotifications';
import { getAddedByConfig } from '../constants/addedByTypes';

describe('dashboard notification navigation and copy', () => {
  it('uses the correct manager and barber routes', () => {
    const notification = { entityType: 'booking', entityId: 'booking-1' };
    expect(notificationDestination(notification, 'manager')).toBe('/dashboard/bookings?booking=booking-1');
    expect(notificationDestination(notification, 'barber')).toBe('/barber/bookings?booking=booking-1');
    expect(notificationDestination({ entityType: 'barber' }, 'manager')).toBe('/dashboard/notifications');
  });
  it('preserves historical messages and localizes new events at display time', () => {
    const legacy = { title: 'Existing message', message: 'Original detail' };
    expect(notificationCopy(legacy, vi.fn())).toBe(legacy);
    const t = vi.fn((key, values) => values ? values.customer : key);
    expect(notificationCopy({ type: 'booking_cancelled', entityType: 'booking', metadata: { dashboardEvent: true, customerName: 'A customer' } }, t))
      .toEqual({ title: 'notifications.events.booking_cancelled', message: 'A customer' });
    expect(t).toHaveBeenCalledWith('notifications.bookingDetails', expect.objectContaining({ customer: 'A customer' }));
  });
  it('renders customer attribution separately from staff and historical system actors', () => {
    expect(getAddedByConfig('customer').labelKey).toBe('bookings.addedBy.customer');
    expect(getAddedByConfig('manager').labelKey).toBe('bookings.addedBy.manager');
  });
});
