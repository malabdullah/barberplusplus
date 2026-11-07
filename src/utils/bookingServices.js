export const bookingServices = (booking, services = []) => booking.serviceSnapshot?.length
  ? booking.serviceSnapshot.map(service => ({ ...service, nameAr: service.name_ar }))
  : (booking.serviceIds || []).map(id => services.find(service => service.id === id)).filter(Boolean);
