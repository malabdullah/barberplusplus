import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { apnsToken } from '../customer-push-dispatch/apns.ts';
import { type AnnouncementJob, sendAnnouncement } from './delivery.ts';
import { createAnnouncementDispatcher } from './handler.ts';
const admin = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);
async function call(action: string, data: Record<string, unknown> = {}) {
  const r = await admin.rpc('admin_push_worker', {
    p_action: action,
    p_data: data,
  });
  if (r.error) throw Error('WORKER_UNAVAILABLE');
  return r.data;
}
Deno.serve(createAnnouncementDispatcher({
  environment: Deno.env.get('APP_ENV') || '',
  appUrl: Deno.env.get('APP_URL') || '',
  publicUrl: Deno.env.get('CUSTOMER_PUBLIC_API_URL') ||
    Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL') || '',
  configuration: () => call('configuration'),
  claim: () => call('claim', { limit: 20 }),
  continueWork: async () => {
    await call('continue');
  },
  validate: async (job: AnnouncementJob) =>
    (await call('validate', { id: job.id, lease: job.lease })) === true,
  finish: async (job, result) => {
    if (
      await call('finish', { id: job.id, lease: job.lease, ...result }) !== true
    ) throw Error('ACKNOWLEDGE_UNAVAILABLE');
  },
  providerToken: (config) =>
    apnsToken(config.privateKey, config.keyId, config.teamId),
  send: (job, jwt, config) => sendAnnouncement(job, jwt, config),
}));
