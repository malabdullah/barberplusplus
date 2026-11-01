import { getBarberServices, getKuwaitDate } from './customerBooking';

export function appointmentDate(booking) {
  return new Date(`${booking.date}T${booking.time.slice(0, 5)}:00+03:00`);
}

export function isPastAppointment(booking, now = Date.now()) {
  return ['completed', 'cancelled', 'no_show'].includes(booking.status) || appointmentDate(booking).getTime() < now;
}

export function rebookingDraft(booking, catalog) {
  if (!isPastAppointment(booking)) throw new Error('INVALID_SELECTION');
  const shop = catalog.branches.find(item => item.id === booking.branch_id && item.city);
  const barber = shop && catalog.barbers.find(item => item.id === booking.barber_id && item.branchId === shop.id && getBarberServices(catalog, shop.id, item.id).length);
  return {
    city: shop?.city || '', branchId: shop?.id || '', barberId: barber?.id || '',
    serviceIds: [], date: getKuwaitDate(), time: '',
    panel: !shop ? 'city' : !barber ? 'barber' : 'services', step: shop && barber ? 1 : 0,
    rebooking: true, rebookNotice: !shop ? 'shopUnavailable' : !barber ? 'barberUnavailable' : '',
  };
}
