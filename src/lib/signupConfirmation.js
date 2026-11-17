export function signupConfirmation(input, appUrl) {
  const url = new URL(input);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const query = [...url.searchParams];
  if (url.origin !== new URL(appUrl).origin || url.pathname !== '/customer/email-callback'
    || url.username || url.password || new Set(query.map(([key]) => key)).size !== query.length
    || query.some(([key, value]) => !(key === 'next' && ['account', 'book', 'work'].includes(value))
      && !(key === 'signup_fallback' && value === 'ios'))
    || [...fragment.keys()].length !== 2 || fragment.get('type') !== 'signup'
    || !/^(?:[a-f0-9]{56}|[a-f0-9]{64})$/i.test(fragment.get('token_hash') || '')) throw Error('INVALID_CODE');
  return { token: fragment.get('token_hash'), work: url.searchParams.get('next') === 'work',
    returnTo: url.searchParams.get('next') === 'book' ? '/book' : '/customer/account',
    fallback: url.searchParams.get('signup_fallback') === 'ios' };
}
