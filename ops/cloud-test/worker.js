const encoder = new TextEncoder();
const functions = new Set(['customer-auth', 'customer-booking', 'admin-password-reset', 'auth-rate-limiter', 'invite-barber', 'get-kuwait-governorates', 'cloud-test-inbox']);

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
async function equal(a, b) {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export default {
  async fetch(request, env) {
    if (!env.TEST_ACCESS_PASSWORD || !env.CLOUD_TEST_ACCESS_KEY) return new Response('Test setup is incomplete.', {status:503});
    const url = new URL(request.url);
    if (url.origin !== env.APP_URL) return new Response('Unknown test origin.', {status:404});
    const cookie = Array.from(await digest(`barber-test-session:${env.TEST_ACCESS_PASSWORD}`), x => x.toString(16).padStart(2, '0')).join('');
    const suppliedCookie = request.headers.get('cookie')?.match(/(?:^|;\s*)barber_test_access=([^;]*)/)?.[1] || '';
    const basic = `Basic ${btoa(`tester:${env.TEST_ACCESS_PASSWORD}`)}`;
    const authenticated = await equal(suppliedCookie, cookie) || await equal(request.headers.get('authorization') || '', basic);
    if (!authenticated) return new Response('Barber++ private test website', {
      status:401, headers:{'WWW-Authenticate':'Basic realm="Barber++ Test", charset="UTF-8"','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive'},
    });
    let response;
    if (url.pathname.startsWith('/test-api/') || url.pathname === '/test-inbox') {
      if (request.headers.get('origin') && request.headers.get('origin') !== env.APP_URL) return new Response('Forbidden', {status:403});
      const name = url.pathname === '/test-inbox' ? 'cloud-test-inbox' : url.pathname.slice('/test-api/'.length);
      if (!functions.has(name) || !['GET', 'POST', 'OPTIONS'].includes(request.method)
        || name === 'get-kuwait-governorates' && request.method !== 'GET') return new Response('Not found', {status:404});
      const headers = new Headers({'apikey':env.SUPABASE_PUBLISHABLE_KEY,'x-cloud-test-key':env.CLOUD_TEST_ACCESS_KEY,'Origin':env.APP_URL});
      for (const field of ['authorization', 'content-type']) {
        const value = request.headers.get(field);
        if (value && !(field === 'authorization' && value.startsWith('Basic '))) headers.set(field, value);
      }
      response = await fetch(`${env.SUPABASE_URL}/functions/v1/${name}${url.search}`, {
        method:request.method,headers,body:['GET','HEAD'].includes(request.method) ? undefined : request.body,
        redirect:'manual',signal:AbortSignal.timeout(25000),
      });
    } else if (url.pathname === '/robots.txt') {
      response = new Response('User-agent: *\nDisallow: /\n');
    } else {
      // Credentials and test cookies are never sent to the static asset service.
      response = await env.ASSETS.fetch(new Request(request.url, {method:request.method,headers:{Accept:request.headers.get('accept') || '*/*'}}));
    }
    const result = new Response(response.body, response);
    if (url.pathname === '/test-inbox' && url.searchParams.get('format') !== 'json' && response.ok) {
      // Supabase's shared Function domain serves HTML as plain text. The
      // authenticated, same-origin gateway owns this escaped HTML response.
      result.headers.set('Content-Type', 'text/html; charset=utf-8');
      result.headers.delete('Content-Disposition');
    }
    result.headers.set('Set-Cookie', `barber_test_access=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    result.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    result.headers.set('X-Content-Type-Options', 'nosniff');
    result.headers.set('Referrer-Policy', 'no-referrer');
    result.headers.set('X-Frame-Options', 'DENY');
    result.headers.set('Cache-Control', 'private, no-store');
    result.headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: ${env.SUPABASE_URL}; connect-src 'self' ${env.SUPABASE_URL} ${env.SUPABASE_URL.replace('https:', 'wss:')}; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`);
    return result;
  },
};
