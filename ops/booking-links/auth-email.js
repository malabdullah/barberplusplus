const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// HTTP never receives the fragment. The OS passes it straight to an installed
// app; otherwise a fixed redirect inherits it into the browser confirmation.
export function signupFallback(url, origin, appOrigin) {
  if (url.pathname !== '/auth/email') return null;
  const query = [...url.searchParams];
  if (url.origin !== origin || url.username || url.password || url.hash
    || query.length !== 2 || new Set(query.map(([key]) => key)).size !== 2
    || url.searchParams.get('client') !== 'ios' || !uuid.test(url.searchParams.get('state') || '')) return false;
  return `${appOrigin}/customer/email-callback?next=account&signup_fallback=ios`;
}
