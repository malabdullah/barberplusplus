import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { customerIdentity } from '../_shared/customer-session.ts';
import { createCustomerBookingHandler } from './handler.ts';
import { bookingMonth } from './statistics.ts';

const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const admin = createClient(Deno.env.get('SUPABASE_URL') || '', secret, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createCustomerBookingHandler({
  environment: Deno.env.get('APP_ENV') || '',
  productionEnabled: Deno.env.get('CUSTOMER_ACCOUNTS_ENABLED') === 'true',
  cloudTestProjectRef: Deno.env.get('CLOUD_TEST_PROJECT_REF'),
  cloudAccessKey: Deno.env.get('CLOUD_TEST_ACCESS_KEY'),
  appUrl: Deno.env.get('APP_URL') || '',
  publicUrl: Deno.env.get('CUSTOMER_PUBLIC_API_URL') || Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL') || '',
  secret,
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
    const [branches, barbers, services] = await Promise.all([
      admin.from('branches').select('id,name,name_ar,city,address,image_url,location_url,areas(name_en,name_ar)').eq('status', 'active').order('name'),
      admin.from('barbers').select('id,branch_id,name,name_ar,avatar_url,service_ids,max_booking_days').eq('status', 'active').order('name'),
      admin.from('services').select('id,branch_id,name,name_ar,description,duration,price').eq('status', 'active').order('name'),
    ]);
    if (branches.error || barbers.error || services.error) throw Error('Catalog unavailable');
    const branchIds = new Set(branches.data.map(branch => branch.id));
    return { branches: branches.data, barbers: barbers.data.filter(barber => branchIds.has(barber.branch_id)), services: services.data.filter(service => branchIds.has(service.branch_id)) };
  },
  booking: async (action, data) => {
    const result = await admin.rpc('customer_booking', { p_action: action, p_data: data });
    if (result.error) throw Error(`${result.error.code} ${result.error.message}`);
    return result.data;
  },
}));
