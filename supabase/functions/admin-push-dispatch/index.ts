import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2.89.0';
import { apnsToken } from '../customer-push-dispatch/apns.ts';
import { type AnnouncementJob, sendAnnouncement } from './delivery.ts';
import { createAnnouncementDispatcher } from './handler.ts';
import { createFCMToken, LIVE_TARGET } from '../customer-android-push-dispatch/fcm.ts';
import { sendAndroidAnnouncement } from './android.ts';
import { createAndroidAcceptanceDispatcher } from './acceptance.ts';
const androidToken = createFCMToken();
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
const general = createAnnouncementDispatcher({
  environment: Deno.env.get('APP_ENV') || '',
  androidEnabled: Deno.env.get('ANDROID_CUSTOMER_ENABLED') === 'true',
  androidPushEnabled: Deno.env.get('ANDROID_PUSH_ENABLED') === 'true',
  androidAnnouncementsEnabled: Deno.env.get('ANDROID_ANNOUNCEMENTS_ENABLED') === 'true',
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
  androidToken: (credential, senderEmail) => androidToken(credential, { ...LIVE_TARGET, senderEmail }),
  sendAndroid: (job, jwt) => sendAndroidAnnouncement(job, jwt, fetch),
  send: (job, jwt, config) => sendAnnouncement(job, jwt, config),
});
const acceptance = createAndroidAcceptanceDispatcher({
  environment: Deno.env.get('APP_ENV') || '',
  enabled: Deno.env.get('ANDROID_ANNOUNCEMENT_ACCEPTANCE_ENABLED') === 'true',
  configuration: () => call('acceptance-configuration'),
  claim: () => call('acceptance-claim'),
  validate: async (job) => await call('acceptance-validate', { id: job.id, lease: job.lease }) === true,
  finish: async (job, result) => {
    if (await call('acceptance-finish', { id: job.id, lease: job.lease, ...result }) !== true) throw Error('ACKNOWLEDGE_UNAVAILABLE');
  },
  token: (credential, senderEmail) => androidToken(credential, { ...LIVE_TARGET, senderEmail }),
  send: (job, token) => sendAndroidAnnouncement(job, token, fetch),
});
Deno.serve((request) => request.headers.get('x-push-purpose') === 'android-acceptance' ? acceptance(request) : general(request));
