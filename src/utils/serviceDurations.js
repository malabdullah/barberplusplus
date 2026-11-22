export const withBarberDurations = (services, barber) => services.map(service => ({
  ...service, duration: barber?.serviceDurations?.[service.id] ?? service.duration,
}));
