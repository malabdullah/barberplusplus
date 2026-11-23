import { mapPackage } from '../utils/servicePackages';
import { shopWording } from '../utils/customerTerminology';
import { customerToken } from './customerAuth.service';
import { appConfig, customerFeaturesEnabled } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';

const request = async (action, body = {}) => {
  if (!customerFeaturesEnabled) throw new Error('NOT_AVAILABLE');
  const token = action.startsWith('discovery-') || action === 'phone-confirm' || action === 'account-proof' || action === 'book' || action === 'online-start' || action === 'claim-booking' ? await customerToken() : '';
  const response = await functionFetch(`${appConfig.supabaseUrl}/functions/v1/customer-booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: appConfig.supabasePublishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...body }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error === 'BOOKING_UNAVAILABLE' && result.reason === 'SHOP_ACCESS_REQUIRED' ? 'BILLING_BOOKING_UNAVAILABLE' : result.error || 'UNAVAILABLE');
  return result;
};

export const mapCatalog = result => ({
      branches: result.branches.map(branch => {
        const area = branch.areas;
        const governorate = area?.governorates || branch.governorates;
        return {
          id: branch.id, name: shopWording(branch.name), nameAr: shopWording(branch.name_ar),
          city: area?.name_en || branch.city?.trim() || '',
          cityAr: area?.name_ar || branch.city_ar || '',
          address: branch.address, logoUrl: branch.image_url, locationUrl: branch.location_url, rating: branch.rating,
          area: area?.name_en || '', areaAr: area?.name_ar || '',
          governorateId: governorate?.id ?? null,
          governorateName: governorate?.name_en || '',
          governorateNameAr: governorate?.name_ar || '',
        };
      }),
      barbers: result.barbers.map(barber => ({
        id: barber.id, branchId: barber.branch_id, name: barber.name, nameAr: barber.name_ar,
        serviceDurations: barber.service_durations || {}, avatarUrl: barber.avatar_url, serviceIds: barber.service_ids || [], maxBookingDays: barber.max_booking_days, rating: barber.rating,
      })),
      services: result.services.map(service => ({
        id: service.id, branchId: service.branch_id, name: service.name, nameAr: service.name_ar,
        description: service.description, duration: service.duration, price: Number(service.price),
      })),
    });

export const customerBookingService = {
  async getStatistics() {
    const totals = await request('statistics');
    const counts = { shops: totals.shops, monthlyBookings: totals.monthlyBookings, barbers: totals.barbers };
    if (Object.values(counts).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('UNAVAILABLE');
    return counts;
  },
  async getCatalog() {
    const result = await request('catalog');
    return mapCatalog(result);
  },
  packages: async (branchId, barberId, date) => (await request('packages', { branchId, barberId, date: date || null })).packages.map(mapPackage),
  entry: data => request('discovery-entry', data),
  filters: () => request('discovery-filters'),
  search: data => request('discovery-search', data),
  async selection(data) {
    const result = await request('discovery-selection', data);
    return { ...mapCatalog(result), maxDuration: result.maxDuration };
  },
  claim: claimToken => request('claim-booking', { claimToken }),
  checkoutPolicy: () => request('phone-config'),
  phoneConfig: async () => (await request('phone-config')).phone,
  startTestPhone: async phone => (await request('phone-start', { phone })).session,
  confirmPhone: data => request('phone-confirm', data),
  accountProof: () => request('account-proof'),
  getSlots: data => request('slots', data),
  guestProof: data => request('guest-proof', data),
  requestCode: data => request('request-code', data),
  verifyCode: data => request('verify-code', data),
  startOnlinePayment: (data, capability) => request('online-start', { ...data, capability }),
  async checkOnlinePayment(capability) {
    const result = await request('online-check', { capability });
    return { ...result, receipt: result.receipt ? mapReceipt(result.receipt) : null };
  },
  async book(data) {
    return mapReceipt(await request('book', data));
  },
};

function mapReceipt(result) {
  return {
    ...result,
    package: result.package ? mapPackage(result.package) : null,
    branchName: shopWording(result.branch_name), branchNameAr: shopWording(result.branch_name_ar),
    barberName: result.barber_name, barberNameAr: result.barber_name_ar,
    locationUrl: result.location_url,
    services: result.service_names.map(service => ({ name: service.name, nameAr: service.name_ar })),
  };
}
