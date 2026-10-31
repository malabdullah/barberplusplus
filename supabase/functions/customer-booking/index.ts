import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { customerIdentity } from '../_shared/customer-session.ts';
import { createCustomerBookingHandler } from './handler.ts';

const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const admin = createClient(Deno.env.get('SUPABASE_URL') || '', secret, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createCustomerBookingHandler({
  environment: Deno.env.get('APP_ENV') || '',
  productionEnabled: Deno.env.get('CUSTOMER_ACCOUNTS_ENABLED') === 'true',
  appUrl: Deno.env.get('APP_URL') || '',
  publicUrl: Deno.env.get('CUSTOMER_PUBLIC_API_URL') || Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL') || '',
  secret,
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
