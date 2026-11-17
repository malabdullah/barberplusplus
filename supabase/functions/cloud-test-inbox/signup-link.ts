const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function signupLink(redirect: string, token: string, appUrl: string): string | null {
  try {
    const url = new URL(redirect); const query = [...url.searchParams];
    if (url.username || url.password || url.hash || new Set(query.map(([key]) => key)).size !== query.length
      || !/^(?:[a-f0-9]{56}|[a-f0-9]{64})$/i.test(token)) return null;
    if (url.origin === 'https://barber-open-test.alabdullah-cs.workers.dev' && appUrl === 'https://barber-test.alabdullah-cs.workers.dev') {
      if (url.pathname !== '/auth/email' || query.length !== 2 || url.searchParams.get('client') !== 'ios' || !uuid.test(url.searchParams.get('state') || '')) return null;
    } else {
      if (url.origin !== appUrl || url.pathname !== '/customer/email-callback'
        || query.some(([key, value]) => !(key === 'next' && ['account', 'book', 'work'].includes(value))
          && !(key === 'client' && value === 'ios') && !(['state', 'request_id'].includes(key) && uuid.test(value)))
        || (url.searchParams.get('client') === 'ios' && !uuid.test(url.searchParams.get('state') || ''))) return null;
    }
    url.hash = new URLSearchParams({ type: 'signup', token_hash: token }).toString();
    return url.href;
  } catch { return null; }
}
