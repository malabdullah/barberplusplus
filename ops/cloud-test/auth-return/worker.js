import associations from './associations.json' with { type: 'json' };
export const AUTH_ORIGIN = 'https://barber-auth-test.alabdullah-cs.workers.dev';
export const TEST_ORIGIN = 'https://barber-test.alabdullah-cs.workers.dev';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validAuthReturn(url) {
  if (url.origin !== AUTH_ORIGIN || url.hash) return false;
  const entries = [...url.searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) return false;
  const state = url.searchParams.get('state');
  if (!uuid.test(state || '')) return false;
  if (url.pathname === '/auth/email') return entries.length === 3
    && entries.every(([key]) => ['requestId', 'state', 'delivery'].includes(key))
    && uuid.test(url.searchParams.get('requestId') || '') && uuid.test(url.searchParams.get('delivery') || '');
  if (url.pathname !== '/auth/oauth') return false;
  if (url.searchParams.has('code')) return entries.length === 2
    && /^[A-Za-z0-9_-]{20,256}$/.test(url.searchParams.get('code') || '')
    && !url.searchParams.has('error');
  return entries.length >= 2 && entries.length <= 4
    && entries.every(([key]) => ['state', 'error', 'error_code', 'error_description'].includes(key))
    && /^(access_denied|server_error|temporarily_unavailable|invalid_request)$/.test(url.searchParams.get('error') || '')
    && (!url.searchParams.has('error_code') || /^[a-z0-9_]{1,80}$/.test(url.searchParams.get('error_code') || ''))
    && (!url.searchParams.has('error_description') || /^[^\u0000-\u001f\u007f]{0,512}$/.test(url.searchParams.get('error_description') || ''));
}
export default {
  fetch(request) {
    const url = new URL(request.url);
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
    const reply = (status, body = '') => new Response(request.method === 'HEAD' ? null : body, { status, headers });
    if (url.origin !== AUTH_ORIGIN) return reply(404);
    if (!['GET', 'HEAD'].includes(request.method)) return reply(405);
    if (url.pathname === '/.well-known/assetlinks.json' && !url.search) {
      headers['Content-Type'] = 'application/json'; headers['Cache-Control'] = 'public, max-age=300';
      return reply(200, JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'], target: {
        namespace: 'android_app', package_name: associations.androidPackage, sha256_cert_fingerprints: associations.androidSha256,
      } }]));
    }
    if (!validAuthReturn(url)) return reply(404);
    // An installed verified app receives the original intent from Android. The
    // browser fallback must not forward a delivery handle or PKCE code to web.
    headers.Location = url.pathname === '/auth/email'
      ? `${TEST_ORIGIN}/customer/email-callback?client=android&native_fallback=1`
      : `${TEST_ORIGIN}/customer/sign-in`;
    return reply(307);
  },
};
