import { type DeletionConfiguration, PRODUCTION_APP, TEST_APP } from './configuration.ts';
import { digest } from './handler.ts';
type Email = { from: string; reply_to: string; to: string[]; subject: string; html: string; text: string };
type Dependencies = { configuration: DeletionConfiguration; resendKey: string;
  capture: (id: string, email: Email) => Promise<void>;
  fetch: (url: string, init: RequestInit) => Promise<Response> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function deletionEmail(email: string, code: string, language: string, appUrl: string): Email {
  if (![TEST_APP, PRODUCTION_APP].includes(appUrl) || !/^\d{6}$/.test(code) || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw Error('EMAIL_UNAVAILABLE');
  const ar = language === 'ar';
  const subject = ar ? 'تأكيد حذف حساب Barber++' : 'Confirm deletion of your Barber++ account';
  const intro = ar ? 'استخدم هذا الرمز للتحقق من هويتك قبل حذف حسابك.' : 'Use this code to verify your identity before deleting your account.';
  const expiry = ar ? 'صالح لمدة 10 دقائق. لا تشارك الرمز أو ترد به على هذه الرسالة.' : 'It expires in 10 minutes. Do not share this code or reply with it.';
  const warning = ar ? 'التحقق وحده لا يحذف حسابك. عليك تأكيد الحذف وإلغاء المواعيد القادمة داخل Barber++.' : 'Verification alone does not delete your account. You must confirm deletion and cancellation of upcoming appointments inside Barber++.';
  const ignore = ar ? 'إذا لم تطلب حذف الحساب، تجاهل هذه الرسالة أو تواصل مع الدعم.' : 'If you did not request account deletion, ignore this message or contact support.';
  const action = ar ? 'متابعة في Barber++' : 'Continue in Barber++'; const url = appUrl + '/customer/delete-account';
  const text = ['Barber++', subject, intro, code, expiry, warning, ignore, action + ': ' + url, 'support@barberplusplus.com'].join('\n');
  const html = `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f7f5ef;color:#242320;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:auto;background:#fffdf8;border:1px solid #dfd5bd;border-radius:16px"><tr><td style="padding:28px"><div dir="ltr" style="font-weight:bold;font-size:26px">Barber<span style="color:#bc8d32">++</span></div><h1 style="font-size:24px;line-height:1.4">${escape(subject)}</h1><p>${escape(intro)}</p><p dir="ltr" style="font-size:32px;letter-spacing:6px;color:#805b18">${code}</p><p>${escape(expiry)}</p><p>${escape(warning)}</p><p>${escape(ignore)}</p><p style="margin:28px 0"><a href="${escape(url)}" style="display:inline-block;padding:14px 24px;border-radius:8px;background:#d1a74f;color:#191919;text-decoration:none;font-weight:bold">${escape(action)}</a></p><a href="mailto:support@barberplusplus.com" style="color:#805d20">support@barberplusplus.com</a></td></tr></table></td></tr></table></body></html>`;
  return { from: 'Barber++ <noreply@barberplusplus.com>', reply_to: 'support@barberplusplus.com', to: [email], subject, html, text };
}
export async function deletionDeliveryKey(id: string): Promise<string> {
  // The gateway supplies operation UUID plus server-issued resend expiry. Never
  // derive an idempotency key from a recipient, password, OTP or request body.
  if (!uuid.test(id.slice(0, 36)) || id.length > 128 || id.length !== 36 && !/^-[0-9TZ:+.\-]+$/.test(id.slice(36))) throw Error('EMAIL_UNAVAILABLE');
  return 'customer-deletion/' + await digest(id);
}
export function createDeletionMailer(deps: Dependencies) {
  return async (email: string, code: string, language: string, id: string) => {
    const config = deps.configuration;
    if (!config.enabled || !config.newRequestsEnabled) throw Error('EMAIL_UNAVAILABLE');
    const message = deletionEmail(email, code, language, config.appUrl); const key = await deletionDeliveryKey(id);
    try {
      if (config.mode === 'test') {
        // Stable UUID for the existing private Test mailbox's deduplication field.
        const hash = key.split('/')[1];
        const captureId = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
        await deps.capture(captureId, message); return;
      }
      if (config.mode !== 'production' || !deps.resendKey.trim()) throw Error('EMAIL_UNAVAILABLE');
      const response = await deps.fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'error',
        headers: { Authorization: 'Bearer ' + deps.resendKey, 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(message), signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw Error('EMAIL_UNAVAILABLE');
      const result = await response.json();
      if (typeof result?.id !== 'string' || !result.id || result.id.length > 128) throw Error('EMAIL_UNAVAILABLE');
    } catch { throw Error('EMAIL_UNAVAILABLE'); }
  };
}
