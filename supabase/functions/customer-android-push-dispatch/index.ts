import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2.89.0';
import { withCloudTestGateway } from '../_shared/test-boundary.ts';
import { androidRuntime } from '../customer-auth/android-runtime.ts';
import { createAndroidPushDispatcher } from './handler.ts';
import { createFCMToken, sendFCM } from './fcm.ts';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const url = Deno.env.get('SUPABASE_URL') || '';
const configuration = { environment: Deno.env.get('APP_ENV') || '', appUrl: Deno.env.get('APP_URL') || '',
  publicUrl: Deno.env.get('CUSTOMER_PUBLIC_API_URL') || Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL') || '',
  androidEnabled: Deno.env.get('ANDROID_CUSTOMER_ENABLED') === 'true', androidPushEnabled: Deno.env.get('ANDROID_PUSH_ENABLED') === 'true' };
const runtime = androidRuntime(configuration);
const rpcName = configuration.environment === 'production' ? 'customer_android_live_push_dispatch' : 'customer_android_push_dispatch';
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
async function rpc(action: string, data: Record<string, unknown> = {}) {
  const result = await admin.rpc(rpcName, { p_action: action, p_data: data });
  if (result.error) throw Error('ANDROID_PUSH_UNAVAILABLE');
  return result.data;
}
Deno.serve(withCloudTestGateway(createAndroidPushDispatcher({
  ...configuration,
  authorizeService: async token => {
    if (!runtime) return false;
    // Fixed reviewed issuing backend. No caller URL, JWT inspection shortcut or
    // byte comparison with a potentially rotated server credential.
    const verifier = createClient(runtime.apiUrl, token, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await verifier.rpc(rpcName, { p_action: 'authorize', p_data: {} });
    return !result.error && result.data === true;
  },
  authorizeDispatch: async secret => {
    if (configuration.environment !== 'production') return false;
    const result = await admin.rpc('authorize_android_live_push_dispatch', { p_secret: secret });
    return !result.error && result.data === true;
  },
  configuration: () => rpc('configuration'), claim: () => rpc('claim'),
  validate: job => rpc('validate', { id: job.id, lease: job.lease }),
  finish: async (job, outcome) => { await rpc('finish', { id: job.id, lease: job.lease, ...outcome }); },
  token: createFCMToken(), send: (job, token, target) => sendFCM(job, token, fetch, target),
})));
