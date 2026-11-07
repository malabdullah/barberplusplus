// Old notifications retain their saved copy; new events are localized at display.
export function notificationCopy(notification, t) {
  if (!notification.metadata?.dashboardEvent) return notification;
  const details = notification.metadata;
  if (notification.entityType === 'availability_request') return { title: t(details.state === 'pending' ? 'availabilityApproval.notificationRequest' : 'availabilityApproval.notificationDecision'), message: t(`availabilityApproval.${details.state === 'pending' ? 'pending' : details.state === 'declined' ? 'declined' : 'approved'}`) };
  const values = { customer: details.customerName || t('bookings.addedBy.customer'),
    barber: details.barberName || '', shop: details.shopName || '',
    date: details.date || '', time: details.time || '' };
  return {
    title: t(`notifications.events.${notification.type}`),
    message: t(notification.entityType === 'booking' ? 'notifications.bookingDetails' : 'notifications.barberDetails', values),
  };
}
export function notificationDestination(notification, role) {
  if (notification.entityType === 'availability_request' && notification.entityId && notification.metadata?.barberId) {
    return role === 'barber' ? '/barber/availability' : `/dashboard/barbers/${encodeURIComponent(notification.metadata.barberId)}/schedule?request=${encodeURIComponent(notification.entityId)}`;
  }
  if (notification.entityType === 'booking' && notification.entityId) {
    return `${role === 'barber' ? '/barber' : '/dashboard'}/bookings?booking=${encodeURIComponent(notification.entityId)}`;
  }
  return role === 'barber' ? '/barber/notifications' : '/dashboard/notifications';
}
