import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { customerIdentity } from '../_shared/customer-session.ts';
import { createCustomerBookingHandler } from './handler.ts';
import { confirmGooglePhone, startGoogleTestPhone } from './google-phone.ts';
import { bookingMonth } from './statistics.ts';

const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const admin = createClient(Deno.env.get('SUPABASE_URL') || '', secret, { auth: { persistSession: false, autoRefreshToken: false } });
const projectId = Deno.env.get('CHECKOUT_GOOGLE_PROJECT') || '';
const apiKey = Deno.env.get('CHECKOUT_GOOGLE_API_KEY') || '';
const appId = Deno.env.get('CHECKOUT_GOOGLE_APP_ID') || '';
const testPhones = (Deno.env.get('CHECKOUT_GOOGLE_TEST_PHONES') || '').split(',').filter(value => /^\+[1-9]\d{7,14}$/.test(value));
const cloudTest = Deno.env.get('APP_ENV') === 'cloud-test';
const enabled = Deno.env.get('CHECKOUT_GOOGLE_PHONE_ENABLED') === 'true';
const phone = enabled && /^[a-z][a-z0-9-]{4,29}$/.test(projectId) && apiKey && appId && (!cloudTest || testPhones.length)
  ? { projectId, apiKey, appId, ...(cloudTest ? { testPhones } : {}) } : undefined;
if (enabled && !phone) throw Error('Checkout phone verification is enabled but not configured');

Deno.serve(createCustomerBookingHandler({
  environment: Deno.env.get('APP_ENV') || '',
  productionEnabled: Deno.env.get('CUSTOMER_ACCOUNTS_ENABLED') === 'true',
  cloudTestProjectRef: Deno.env.get('CLOUD_TEST_PROJECT_REF'),
  cloudAccessKey: Deno.env.get('CLOUD_TEST_ACCESS_KEY'),
  appUrl: Deno.env.get('APP_URL') || '',
  publicUrl: Deno.env.get('CUSTOMER_PUBLIC_API_URL') || Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL') || '',
  secret,
  phone,
  startTestPhone: number => phone && cloudTest ? startGoogleTestPhone(phone, number) : Promise.reject(Error('PHONE_UNAVAILABLE')),
  confirmPhone: (session, code, number) => phone ? confirmGooglePhone(phone, session, code, number) : Promise.resolve(false),
  accountPhone: async (customerId, country, number, verified) => {
    const result = await admin.rpc('customer_checkout_phone', { p_customer: customerId, p_country: country, p_phone: number, p_verified: verified });
    if (result.error) throw Error(result.error.message);
    return result.data === true;
  },
  statistics: async () => {
    const month = bookingMonth();
    // Return counts only; no staff contacts, customer identities or booking rows.
    const [shops, barbers, bookings] = await Promise.all([
      admin.from('branches').select('id', { count: 'exact', head: true }).eq('status', 'active').eq('publication_state', 'published'),
      admin.from('barbers').select('id,branches!inner(status,publication_state)', { count: 'exact', head: true }).eq('status', 'active').eq('branches.status', 'active').eq('branches.publication_state', 'published'),
      admin.from('bookings').select('id', { count: 'exact', head: true }).gte('date', month.start).lt('date', month.end).not('status', 'in', '(cancelled,no_show)'),
    ]);
    if ([shops, barbers, bookings].some(result => result.error || result.count === null)) throw Error('Statistics unavailable');
    return { shops: shops.count!, monthlyBookings: bookings.count!, barbers: barbers.count! };
  },
  customer: async token => {
    const identity = await customerIdentity(admin, token);
    if (!identity) return null;
    const result = await admin.rpc('customer_account_api', {p_action:'profile',p_data:identity});
    return result.error || !result.data ? null : {...result.data,session_id:identity.session_id};
  },
  catalog: async () => {
    // Explicit projections: no customer records, staff contacts or booking data.
    const [branches, barbers, services, ratingResult] = await Promise.all([
      admin.from('branches').select('id,name,name_ar,city,address,image_url,location_url,working_hours,governorates:governorate_id(id,name_en,name_ar),areas:area_id(name_en,name_ar,governorates:governorate_id(id,name_en,name_ar))').eq('status', 'active').eq('publication_state', 'published').order('name'),
      admin.from('barbers').select('id,branch_id,name,name_ar,avatar_url,service_ids,max_booking_days,availability').eq('status', 'active').order('name'),
      admin.from('services').select('id,branch_id,name,name_ar,description,duration,price').eq('status', 'active').order('name'),
      admin.rpc('customer_catalog_ratings'),
    ]);
    if (branches.error || barbers.error || services.error) throw Error('Catalog unavailable');
    const serviceIds = new Set(services.data.map(service => service.id));
    const readyBarbers = barbers.data.filter(barber => {
      const shop = branches.data.find(shop => shop.id === barber.branch_id);
      const offered = services.data.filter(service => service.branch_id === barber.branch_id && barber.service_ids?.includes(service.id) && serviceIds.has(service.id));
      if (!shop || !offered.length) return false;
      const schedule = (barber.availability || {}) as Record<string, { enabled?: boolean; available?: boolean; start?: string; end?: string }>;
      const shopHours = (shop.working_hours || {}) as Record<string, { open?: string; close?: string }>;
      const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
      return Object.entries(schedule).some(([day, hours]) => {
        const opening = shopHours[day];
        if (!(hours.enabled ?? hours.available) || !hours.start || !hours.end || !opening?.open || !opening.close) return false;
        const available = Math.min(minutes(hours.end), minutes(opening.close)) - Math.max(minutes(hours.start), minutes(opening.open));
        return offered.some(service => service.duration <= available);
      });
    });
    const readyShopIds = new Set(readyBarbers.map(barber => barber.branch_id));
    const readyBranches = branches.data.filter(branch => readyShopIds.has(branch.id));
    const branchIds = new Set(readyBranches.map(branch => branch.id));
    if (ratingResult.error) console.warn('Catalog ratings unavailable', ratingResult.error.code);
    const ratings = ratingResult.error ? undefined : ratingResult.data;
    return {
      branches: readyBranches.map(({ working_hours: _hours, ...branch }) => ({ ...branch, rating: ratings ? ratings.shops[branch.id] ?? null : undefined })),
      barbers: readyBarbers.filter(barber => branchIds.has(barber.branch_id))
        .map(({ availability: _hours, ...barber }) => ({ ...barber, rating: ratings ? ratings.barbers[barber.id] ?? null : undefined })),
      services: services.data.filter(service => branchIds.has(service.branch_id)),
    };
  },
  claim: async data => {
    const result = await admin.rpc('customer_claim_booking', { p_booking: data.booking_id, p_account: data.account_user_id, p_session: data.session_id });
    if (result.error) throw Error(`${result.error.code} ${result.error.message}`);
    return result.data;
  },
  booking: async (action, data) => {
    const result = await admin.rpc('customer_booking', { p_action: action, p_data: data });
    if (result.error) throw Error(`${result.error.code} ${result.error.message}`);
    return result.data;
  },
}));
