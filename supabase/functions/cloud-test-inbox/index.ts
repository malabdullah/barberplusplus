import { createClient } from 'jsr:@supabase/supabase-js@2.89.0';
import { withCloudTestGateway } from '../_shared/test-boundary.ts';
import { signupLink } from './signup-link.ts';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));

Deno.serve(withCloudTestGateway(async req => {
  if (Deno.env.get('APP_ENV') !== 'cloud-test') return new Response('Not found', {status:404});
  if (req.method !== 'GET') return new Response('Method not allowed', {status:405});
  const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {auth:{persistSession:false}});
  let {data,error} = await admin.rpc('cloud_test_mailbox', {p_action:'list',p_data:{}});
  if (error) return new Response('Inbox unavailable', {status:503});
  const recipient = new URL(req.url).searchParams.get('recipient')?.trim().toLowerCase();
  if (recipient && !/^[^\s@<>]+@example\.test$/.test(recipient)) return new Response('Invalid Test recipient', {status:400});
  if (recipient) data = (data || []).filter((mail: Record<string, unknown>) => String(mail.recipient || '').trim().toLowerCase() === recipient);
  if (new URL(req.url).searchParams.get('format') === 'json') return Response.json(data, {headers:{'Cache-Control':'no-store'}});
  const appUrl = Deno.env.get('APP_URL') || '';
  const messages = (data || []).map((mail: Record<string, unknown>) => {
    const payload = mail.payload as Record<string, Record<string, string>>;
    let links: {label:string;url:string}[] = [];
    const signupLinks = new Set<string>();
    if (mail.link) links = [{label:'Open link / فتح الرابط',url:String(mail.link)}];
    else if (payload?.email_data) {
      const email = payload.email_data;
      for (const key of ['token_hash','token_hash_new']) {
        if (!email[key]) continue;
        const verify = new URL('/email/verify.html', appUrl);
        const redirect = email.redirect_to || appUrl;
        // Mirror only the signup template's direct callback. Other email types
        // and Android's separately bound Test flow retain their existing links.
        let android = false;
        try { android = new URL(redirect).searchParams.get('client') === 'android'; } catch { /* Reject malformed signup destinations below. */ }
        if (email.email_action_type === 'signup' && !android) {
          const signup = signupLink(redirect, email[key], appUrl);
          if (signup) { links.push({ label: 'Open link / فتح الرابط', url: signup }); signupLinks.add(signup); }
          continue;
        }
        verify.hash = new URLSearchParams({token_hash:email[key],type:email.email_action_type,redirect_to:redirect.startsWith(`${appUrl}/`) || redirect === appUrl ? redirect : appUrl}).toString();
        links.push({label:key === 'token_hash_new' ? 'Confirm current email / تأكيد البريد الحالي' : 'Open link / فتح الرابط',url:verify.href});
      }
    }
    // Only links issued for this isolated app or its own Auth API are clickable.
    const safe = links.filter(link => link.url.startsWith(`${appUrl}/`) || link.url.startsWith(`${Deno.env.get('SUPABASE_URL')}/auth/v1/verify?`)
      || signupLinks.has(link.url));
    const bookingEmail = (mail.payload as {bookingEmail?:{text?:string}})?.bookingEmail;
    return `<article><h2>${escape(mail.subject)}</h2><p>${escape(mail.recipient)}</p><time>${escape(mail.created_at)}</time>${bookingEmail?.text ? `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">${escape(bookingEmail.text)}</pre>` : ''}<p>${safe.map(link=>`<a href="${escape(link.url)}">${escape(link.label)}</a>`).join(' · ')}</p></article>`;
  }).join('');
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Barber++ Test Inbox</title><link rel="stylesheet" href="/test-inbox.css"><body><main><a href="/">← Barber++</a><h1>Test email inbox / بريد الاختبار</h1><p>Messages stay inside this test project. No email is sent. / لا يتم إرسال بريد حقيقي.</p><a href="/test-inbox">Refresh / تحديث</a>${messages || '<p>No messages yet. / لا توجد رسائل.</p>'}</main></body></html>`, {headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}));
