import { shopWording } from '../utils/customerTerminology';
import { customerToken } from './customerAuth.service';
import { appConfig, isTest } from '../lib/runtimeConfig';

const request = async (action, body = {}) => {
  if (!isTest) throw new Error('NOT_AVAILABLE');
  const token = action === 'account-proof' || action === 'book' ? await customerToken() : '';
  const response = await fetch(`${appConfig.supabaseUrl}/functions/v1/customer-booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: appConfig.supabasePublishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...body }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'UNAVAILABLE');
  return result;
};

export const customerBookingService = {
  async getCatalog() {
    const result = await request('catalog');
    return {
      branches: result.branches.map(branch => ({
        id: branch.id, name: shopWording(branch.name), nameAr: shopWording(branch.name_ar), city: branch.city,
        address: branch.address, logoUrl: branch.image_url, locationUrl: branch.location_url,
        area: branch.areas?.name_en || '', areaAr: branch.areas?.name_ar || '',
      })),
      barbers: result.barbers.map(barber => ({
        id: barber.id, branchId: barber.branch_id, name: barber.name, nameAr: barber.name_ar,
        avatarUrl: barber.avatar_url, serviceIds: barber.service_ids || [], maxBookingDays: barber.max_booking_days,
      })),
      services: result.services.map(service => ({
        id: service.id, branchId: service.branch_id, name: service.name, nameAr: service.name_ar,
        description: service.description, duration: service.duration, price: Number(service.price),
      })),
    };
  },
  accountProof: () => request('account-proof'),
  getSlots: data => request('slots', data),
  requestCode: data => request('request-code', data),
  verifyCode: data => request('verify-code', data),
  async book(data) {
    const result = await request('book', data);
    return {
      ...result,
      branchName: shopWording(result.branch_name), branchNameAr: shopWording(result.branch_name_ar),
      barberName: result.barber_name, barberNameAr: result.barber_name_ar,
      locationUrl: result.location_url,
      services: result.service_names.map(service => ({ name: service.name, nameAr: service.name_ar })),
    };
  },
};
