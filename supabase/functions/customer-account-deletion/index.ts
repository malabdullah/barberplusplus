import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2.89.0';
import { withCloudTestGateway } from '../_shared/test-boundary.ts';
import { customerIdentity } from '../_shared/customer-session.ts';
import { createDeletionHandler, digest } from './handler.ts';
import { deletionConfiguration, deletionRuntimeMatches, withDeletionActivation, type RuntimeConfiguration } from './configuration.ts';
import { createDeletionMailer } from './mail.ts';
import { createDeletionCleanup } from './cleanup.ts';
import { appleConfiguration, createAppleActions, createAppleProvider } from './apple.ts';
declare const EdgeRuntime: { waitUntil: (work: Promise<void>) => void };
const url = Deno.env.get('SUPABASE_URL') || '';
const appUrl = Deno.env.get('APP_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const environment = Deno.env.get('APP_ENV') || '';
const configuration = deletionConfiguration({ environment, appUrl, backendUrl: url,
  publicUrl: Deno.env.get('CUSTOMER_PUBLIC_API_URL') || Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL') || url,
  productionBackendUrl: Deno.env.get('CUSTOMER_ACCOUNT_DELETION_BACKEND_URL'),
  productionEnabled: Deno.env.get('CUSTOMER_ACCOUNT_DELETION_ENABLED'),
  productionCleanupEnabled: Deno.env.get('CUSTOMER_ACCOUNT_DELETION_CLEANUP_ENABLED'),
  resendKey: Deno.env.get('RESEND_API_KEY'),
});
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input: string | URL | Request, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) } };
const admin = createClient(url, serviceKey, options);
async function rpc(action: string, data: Record<string, unknown> = {}) {
  const result = await admin.rpc('customer_deletion_service', { p_action: action, p_data: data });
  if (result.error) throw Error(result.error.message);
  return result.data;
}
const apple = createAppleProvider(appleConfiguration(configuration, Deno.env.get('CUSTOMER_APPLE_REVOCATION_ENABLED'), Deno.env.get('CUSTOMER_APPLE_REVOCATION_CLIENTS'), Deno.env.get('CUSTOMER_APPLE_ENCRYPTION_KEY')));
const process = createDeletionCleanup({ rpc, revoke: task => apple.revoke(task),
  remove: (bucket, names) => admin.storage.from(bucket).remove(names),
  deleteUser: id => admin.auth.admin.deleteUser(id),
  // No identity, code, token, contact, provider response or receipt is logged.
  warn: () => console.warn('Account deletion cleanup is pending retry'),
});
async function runtimeConfiguration(): Promise<RuntimeConfiguration | null> {
  const { data, error } = await admin.rpc('customer_deletion_runtime_configuration');
  if (error) throw Error('NOT_ENABLED');
  return data;
}
const deliverMail = createDeletionMailer({ configuration, resendKey: Deno.env.get('RESEND_API_KEY') || '', fetch,
  capture: async (id, email) => {
    const { error } = await admin.rpc('cloud_test_mailbox', { p_action: 'capture', p_data: { recipient: email.to[0], subject: email.subject, bookingEmail: { idempotencyKey: id, text: email.text, html: email.html } } });
    if (error) throw Error('EMAIL_UNAVAILABLE');
  },
});
const handler = withCloudTestGateway(withDeletionActivation(configuration, runtimeConfiguration, createDeletionHandler({
  enabled: configuration.enabled, newRequestsEnabled: configuration.newRequestsEnabled, appUrl, pepper: serviceKey,
  identity: token => customerIdentity(admin, token), rpc, process,
  apple: createAppleActions({ provider: apple, rpc }),
  retain: work => EdgeRuntime.waitUntil(work),
  password: async (userId, password) => {
    const existing = await admin.auth.admin.getUserById(userId);
    if (existing.error || !existing.data.user) return false;
    const person = existing.data.user;
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') || '', options);
    const result = person.email && person.email_confirmed_at ? await client.auth.signInWithPassword({ email: person.email, password }) : person.phone ? await client.auth.signInWithPassword({ phone: person.phone, password }) : null;
    if (!result || result.error || !result.data.session) return false;
    const valid = result.data.user.id === userId;
    await admin.auth.admin.signOut(result.data.session.access_token, 'local');
    return valid;
  },
  mail: deliverMail,
})));
Deno.serve(async req => {
  if (!req.headers.has('x-account-deletion-worker')) return handler(req);
  if (!configuration.cleanupEnabled || req.method !== 'POST' || req.headers.has('origin')) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    const secret = req.headers.get('x-account-deletion-worker') || '';
    if (!/^[0-9a-f]{64}$/.test(secret)) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    if (!deletionRuntimeMatches(configuration, await runtimeConfiguration())) return Response.json({ error: 'NOT_ENABLED' }, { status: 503 });
    const config = await rpc('runtime');
    if (await digest(secret) !== await digest(String(config.secret || ''))) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    const jobs = await rpc('batch') as string[];
    EdgeRuntime.waitUntil(Promise.all(jobs.map(process)).then(() => {}));
    return Response.json({ accepted: jobs.length }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'UNAVAILABLE' }, { status: 503 }); }
});
