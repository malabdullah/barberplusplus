import associations from './associations.json' with { type: 'json' };
import { signupFallback } from '../../booking-links/auth-email.js';
export const HANDOFF_ORIGIN = 'https://barber-open-test.alabdullah-cs.workers.dev';
export const TEST_ORIGIN = 'https://barber-test.alabdullah-cs.workers.dev';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export default {
  fetch(request) {
    const url = new URL(request.url);
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
    const reply = (status, body = '') => new Response(request.method === 'HEAD' ? null : body, { status, headers });
    if (url.origin !== HANDOFF_ORIGIN) return reply(404);
    if (!['GET', 'HEAD'].includes(request.method)) return reply(405);
    if (url.pathname === '/.well-known/apple-app-site-association' && !url.search) {
      headers['Content-Type'] = 'application/json'; headers['Cache-Control'] = 'public, max-age=300';
      return reply(200, JSON.stringify({ applinks: { details: [{ appIDs: [associations.iosAppId], components: [
        { '/': '/book', '?': { shop: '*' } }, { '/': '/book', '?': { barber: '*' } },
        { '/': '/auth/email', '?': { client: 'ios', state: '*' } },
        { '/': '/payments/return' },
      ] }] } }));
    }
    if (url.pathname === '/.well-known/assetlinks.json' && !url.search) {
      headers['Content-Type'] = 'application/json'; headers['Cache-Control'] = 'public, max-age=300';
      const fingerprints = associations.androidSha256;
      // Empty until the coordinator supplies the accepted Test APK signer. Never
      // substitute a debug certificate from a different artifact or a Live app.
      return reply(200, JSON.stringify(fingerprints.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: {
        namespace: 'android_app', package_name: associations.androidPackage, sha256_cert_fingerprints: fingerprints,
      } }] : []));
    }
    // Provider parameters are never passed to the app or treated as payment
    // evidence. The clean app link is a signal to check the signed-in account.
    if (url.pathname === '/payments/provider-return' && !url.hash) {
      headers.Location = HANDOFF_ORIGIN + '/payments/return';
      return reply(303);
    }
    if (url.pathname === '/payments/return' && !url.search && !url.hash) {
      headers['Content-Type'] = 'text/html; charset=utf-8';
      headers['Content-Security-Policy'] = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'";
      return reply(200, '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Check payment | Barber++ Test</title><main><h1>Check your payment</h1><p>Return to Barber++ Test to check your payment status.</p><a href="' + TEST_ORIGIN + '/payments/open-app">Open Barber++ Test app</a> · <a href="' + TEST_ORIGIN + '/customer/account">Open the Test website</a></main></html>');
    }
    const signup = signupFallback(url, HANDOFF_ORIGIN, TEST_ORIGIN);
    if (signup !== null) {
      if (!signup) return reply(404);
      headers.Location = signup;
      return reply(307);
    }
    if (url.pathname !== '/book' || url.hash) return reply(404);
    const entries = [...url.searchParams.entries()];
    if (entries.length !== 1 || !['shop', 'barber'].includes(entries[0][0]) || !uuid.test(entries[0][1])) return reply(404);
    const target = new URL('/book', TEST_ORIGIN); target.searchParams.set(entries[0][0], entries[0][1]);
    headers.Location = target.href;
    return reply(307);
  },
};
