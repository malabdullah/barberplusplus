type ServiceName = { name: string; name_ar: string | null };
type LegacyService = ServiceName & { id: string };

export const bookingRPC = (action: string) =>
  action === 'book' ? 'native_customer_booking' : 'customer_booking';

// A purchased snapshot is authoritative. Only legacy empty snapshots may use
// a bounded lookup, and its result is reordered to the purchased service IDs.
export async function recoveredServiceNames(snapshot: unknown, serviceIds: string[],
  lookup: (ids: string[]) => Promise<LegacyService[]>): Promise<ServiceName[]> {
  if (snapshot != null && !(Array.isArray(snapshot) && snapshot.length === 0)) {
    if (!Array.isArray(snapshot) || snapshot.length > 10 || snapshot.some(item =>
      !item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name
      || (item.name_ar != null && typeof item.name_ar !== 'string'))) throw Error('Recovery unavailable');
    return snapshot.map(item => ({ name: item.name, name_ar: item.name_ar ?? null }));
  }
  if (!Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > 10
    || new Set(serviceIds).size !== serviceIds.length) throw Error('Recovery unavailable');
  const services = await lookup(serviceIds);
  return serviceIds.map(id => {
    const service = services.find(item => item.id === id);
    if (!service || typeof service.name !== 'string' || !service.name) throw Error('Recovery unavailable');
    return { name: service.name, name_ar: service.name_ar ?? null };
  });
}
