// Old notifications retain their saved copy; new events are localized at display.
export function notificationCopy(notification, t) {
  if (!notification.metadata?.dashboardEvent) return notification;
  const details = notification.metadata;
  const values = { customer: details.customerName || t('bookings.addedBy.customer'),
    barber: details.barberName || '', shop: details.shopName || '',
    date: details.date || '', time: details.time || '' };
  return {
    title: t(`notifications.events.${notification.type}`),
    message: t(notification.entityType === 'booking' ? 'notifications.bookingDetails' : 'notifications.barberDetails', values),
  };
}
export function notificationDestination(notification, role) {
  if (notification.entityType === 'booking' && notification.entityId) {
    return `${role === 'barber' ? '/barber' : '/dashboard'}/bookings?booking=${encodeURIComponent(notification.entityId)}`;
  }
  return role === 'barber' ? '/barber/notifications' : '/dashboard/notifications';
}
