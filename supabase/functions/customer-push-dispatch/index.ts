import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { apnsToken, sendAPNs } from './apns.ts';
import { createBookingPushDispatcher } from './handler.ts';
const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false, autoRefreshToken: false } });
type Configuration = Awaited<ReturnType<Parameters<typeof createBookingPushDispatcher>[0]['configuration']>>;
let cachedConfig: { value: Configuration; expires: number } | undefined;
async function configuration(): Promise<Configuration> {
  if (cachedConfig && cachedConfig.expires > Date.now()) return cachedConfig.value;
  const { data, error } = await admin.rpc('customer_push_configuration');
  if (error || !data) throw Error('ConfigurationUnavailable');
  cachedConfig = { value: data, expires: Date.now() + 60000 };
  return data;
}
Deno.serve(createBookingPushDispatcher({
  environment: Deno.env.get('APP_ENV') || '', appUrl: Deno.env.get('APP_URL') || '',
  publicUrl: Deno.env.get('CUSTOMER_PUBLIC_API_URL') || Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL') || '',
  configuration,
  claim: async () => {
    const { data, error } = await admin.rpc('customer_push_claim', { p_limit: 20 });
    if (error) throw Error('QueueUnavailable');
    return data;
  },
  validate: async job => {
    const { data, error } = await admin.rpc('customer_push_validate', { p_id: job.id, p_lease: job.lease });
    return !error && data === true;
  },
  finish: async (job, result) => {
    const { error } = await admin.rpc('customer_push_finish', { p_id: job.id, p_lease: job.lease,
      p_status: result.status, p_reason: result.reason, p_apns_id: result.apnsId });
    if (error) throw Error('QueueAcknowledgeUnavailable');
  },
  providerToken: key => apnsToken(key.privateKey, key.keyId, key.teamId),
  send: (job, jwt, config) => sendAPNs(job, jwt, fetch, config),
}));
