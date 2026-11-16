import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { withCloudTestGateway } from '../_shared/test-boundary.ts';
import { createAndroidPushDispatcher } from './handler.ts';
import { createFCMToken, sendFCM } from './fcm.ts';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const url = Deno.env.get('SUPABASE_URL') || '';
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
async function rpc(action: string, data: Record<string, unknown> = {}) {
  const result = await admin.rpc('customer_android_push_dispatch', { p_action: action, p_data: data });
  if (result.error) throw Error('ANDROID_PUSH_UNAVAILABLE');
  return result.data;
}
Deno.serve(withCloudTestGateway(createAndroidPushDispatcher({
  environment: Deno.env.get('APP_ENV') || '', appUrl: Deno.env.get('APP_URL') || '',
  publicUrl: Deno.env.get('CUSTOMER_PUBLIC_API_URL') || Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL') || '',
  authorizeService: async token => {
    if (url !== 'https://qvkucvcjmojjbphlzlks.supabase.co') return false;
    const verifier = createClient(url, token, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await verifier.rpc('customer_android_push_dispatch', { p_action: 'authorize', p_data: {} });
    return !result.error && result.data === true;
  },
  configuration: () => rpc('configuration'), claim: () => rpc('claim'),
  validate: job => rpc('validate', { id: job.id, lease: job.lease }),
  finish: async (job, outcome) => { await rpc('finish', { id: job.id, lease: job.lease, ...outcome }); },
  token: createFCMToken(), send: sendFCM,
})));
