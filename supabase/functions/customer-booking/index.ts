import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { customerIdentity } from '../_shared/customer-session.ts';
import { createCustomerBookingHandler } from './handler.ts';
import { confirmGooglePhone } from './google-phone.ts';
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
      admin.from('branches').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      admin.from('barbers').select('id,branches!inner(status)', { count: 'exact', head: true }).eq('status', 'active').eq('branches.status', 'active'),
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
      admin.from('branches').select('id,name,name_ar,city,address,image_url,location_url,governorates:governorate_id(id,name_en,name_ar),areas:area_id(name_en,name_ar,governorates:governorate_id(id,name_en,name_ar))').eq('status', 'active').order('name'),
      admin.from('barbers').select('id,branch_id,name,name_ar,avatar_url,service_ids,max_booking_days').eq('status', 'active').order('name'),
      admin.from('services').select('id,branch_id,name,name_ar,description,duration,price').eq('status', 'active').order('name'),
      admin.rpc('customer_catalog_ratings'),
    ]);
    if (branches.error || barbers.error || services.error) throw Error('Catalog unavailable');
    const branchIds = new Set(branches.data.map(branch => branch.id));
    if (ratingResult.error) console.warn('Catalog ratings unavailable', ratingResult.error.code);
    const ratings = ratingResult.error ? undefined : ratingResult.data;
    return {
      branches: branches.data.map(branch => ({ ...branch, rating: ratings ? ratings.shops[branch.id] ?? null : undefined })),
      barbers: barbers.data.filter(barber => branchIds.has(barber.branch_id))
        .map(barber => ({ ...barber, rating: ratings ? ratings.barbers[barber.id] ?? null : undefined })),
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
