const types = new Set(['signup', 'recovery', 'magiclink', 'invite', 'email_change']);
const paths = new Set(['/', '/customer/email-callback', '/reset-password', '/accept-invite']);

// Fragments keep one-time credentials out of web-server logs and referrers.
export function verificationUrl(input, config) {
  const page = new URL(input);
  const app = new URL(config.appUrl);
  const backend = new URL(config.supabaseUrl);
  if (page.origin !== app.origin || app.protocol !== 'https:' || backend.protocol !== 'https:' || backend.username || backend.password || backend.pathname !== '/') throw new Error('INVALID_LINK');
  const values = new URLSearchParams(page.hash.slice(1));
  const type = values.get('type');
  const token = values.get('token_hash');
  if (!types.has(type) || !/^[a-f0-9]{32,128}$/i.test(token || '')) throw new Error('INVALID_LINK');
  const target = new URL(values.get('redirect_to') || app.href);
  if (target.origin !== app.origin || target.username || target.password || !paths.has(target.pathname) || target.hash) throw new Error('INVALID_LINK');
  for (const key of target.searchParams.keys()) if (key !== 'next' || target.pathname !== '/customer/email-callback' || !['book', 'account'].includes(target.searchParams.get(key))) throw new Error('INVALID_LINK');
  const verify = new URL('/auth/v1/verify', backend);
  verify.searchParams.set('type', type);
  verify.searchParams.set('token', token);
  verify.searchParams.set('redirect_to', target.href);
  return { url: verify.href, type, customer: target.pathname.startsWith('/customer/') };
}
