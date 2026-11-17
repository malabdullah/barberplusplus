type Mailer = {
  resend: (params: { type: 'signup'; email: string; options: { emailRedirectTo: string } }) => Promise<{ error: unknown }>;
  resetPasswordForEmail: (email: string, options: { redirectTo: string }) => Promise<{ error: unknown }>;
};

// GoTrue delivers production customer mail through its existing SMTP setup.
// Registration still creates the trusted customer role before requesting mail.
// The implicit email flow permits opening the link on another browser/device.
export function createCustomerEmailDelivery(auth: Mailer, appUrl: string, environment = '') {
  return async (email: string, purpose: 'confirm' | 'recovery', returnTo: string) => {
    let callback = new URL('/customer/email-callback', appUrl);
    callback.searchParams.set('next', returnTo === 'book' ? 'book' : 'account');
    const https = returnTo.startsWith('native-https:');
    if (https || returnTo.startsWith('native:')) {
      const state=returnTo.slice(https ? 'native-https:'.length : 'native:'.length);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state) || !((environment==='cloud-test' && appUrl==='https://barber-test.alabdullah-cs.workers.dev') || (environment==='production' && appUrl==='https://www.barberplusplus.com'))) throw Error('INVALID_REQUEST');
      if (https) {
        if (purpose !== 'confirm') throw Error('INVALID_REQUEST');
        callback = new URL('/auth/email', environment === 'cloud-test' ? 'https://barber-open-test.alabdullah-cs.workers.dev' : 'https://barber-open.alabdullah-cs.workers.dev');
      }
      callback.searchParams.set('client','ios');callback.searchParams.set('state',state);
    }
    const result = purpose === 'recovery'
      ? await auth.resetPasswordForEmail(email, { redirectTo: callback.href })
      : await auth.resend({ type: 'signup', email, options: { emailRedirectTo: callback.href } });
    if (result.error) throw Error('UNAVAILABLE');
  };
}
