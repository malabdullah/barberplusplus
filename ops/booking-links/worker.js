import associations from '../auth-return/associations.live.json' with { type: 'json' };
export const HANDOFF_ORIGIN = 'https://barber-open.alabdullah-cs.workers.dev';
export const BOOKING_ORIGIN = 'https://www.barberplusplus.com';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export default {
  fetch(request) {
    const url = new URL(request.url);
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
    const reply = (status, body = '') => new Response(request.method === 'HEAD' ? null : body, { status, headers });
    if (url.origin !== HANDOFF_ORIGIN) return reply(404);
    if (!['GET', 'HEAD'].includes(request.method)) return reply(405);
    if (url.pathname === '/.well-known/assetlinks.json' && !url.search && !url.hash) {
      headers['Content-Type'] = 'application/json';
      headers['Cache-Control'] = 'public, max-age=300';
      return reply(200, JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'], target: {
        namespace: 'android_app', package_name: associations.androidPackage,
        sha256_cert_fingerprints: associations.androidSha256,
      } }]));
    }
    if (url.pathname === '/.well-known/apple-app-site-association' && !url.search) {
      headers['Content-Type'] = 'application/json';
      headers['Cache-Control'] = 'public, max-age=300';
      return reply(200, JSON.stringify({ applinks: { details: [{ appIDs: ['D49RFZQ6BT.com.barberplusplus.customer'], components: [
        { '/': '/book', '?': { shop: '*' } }, { '/': '/book', '?': { barber: '*' } },
        { '/': '/auth/email', '?': { client: 'ios', state: '*' } },
      ] }] } }));
    }
    const signup = signupFallback(url, HANDOFF_ORIGIN, BOOKING_ORIGIN);
    if (signup !== null) {
      if (!signup) return reply(404);
      headers.Location = signup;
      return reply(307);
    }
    if (url.pathname !== '/book' || url.hash) return reply(404);
    const entries = [...url.searchParams.entries()];
    if (entries.length !== 1 || !['shop', 'barber'].includes(entries[0][0]) || !uuid.test(entries[0][1])) return reply(404);
    const target = new URL('/book', BOOKING_ORIGIN);
    target.searchParams.set(entries[0][0], entries[0][1]);
    headers.Location = target.href;
    return reply(307);
  },
};
import { signupFallback } from './auth-email.js';
