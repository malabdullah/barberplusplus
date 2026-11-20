const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fingerprint = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
export function validAuthReturn(url, origin) {
  if (url.origin !== origin || url.username || url.password || url.hash) return false;
  const entries = [...url.searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length || !uuid.test(url.searchParams.get('state') || '')) return false;
  if (url.pathname === '/auth/email') return entries.length === 3
    && entries.every(([key]) => ['requestId', 'state', 'delivery'].includes(key))
    && uuid.test(url.searchParams.get('requestId') || '') && uuid.test(url.searchParams.get('delivery') || '');
  if (url.pathname !== '/auth/oauth') return false;
  if (url.searchParams.has('code')) return entries.length === 2
    && /^[A-Za-z0-9_-]{20,256}$/.test(url.searchParams.get('code') || '') && !url.searchParams.has('error');
  return entries.length >= 2 && entries.length <= 4
    && entries.every(([key]) => ['state', 'error', 'error_code', 'error_description'].includes(key))
    && /^(access_denied|server_error|temporarily_unavailable|invalid_request)$/.test(url.searchParams.get('error') || '')
    && (!url.searchParams.has('error_code') || /^[a-z0-9_]{1,80}$/.test(url.searchParams.get('error_code') || ''))
    && (!url.searchParams.has('error_description') || /^[^\u0000-\u001f\u007f]{0,512}$/.test(url.searchParams.get('error_description') || ''));
}
export function createAuthReturnWorker({ origin, appOrigin, packageName, fingerprints }) {
  const validConfiguration = (origin === 'https://barber-auth-test.alabdullah-cs.workers.dev' && appOrigin === 'https://barber-test.alabdullah-cs.workers.dev' && packageName === 'com.barberplusplus.customer.test')
    || (origin === 'https://barber-auth.alabdullah-cs.workers.dev' && appOrigin === 'https://www.barberplusplus.com' && packageName === 'com.barberplusplus.customer');
  if (!validConfiguration || !Array.isArray(fingerprints) || fingerprints.length > 8 || new Set(fingerprints).size !== fingerprints.length || fingerprints.some(v => !fingerprint.test(v))) throw Error('INVALID_AUTH_HELPER_CONFIGURATION');
  return {
    fetch(request) {
      const url = new URL(request.url);
      const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
      const reply = (status, body = '') => new Response(request.method === 'HEAD' ? null : body, { status, headers });
      if (url.origin !== origin) return reply(404);
      if (!['GET', 'HEAD'].includes(request.method)) return reply(405);
      if (url.pathname === '/.well-known/assetlinks.json' && !url.search && !url.hash) {
        headers['Content-Type'] = 'application/json'; headers['Cache-Control'] = 'public, max-age=300';
        return reply(200, JSON.stringify(fingerprints.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: {
          namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: fingerprints,
        } }] : []));
      }
      if (!validAuthReturn(url, origin)) return reply(404);
      // The OS gives a verified app the original URL. The web fallback never
      // forwards credentials/handles, adopts a session, or redirects to a caller URL.
      headers.Location = url.pathname === '/auth/email'
        ? `${appOrigin}/customer/email-callback?client=android&native_fallback=1`
        : `${appOrigin}/customer/sign-in`;
      return reply(307);
    },
  };
}
