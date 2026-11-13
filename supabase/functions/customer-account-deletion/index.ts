import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { withCloudTestGateway } from '../_shared/test-boundary.ts';
import { customerIdentity } from '../_shared/customer-session.ts';
import { createDeletionHandler, digest } from './handler.ts';
declare const EdgeRuntime: { waitUntil: (work: Promise<void>) => void };
const url = Deno.env.get('SUPABASE_URL') || '';
const appUrl = Deno.env.get('APP_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const environment = Deno.env.get('APP_ENV') || '';
const enabled = environment === 'cloud-test' && url === 'https://qvkucvcjmojjbphlzlks.supabase.co' && appUrl === 'https://barber-test.alabdullah-cs.workers.dev';
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input: string | URL | Request, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) } };
const admin = createClient(url, serviceKey, options);
async function rpc(action: string, data: Record<string, unknown> = {}) {
  const result = await admin.rpc('customer_deletion_service', { p_action: action, p_data: data });
  if (result.error) throw Error(result.error.message);
  return result.data;
}
async function process(id: string) {
  let job;
  try {
    job = await rpc('claim', { id }); if (!job) return;
    const buckets = new Map<string, string[]>();
    for (const object of job.objects as { bucket: string; name: string }[]) buckets.set(object.bucket, [...(buckets.get(object.bucket) || []), object.name]);
    for (const [bucket, names] of buckets) {
      const { error } = await admin.storage.from(bucket).remove(names);
      if (error) throw Error('CLEANUP_PENDING');
    }
    for (const userId of job.userIds as string[]) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error && error.status !== 404 && error.code !== 'user_not_found') throw Error('CLEANUP_PENDING');
    }
    await rpc('finish', { id: job.id, lease: job.lease });
  } catch {
    if (job) await rpc('retry', { id: job.id, lease: job.lease }).catch(() => {});
    // No identity, code, token, contact, provider response or receipt is logged.
    console.warn('Account deletion cleanup is pending retry');
  }
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const handler = withCloudTestGateway(createDeletionHandler({
  enabled, appUrl, pepper: serviceKey,
  identity: token => customerIdentity(admin, token), rpc, process,
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
  mail: async (email, code, language, id) => {
    const arabic = language === 'ar';
    const subject = arabic ? 'تأكيد حذف حساب Barber++' : 'Confirm deletion of your Barber++ account';
    const text = arabic ? `رمز تأكيد حذف حسابك: ${code}\nصالح لمدة 10 دقائق. لا تشارك الرمز. إذا لم تطلب حذف الحساب، تجاهل هذه الرسالة.` : `Your account-deletion verification code is ${code}.\nIt expires in 10 minutes. Do not share it. If you did not request account deletion, ignore this email.`;
    const html = `<div dir="${arabic ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;background:#faf8f5;color:#141414;padding:32px;max-width:560px"><h1 style="font-size:26px">Barber++</h1><h2>${escape(subject)}</h2><p style="font-size:32px;letter-spacing:6px;color:#805b18" dir="ltr">${code}</p><p>${escape(text).replaceAll('\n', '<br>')}</p></div>`;
    if (environment === 'cloud-test') {
      const result = await admin.rpc('cloud_test_mailbox', { p_action: 'capture', p_data: { recipient: email, subject, bookingEmail: { idempotencyKey: /^[0-9a-f-]{36}$/.test(id) ? id : crypto.randomUUID(), text, html } } });
      if (result.error) throw Error('EMAIL_UNAVAILABLE'); return;
    }
    throw Error('EMAIL_UNAVAILABLE');
  },
}));
Deno.serve(async req => {
  if (!req.headers.has('x-account-deletion-worker')) return handler(req);
  if (!enabled || req.method !== 'POST' || req.headers.has('origin')) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    const secret = req.headers.get('x-account-deletion-worker') || '';
    if (!/^[0-9a-f]{64}$/.test(secret)) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    const config = await rpc('runtime');
    if (await digest(secret) !== await digest(String(config.secret || ''))) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    const jobs = await rpc('batch') as string[];
    EdgeRuntime.waitUntil(Promise.all(jobs.map(process)).then(() => {}));
    return Response.json({ accepted: jobs.length }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'UNAVAILABLE' }, { status: 503 }); }
});
